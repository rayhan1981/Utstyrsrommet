from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import re
import uuid
import logging
import secrets as pysecrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

import bcrypt
import jwt
import httpx
import stripe
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from openpyxl import Workbook, load_workbook

# ---------------- Config ----------------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
ADMIN_EMAIL = os.environ['ADMIN_EMAIL'].lower()
ADMIN_PASSWORD = os.environ['ADMIN_PASSWORD']
ADMIN_NAME = os.environ.get('ADMIN_NAME', 'Admin')
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get('EMERGENT_EMAIL_KEY', '')
EMAIL_FROM_NAME = os.environ.get('EMAIL_FROM_NAME', 'Utstyrsrommet')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Utstyrsrommet API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("utstyrsrommet")

# ---------------- Plans ----------------
PLANS: Dict[str, Dict[str, Any]] = {
    "basic": {
        "key": "basic", "name": "Klubb Basic", "price": 399, "lookup_key": "utr_basic_monthly",
        "max_teams": 3, "max_users": 0,  # no extra users beyond admin
        "stock_audit": False, "excel_export": False, "excel_import": False,
        "logo_upload": False, "settings": False,
        "features": ["Dashboard", "Inntil 3 lag", "Personer", "Utstyr", "Utlån & Retur", "1 admin-bruker", "14 dagers gratis prøve"],
    },
    "pro": {
        "key": "pro", "name": "Klubb Pro", "price": 599, "lookup_key": "utr_pro_monthly",
        "max_teams": 10, "max_users": 3,
        "stock_audit": True, "excel_export": True, "excel_import": False,
        "logo_upload": False, "settings": False,
        "features": ["Alt i Basic", "Inntil 10 lag", "3 ekstra brukere", "Varetelling", "Excel-eksport (beholdning + lag)", "Invitasjons-epost"],
    },
    "deluxe": {
        "key": "deluxe", "name": "Klubb Deluxe", "price": 999, "lookup_key": "utr_deluxe_monthly",
        "max_teams": None, "max_users": 5,
        "stock_audit": True, "excel_export": True, "excel_import": True,
        "logo_upload": True, "settings": True, "allow_user_addon": True,
        "features": ["Alt i Pro", "Ubegrenset lag", "5 ekstra brukere inkludert", "Kjøp flere brukere for 199,-/mnd", "Excel-import m/mal", "Klubbinnstillinger + logo", "Prioritert support"],
    },
}

MODULES = ["dashboard", "teams", "people", "inventory", "loans", "stock_audit", "users", "settings"]
ACCESS_LEVELS = ["none", "read", "write", "admin"]


def default_perms(level: str = "read") -> Dict[str, str]:
    return {m: level for m in MODULES}


def admin_perms() -> Dict[str, str]:
    return {m: "admin" for m in MODULES}


# ---------------- Helpers ----------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _clean(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


def _cookie(resp: Response, key: str, value: str, max_age: int = 12 * 3600):
    resp.set_cookie(key=key, value=value, httponly=True, secure=True, samesite="none", max_age=max_age, path="/")


# ---------------- Auth ----------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Ikke innlogget")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Bruker ikke funnet")
        if not user.get("active", True):
            raise HTTPException(status_code=403, detail="Konto deaktivert")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token utløpt")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ugyldig token")


async def resolve_tenant_id(request: Request, user: dict) -> Optional[str]:
    """Return current tenant_id based on user and impersonation cookie."""
    if user.get("role") == "platform_owner":
        imp = request.cookies.get("imp_cid")
        if imp:
            cust = await db.customers.find_one({"id": imp})
            if cust:
                return cust["id"]
        # Fall back to owner's own workspace tenant
        return user.get("tenant_id")
    return user.get("tenant_id")


async def require_tenant(request: Request, user=Depends(get_current_user)) -> str:
    tid = await resolve_tenant_id(request, user)
    if not tid:
        raise HTTPException(status_code=400, detail="Ingen kunde valgt. Velg en kunde å jobbe i.")
    return tid


async def get_tenant_plan(tenant_id: str) -> Dict[str, Any]:
    cust = await db.customers.find_one({"id": tenant_id})
    if not cust:
        raise HTTPException(status_code=404, detail="Kunde ikke funnet")
    return PLANS.get(cust.get("plan", "basic"), PLANS["basic"])


async def require_feature(request: Request, user: dict, feature: str) -> str:
    tid = await require_tenant(request, user)
    if user.get("role") == "platform_owner":
        return tid  # owner bypass
    plan = await get_tenant_plan(tid)
    if not plan.get(feature):
        raise HTTPException(status_code=403, detail=f"Pakken støtter ikke {feature}. Oppgrader for å få tilgang.")
    return tid


def require_perm(module: str, level: str = "read"):
    order = {"none": 0, "read": 1, "write": 2, "admin": 3}

    async def dep(request: Request, user=Depends(get_current_user)) -> dict:
        if user.get("role") in ("admin", "platform_owner"):
            return user
        perms = user.get("permissions", {})
        if order.get(perms.get(module, "none"), 0) < order.get(level, 1):
            raise HTTPException(status_code=403, detail=f"Mangler rettighet: {module}:{level}")
        return user

    return dep


def require_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "platform_owner"):
        raise HTTPException(status_code=403, detail="Kun admin")
    return user


def require_platform_owner(user=Depends(get_current_user)):
    if user.get("role") != "platform_owner":
        raise HTTPException(status_code=403, detail="Kun plattformeier")
    return user


# ---------------- Email ----------------
async def send_invitation_email(to: str, name: str, token: str):
    if not EMAIL_KEY:
        return None
    link = f"{FRONTEND_URL}/sett-passord?token={token}"
    html = (
        f'<table width="100%" style="background:#f8fafc;padding:24px;font-family:Arial,sans-serif">'
        f'<tr><td align="center"><table width="560" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">'
        f'<tr><td><h1 style="color:#064E3B;margin:0 0 16px 0">Velkommen, {name}!</h1>'
        f'<p>Du har fått tilgang til <strong>{EMAIL_FROM_NAME}</strong>.</p>'
        f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#064E3B;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">Opprett passord</a></p>'
        f'<p style="color:#475569;font-size:13px">Lenken er gyldig i 7 dager.</p>'
        f'</td></tr></table></td></tr></table>'
    )
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY},
                             json={"to": [to], "subject": f"Velkommen til {EMAIL_FROM_NAME}", "html": html, "from_name": EMAIL_FROM_NAME})
        r.raise_for_status()
        return r.json().get("id")
    except Exception as e:
        logger.error(f"E-post feilet: {e}")
        return None


# ---------------- Models ----------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class SetPasswordIn(BaseModel):
    token: str
    password: str


class SignupIn(BaseModel):
    club_name: str
    owner_name: str
    owner_email: EmailStr
    owner_phone: str = ""
    password: str
    plan: str = "basic"
    accept_terms: bool = False


class UserCreateIn(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = ""
    address: Optional[str] = ""
    role: str = "user"
    permissions: Optional[Dict[str, str]] = None
    password: Optional[str] = None


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    role: Optional[str] = None
    permissions: Optional[Dict[str, str]] = None
    active: Optional[bool] = None
    password: Optional[str] = None


class TrainerIn(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    years_engaged: str = ""


class TeamIn(BaseModel):
    club_id: Optional[str] = None
    team_name: str
    age_class: str = ""
    email: str = ""
    training_times: List[str] = Field(default_factory=list)
    contact_person: str = ""
    key_responsible: str = ""
    key_serial: str = ""
    head_coach: Optional[TrainerIn] = None
    team_manager: Optional[TrainerIn] = None
    trainer1: Optional[TrainerIn] = None
    trainer2: Optional[TrainerIn] = None
    trainer3: Optional[TrainerIn] = None
    trainer4: Optional[TrainerIn] = None
    trainer5: Optional[TrainerIn] = None


class PersonIn(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    team_ids: List[str] = Field(default_factory=list)


class SizeStock(BaseModel):
    size: str
    jersey_number: str = "X"
    quantity: int = 0
    location: str = ""


class ItemIn(BaseModel):
    name: str
    category: str = ""
    main_group: str = ""
    sub_group: str = ""
    price: float = 0.0
    total_stock: int = 0
    location: str = ""
    is_clothing: bool = False
    is_ball: bool = False
    sizes: List[SizeStock] = Field(default_factory=list)


class LoanIn(BaseModel):
    item_id: str
    quantity: int = 1
    team_id: Optional[str] = None
    person_id: Optional[str] = None
    mode: str = "loan"
    charge_price: bool = True
    size: Optional[str] = None
    jersey_number: Optional[str] = None
    notes: str = ""


class ReturnIn(BaseModel):
    quantity: int = 1
    received_by_person_id: Optional[str] = None


class ClubIn(BaseModel):
    name: str
    org_number: str = ""
    logo_url: str = ""


class StockCountIn(BaseModel):
    name: str = ""


class StockCountLineIn(BaseModel):
    item_id: str
    size: Optional[str] = None
    counted_quantity: int


class CheckoutIn(BaseModel):
    plan: str
    origin_url: str
    billing_cycle: str = "monthly"  # monthly | yearly
    accept_terms: bool = False


class SeatCheckoutIn(BaseModel):
    quantity: int = 1
    origin_url: str


class CancelIn(BaseModel):
    reason: str = ""


class UpdatePlanIn(BaseModel):
    plan: str
    extra_user_seats: Optional[int] = None


# ---------------- Startup ----------------
async def _generate_customer_number() -> str:
    for _ in range(10):
        cnr = str(pysecrets.randbelow(900000) + 100000)
        if not await db.customers.find_one({"customer_number": cnr}):
            return cnr
    raise HTTPException(500, "Kunne ikke generere kundenummer")


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.customers.create_index("customer_number", unique=True)
    await db.customers.create_index("id", unique=True)
    await db.invitations.create_index("token", unique=True)
    for col in ["teams", "people", "items", "loans", "clubs", "stock_counts"]:
        await db[col].create_index("id", unique=True)
        await db[col].create_index("tenant_id")

    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    # Ensure an "owner workspace" tenant exists for the platform owner so they
    # have their own private dashboard with full feature access.
    owner_cust = await db.customers.find_one({"customer_number": "000001"})
    if not owner_cust:
        owner_tenant_id = new_id()
        await db.customers.insert_one({
            "id": owner_tenant_id,
            "customer_number": "000001",
            "club_name": "Plattformeier - Egen klubb",
            "owner_name": ADMIN_NAME,
            "owner_email": ADMIN_EMAIL,
            "owner_phone": "",
            "plan": "deluxe",
            "status": "active",
            "trial_ends_at": None,
            "stripe_customer_id": None,
            "stripe_subscription_id": None,
            "is_owner_workspace": True,
            "created_at": now_iso(),
        })
    else:
        owner_tenant_id = owner_cust["id"]

    if not existing:
        await db.users.insert_one({
            "id": new_id(),
            "email": ADMIN_EMAIL,
            "name": ADMIN_NAME,
            "phone": "",
            "address": "",
            "role": "platform_owner",
            "permissions": admin_perms(),
            "active": True,
            "tenant_id": owner_tenant_id,
            "is_super_admin": True,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "created_at": now_iso(),
        })
        logger.info(f"Seedet plattformeier: {ADMIN_EMAIL}")
    else:
        update = {"role": "platform_owner", "is_super_admin": True, "active": True,
                  "tenant_id": owner_tenant_id, "permissions": admin_perms()}
        if not verify_password(ADMIN_PASSWORD, existing.get("password_hash", "")):
            update["password_hash"] = hash_password(ADMIN_PASSWORD)
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": update})


# ---------------- Public: Plans ----------------
@api.get("/plans")
async def list_plans():
    return [{k: v for k, v in p.items() if k != "lookup_key"} for p in PLANS.values()]


# ---------------- Auth ----------------
@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Feil e-post eller passord")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Konto deaktivert")
    token = create_access_token(user["id"], user["email"])
    _cookie(response, "access_token", token)
    # also clear impersonation on login
    response.delete_cookie("imp_cid", path="/")
    return {"user": _clean(dict(user)), "token": token}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("imp_cid", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(request: Request, user=Depends(get_current_user)):
    tid = await resolve_tenant_id(request, user)
    customer = None
    plan = None
    if tid:
        customer = await db.customers.find_one({"id": tid}, {"_id": 0})
        plan = PLANS.get(customer.get("plan", "basic")) if customer else None
    imp_cookie = request.cookies.get("imp_cid")
    impersonating = bool(
        user.get("role") == "platform_owner"
        and imp_cookie
        and customer
        and not customer.get("is_owner_workspace")
    )
    return {
        "user": user,
        "tenant_id": tid,
        "customer": customer,
        "plan": plan,
        "impersonating": impersonating,
    }


# ---------------- Signup ----------------
@api.post("/signup")
async def signup(data: SignupIn, response: Response):
    if data.plan not in PLANS:
        raise HTTPException(400, "Ugyldig pakke")
    if not data.accept_terms:
        raise HTTPException(400, "Du må godta bruksvilkårene for å opprette konto")
    if len(data.password) < 6:
        raise HTTPException(400, "Passord må være minst 6 tegn")
    email = data.owner_email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-post finnes allerede")

    customer_number = await _generate_customer_number()
    tenant_id = new_id()
    trial_ends = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()

    customer_doc = {
        "id": tenant_id,
        "customer_number": customer_number,
        "club_name": data.club_name,
        "owner_name": data.owner_name,
        "owner_email": email,
        "owner_phone": data.owner_phone,
        "plan": data.plan,
        "status": "trial",
        "trial_ends_at": trial_ends,
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "seats_subscription_id": None,
        "extra_user_seats": 0,
        "accept_terms": True,
        "terms_accepted_at": now_iso(),
        "created_at": now_iso(),
    }
    await db.customers.insert_one(customer_doc)

    user_id = new_id()
    await db.users.insert_one({
        "id": user_id,
        "email": email,
        "name": data.owner_name,
        "phone": data.owner_phone,
        "address": "",
        "role": "admin",
        "permissions": admin_perms(),
        "active": True,
        "tenant_id": tenant_id,
        "is_super_admin": False,
        "password_hash": hash_password(data.password),
        "created_at": now_iso(),
    })

    token = create_access_token(user_id, email)
    _cookie(response, "access_token", token)
    return {"ok": True, "customer_number": customer_number, "token": token, "customer": _clean(customer_doc)}


# ---------------- Subscription ----------------
@api.post("/subscription/checkout")
async def subscription_checkout(data: CheckoutIn, request: Request, user=Depends(require_admin)):
    tid = await resolve_tenant_id(request, user)
    if not tid:
        raise HTTPException(400, "Ingen kunde")
    if data.plan not in PLANS:
        raise HTTPException(400, "Ugyldig pakke")
    if not data.accept_terms:
        raise HTTPException(400, "Du må godta bruksvilkårene")
    cust = await db.customers.find_one({"id": tid})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")

    plan = PLANS[data.plan]
    cycle = "yearly" if data.billing_cycle == "yearly" else "monthly"
    lookup_key = plan["lookup_key"] if cycle == "monthly" else plan.get("yearly_lookup_key") or plan["lookup_key"].replace("_monthly", "_yearly")
    prices = stripe.Price.list(lookup_keys=[lookup_key], active=True, limit=1).data
    if not prices:
        raise HTTPException(500, f"Pris ikke funnet: {lookup_key}")
    price = prices[0]

    sub_data = {"metadata": {"tenant_id": tid, "plan": data.plan, "billing_cycle": cycle}}
    try:
        if cust.get("status") == "trial" and cust.get("trial_ends_at"):
            trial_end = datetime.fromisoformat(cust["trial_ends_at"])
            if trial_end > datetime.now(timezone.utc):
                sub_data["trial_end"] = int(trial_end.timestamp())
    except Exception:
        pass

    discounts = []
    if cycle == "yearly":
        discounts = [{"coupon": "UTR_YEARLY_50_FIRST"}]
        sub_data["metadata"]["yearly_loyalty"] = "pending"

    kwargs = dict(
        line_items=[{"price": price.id, "quantity": 1}],
        mode="subscription",
        success_url=f"{data.origin_url}/abonnement/suksess?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{data.origin_url}/app/abonnement",
        customer_email=cust["owner_email"] if not cust.get("stripe_customer_id") else None,
        metadata={"tenant_id": tid, "plan": data.plan, "billing_cycle": cycle},
        subscription_data=sub_data,
    )
    if discounts:
        kwargs["discounts"] = discounts
    if cust.get("stripe_customer_id"):
        kwargs["customer"] = cust["stripe_customer_id"]
        kwargs.pop("customer_email", None)
    session = stripe.checkout.Session.create(**{k: v for k, v in kwargs.items() if v is not None})

    await db.payment_transactions.insert_one({
        "session_id": session.id, "tenant_id": tid, "plan": data.plan, "billing_cycle": cycle,
        "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.customers.update_one({"id": tid}, {"$set": {"accept_terms": True, "terms_accepted_at": now_iso(), "billing_cycle": cycle}})
    return {"checkout_url": session.url, "session_id": session.id}


@api.post("/subscription/cancel")
async def subscription_cancel(data: CancelIn, request: Request, user=Depends(require_admin)):
    """Si opp hovedabonnement med 3 måneders varsel."""
    tid = await resolve_tenant_id(request, user)
    cust = await db.customers.find_one({"id": tid})
    if not cust or not cust.get("stripe_subscription_id"):
        raise HTTPException(400, "Ingen aktivt abonnement å si opp")
    cancel_at = int((datetime.now(timezone.utc) + timedelta(days=90)).timestamp())
    try:
        stripe.Subscription.modify(cust["stripe_subscription_id"], cancel_at=cancel_at,
                                    metadata={**(cust.get("sub_metadata") or {}), "cancel_reason": data.reason})
    except stripe.error.StripeError as e:
        raise HTTPException(400, f"Stripe-feil: {e}")
    await db.customers.update_one({"id": tid}, {"$set": {
        "status": "canceling", "cancel_at": datetime.fromtimestamp(cancel_at, timezone.utc).isoformat(),
        "cancel_reason": data.reason,
    }})
    return {"ok": True, "cancel_at": datetime.fromtimestamp(cancel_at, timezone.utc).isoformat()}


@api.post("/subscription/resume")
async def subscription_resume(request: Request, user=Depends(require_admin)):
    """Angre oppsigelse."""
    tid = await resolve_tenant_id(request, user)
    cust = await db.customers.find_one({"id": tid})
    if not cust or not cust.get("stripe_subscription_id"):
        raise HTTPException(400, "Ingen abonnement")
    try:
        stripe.Subscription.modify(cust["stripe_subscription_id"], cancel_at="")
    except stripe.error.StripeError as e:
        raise HTTPException(400, f"Stripe-feil: {e}")
    await db.customers.update_one({"id": tid}, {"$set": {"status": "active"}, "$unset": {"cancel_at": "", "cancel_reason": ""}})
    return {"ok": True}


@api.post("/subscription/seats/cancel")
async def seats_cancel(request: Request, user=Depends(require_admin)):
    """Si opp bruker-sete-abonnement umiddelbart."""
    tid = await resolve_tenant_id(request, user)
    cust = await db.customers.find_one({"id": tid})
    if not cust or not cust.get("seats_subscription_id"):
        raise HTTPException(400, "Ingen aktivt bruker-sete-abonnement")
    try:
        stripe.Subscription.delete(cust["seats_subscription_id"])
    except stripe.error.StripeError as e:
        raise HTTPException(400, f"Stripe-feil: {e}")
    await db.customers.update_one({"id": tid}, {"$set": {"extra_user_seats": 0}, "$unset": {"seats_subscription_id": ""}})
    return {"ok": True}


@api.get("/subscription/invoices")
async def subscription_invoices(request: Request, user=Depends(require_admin)):
    tid = await resolve_tenant_id(request, user)
    cust = await db.customers.find_one({"id": tid})
    if not cust or not cust.get("stripe_customer_id"):
        return []
    try:
        invoices = stripe.Invoice.list(customer=cust["stripe_customer_id"], limit=50).data
    except stripe.error.StripeError:
        return []
    return [{
        "id": i.id, "number": i.number, "status": i.status,
        "amount_paid": i.amount_paid / 100.0, "currency": i.currency.upper(),
        "created": datetime.fromtimestamp(i.created, timezone.utc).isoformat(),
        "hosted_url": i.hosted_invoice_url, "pdf_url": i.invoice_pdf,
        "description": (i.lines.data[0].description if i.lines and i.lines.data else ""),
    } for i in invoices]


@api.post("/subscription/seats/checkout")
async def seats_checkout(data: SeatCheckoutIn, request: Request, user=Depends(require_admin)):
    tid = await resolve_tenant_id(request, user)
    if not tid:
        raise HTTPException(400, "Ingen kunde")
    if data.quantity < 1:
        raise HTTPException(400, "Minst 1 ekstra bruker")
    cust = await db.customers.find_one({"id": tid})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    plan = PLANS.get(cust.get("plan", "basic"), PLANS["basic"])
    if not plan.get("allow_user_addon"):
        raise HTTPException(403, "Pakken støtter ikke kjøp av ekstra brukere. Oppgrader til Deluxe.")

    prices = stripe.Price.list(lookup_keys=["utr_user_addon_monthly"], active=True, limit=1).data
    if not prices:
        raise HTTPException(500, "Pris for ekstra bruker ikke funnet")
    price = prices[0]

    kwargs = dict(
        line_items=[{"price": price.id, "quantity": data.quantity}],
        mode="subscription",
        success_url=f"{data.origin_url}/abonnement/suksess?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{data.origin_url}/app/abonnement",
        customer_email=cust["owner_email"] if not cust.get("stripe_customer_id") else None,
        metadata={"tenant_id": tid, "addon": "user_seats", "quantity": str(data.quantity)},
        subscription_data={"metadata": {"tenant_id": tid, "addon": "user_seats", "quantity": str(data.quantity)}},
    )
    if cust.get("stripe_customer_id"):
        kwargs["customer"] = cust["stripe_customer_id"]
        kwargs.pop("customer_email", None)
    session = stripe.checkout.Session.create(**{k: v for k, v in kwargs.items() if v is not None})

    await db.payment_transactions.insert_one({
        "session_id": session.id, "tenant_id": tid, "addon": "user_seats",
        "quantity": data.quantity, "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"checkout_url": session.url, "session_id": session.id}


@api.get("/subscription/status/{session_id}")
async def subscription_status(session_id: str):
    rec = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Transaksjon ikke funnet")
    if rec.get("payment_status") != "paid":
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                tid = s.metadata.get("tenant_id") if s.metadata else rec.get("tenant_id")
                plan = s.metadata.get("plan") if s.metadata else rec.get("plan")
                addon = s.metadata.get("addon") if s.metadata else rec.get("addon")
                qty = int(s.metadata.get("quantity", 0)) if s.metadata and s.metadata.get("quantity") else rec.get("quantity", 0)
                await db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {"status": "completed", "payment_status": "paid",
                              "stripe_subscription_id": s.subscription,
                              "stripe_customer_id": s.customer,
                              "updated_at": now_iso()}})
                if tid:
                    if addon == "user_seats":
                        await db.customers.update_one({"id": tid}, {
                            "$inc": {"extra_user_seats": int(qty)},
                            "$set": {"stripe_customer_id": s.customer},
                        })
                    else:
                        await db.customers.update_one({"id": tid}, {"$set": {
                            "status": "active", "plan": plan or rec.get("plan"),
                            "stripe_subscription_id": s.subscription,
                            "stripe_customer_id": s.customer,
                        }})
                rec = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        except stripe.error.StripeError:
            pass
    return {"session_id": rec["session_id"], "status": rec["status"], "payment_status": rec["payment_status"]}


@api.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Invalid signature")
    obj, t = event["data"]["object"], event["type"]

    if t == "checkout.session.completed":
        md = obj.get("metadata") or {}
        tid = md.get("tenant_id")
        addon = md.get("addon")
        plan = md.get("plan")
        qty = int(md.get("quantity") or 0)
        cycle = md.get("billing_cycle", "monthly")
        await db.payment_transactions.update_one(
            {"session_id": obj["id"], "payment_status": {"$ne": "paid"}},
            {"$set": {"status": "completed", "payment_status": obj.get("payment_status", "paid"),
                      "stripe_subscription_id": obj.get("subscription"),
                      "stripe_customer_id": obj.get("customer"),
                      "updated_at": now_iso()}})
        if tid:
            if addon == "user_seats":
                await db.customers.update_one({"id": tid}, {
                    "$inc": {"extra_user_seats": qty},
                    "$set": {"stripe_customer_id": obj.get("customer"),
                             "seats_subscription_id": obj.get("subscription")},
                })
            else:
                await db.customers.update_one({"id": tid}, {"$set": {
                    "status": "active", "plan": plan, "billing_cycle": cycle,
                    "stripe_subscription_id": obj.get("subscription"),
                    "stripe_customer_id": obj.get("customer"),
                }})
    elif t == "invoice.payment_succeeded":
        # Swap 50% coupon → 10% loyalty on yearly renewals
        try:
            sub_id = obj.get("subscription")
            if sub_id and obj.get("billing_reason") == "subscription_cycle":
                sub = stripe.Subscription.retrieve(sub_id)
                if (sub.metadata or {}).get("yearly_loyalty") == "pending":
                    stripe.Subscription.modify(sub_id, coupon="UTR_YEARLY_10_LOYAL",
                                                metadata={**sub.metadata, "yearly_loyalty": "active"})
        except Exception as e:
            logger.error(f"Yearly loyalty swap feilet: {e}")
    elif t == "customer.subscription.updated":
        tid = (obj.get("metadata") or {}).get("tenant_id")
        if tid:
            status_map = {"active": "active", "trialing": "trial", "past_due": "past_due",
                          "canceled": "canceled", "unpaid": "past_due", "incomplete": "past_due"}
            await db.customers.update_one({"id": tid}, {"$set": {
                "status": status_map.get(obj.get("status"), "active"),
                "stripe_subscription_id": obj.get("id"),
            }})
    elif t == "customer.subscription.deleted":
        tid = (obj.get("metadata") or {}).get("tenant_id")
        if tid:
            await db.customers.update_one({"id": tid}, {"$set": {"status": "canceled"}})
    return {"status": "ok"}


# ---------------- Platform Owner: Impersonation ----------------
@api.get("/owner/customers/search")
async def owner_search(q: str = "", user=Depends(require_platform_owner)):
    q = (q or "").strip()
    if not q:
        return []
    rx = {"$regex": re.escape(q), "$options": "i"}
    customers = await db.customers.find({
        "is_owner_workspace": {"$ne": True},
        "$or": [
            {"customer_number": rx},
            {"club_name": rx},
            {"owner_name": rx},
            {"owner_email": rx},
            {"owner_phone": rx},
        ]
    }, {"_id": 0}).to_list(50)
    return customers


@api.post("/owner/impersonate/{customer_id}")
async def owner_impersonate(customer_id: str, response: Response, user=Depends(require_platform_owner)):
    cust = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    _cookie(response, "imp_cid", customer_id)
    return {"ok": True, "customer": cust}


@api.post("/owner/stop-impersonate")
async def owner_stop(response: Response, user=Depends(require_platform_owner)):
    response.delete_cookie("imp_cid", path="/")
    return {"ok": True}


@api.get("/owner/customers")
async def owner_list_customers(user=Depends(require_platform_owner)):
    return await db.customers.find({"is_owner_workspace": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.put("/owner/customers/{customer_id}")
async def owner_update_customer(customer_id: str, data: UpdatePlanIn, user=Depends(require_platform_owner)):
    if data.plan not in PLANS:
        raise HTTPException(400, "Ugyldig pakke")
    update = {"plan": data.plan}
    if data.extra_user_seats is not None:
        update["extra_user_seats"] = max(0, int(data.extra_user_seats))
    await db.customers.update_one({"id": customer_id}, {"$set": update})
    return await db.customers.find_one({"id": customer_id}, {"_id": 0})


# ---------------- Invitations / Set password ----------------
@api.get("/auth/invitation/{token}")
async def check_invitation(token: str):
    inv = await db.invitations.find_one({"token": token})
    if not inv or inv.get("used"):
        raise HTTPException(status_code=400, detail="Ugyldig eller brukt invitasjon")
    u = await db.users.find_one({"id": inv["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"email": u["email"], "name": u["name"]}


@api.post("/auth/set-password")
async def set_password(data: SetPasswordIn, response: Response):
    inv = await db.invitations.find_one({"token": data.token})
    if not inv or inv.get("used"):
        raise HTTPException(status_code=400, detail="Ugyldig eller brukt invitasjon")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Passord må være minst 6 tegn")
    await db.users.update_one({"id": inv["user_id"]}, {"$set": {"password_hash": hash_password(data.password), "active": True}})
    await db.invitations.update_one({"token": data.token}, {"$set": {"used": True, "used_at": now_iso()}})
    u = await db.users.find_one({"id": inv["user_id"]}, {"_id": 0, "password_hash": 0})
    token = create_access_token(u["id"], u["email"])
    _cookie(response, "access_token", token)
    return {"user": u, "token": token}


# ---------------- Users (per tenant) ----------------
@api.get("/users")
async def list_users(request: Request, user=Depends(require_admin)):
    tid = await require_tenant(request, user)
    users = await db.users.find({"tenant_id": tid}, {"_id": 0, "password_hash": 0}).to_list(200)
    return users


@api.post("/users")
async def create_user(data: UserCreateIn, request: Request, admin=Depends(require_admin)):
    tid = await require_tenant(request, admin)
    plan = await get_tenant_plan(tid)
    cust = await db.customers.find_one({"id": tid})
    extra = int((cust or {}).get("extra_user_seats", 0))
    max_users = plan.get("max_users")
    if max_users is not None and not (cust or {}).get("is_owner_workspace"):
        effective = max_users + extra
        count = await db.users.count_documents({"tenant_id": tid, "role": {"$ne": "admin"}})
        if count >= effective:
            msg = f"Pakken støtter maks {effective} ekstra brukere"
            if plan.get("allow_user_addon"):
                msg += ". Kjøp flere bruker-seter (199,-/mnd) på Abonnement-siden."
            else:
                msg += ". Oppgrader for flere."
            raise HTTPException(403, msg)

    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-post finnes allerede")
    uid = new_id()
    perms = data.permissions if data.permissions else (admin_perms() if data.role == "admin" else default_perms("read"))
    doc = {
        "id": uid, "email": email, "name": data.name, "phone": data.phone or "", "address": data.address or "",
        "role": data.role, "permissions": perms, "active": True, "is_super_admin": False,
        "tenant_id": tid,
        "password_hash": hash_password(data.password) if data.password else "",
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    inv_token = None
    if not data.password:
        inv_token = pysecrets.token_urlsafe(32)
        await db.invitations.insert_one({"token": inv_token, "user_id": uid, "created_at": now_iso(), "used": False})
        await send_invitation_email(email, data.name, inv_token)
    _clean(doc)
    return {"user": doc, "invitation_sent": not data.password,
            "invitation_link": f"{FRONTEND_URL}/sett-passord?token={inv_token}" if inv_token else None}


@api.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdateIn, request: Request, admin=Depends(require_admin)):
    tid = await require_tenant(request, admin)
    target = await db.users.find_one({"id": user_id})
    if not target or target.get("tenant_id") != tid:
        raise HTTPException(404, "Bruker ikke funnet")
    update = {k: v for k, v in data.dict(exclude_unset=True).items() if k != "password"}
    if data.password:
        update["password_hash"] = hash_password(data.password)
    await db.users.update_one({"id": user_id}, {"$set": update})
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request, admin=Depends(require_admin)):
    tid = await require_tenant(request, admin)
    target = await db.users.find_one({"id": user_id})
    if not target or target.get("tenant_id") != tid:
        raise HTTPException(404, "Bruker ikke funnet")
    if target.get("role") == "admin":
        count = await db.users.count_documents({"tenant_id": tid, "role": "admin"})
        if count <= 1:
            raise HTTPException(400, "Kan ikke slette siste admin for kunden")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


@api.post("/users/{user_id}/resend-invitation")
async def resend_invite(user_id: str, request: Request, admin=Depends(require_admin)):
    tid = await require_tenant(request, admin)
    target = await db.users.find_one({"id": user_id})
    if not target or target.get("tenant_id") != tid:
        raise HTTPException(404, "Bruker ikke funnet")
    inv_token = pysecrets.token_urlsafe(32)
    await db.invitations.insert_one({"token": inv_token, "user_id": user_id, "created_at": now_iso(), "used": False})
    await send_invitation_email(target["email"], target["name"], inv_token)
    return {"ok": True, "invitation_link": f"{FRONTEND_URL}/sett-passord?token={inv_token}"}


# ---------------- Clubs ----------------
@api.get("/clubs")
async def list_clubs(request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    return await db.clubs.find({"tenant_id": tid}, {"_id": 0}).to_list(100)


@api.post("/clubs")
async def create_club(data: ClubIn, request: Request, user=Depends(require_perm("settings", "write"))):
    tid = await require_feature(request, user, "settings")
    doc = {"id": new_id(), "tenant_id": tid, "name": data.name, "org_number": data.org_number,
           "logo_url": data.logo_url, "created_at": now_iso()}
    await db.clubs.insert_one(doc)
    return _clean(doc)


@api.put("/clubs/{club_id}")
async def update_club(club_id: str, data: ClubIn, request: Request, user=Depends(require_perm("settings", "write"))):
    tid = await require_feature(request, user, "settings")
    await db.clubs.update_one({"id": club_id, "tenant_id": tid}, {"$set": data.dict()})
    return await db.clubs.find_one({"id": club_id, "tenant_id": tid}, {"_id": 0})


@api.delete("/clubs/{club_id}")
async def delete_club(club_id: str, request: Request, user=Depends(require_admin)):
    tid = await require_feature(request, user, "settings")
    await db.clubs.delete_one({"id": club_id, "tenant_id": tid})
    return {"ok": True}


@api.post("/clubs/{club_id}/logo")
async def upload_logo(club_id: str, request: Request, file: UploadFile = File(...), user=Depends(require_perm("settings", "write"))):
    tid = await require_feature(request, user, "logo_upload")
    import base64
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(400, "Logo for stor (maks 2MB)")
    data_url = f"data:{file.content_type};base64,{base64.b64encode(data).decode()}"
    await db.clubs.update_one({"id": club_id, "tenant_id": tid}, {"$set": {"logo_url": data_url}})
    return {"logo_url": data_url}


# ---------------- Teams ----------------
@api.get("/teams")
async def list_teams(request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    return await db.teams.find({"tenant_id": tid}, {"_id": 0}).to_list(1000)


@api.post("/teams")
async def create_team(data: TeamIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    if user.get("role") != "platform_owner":
        plan = await get_tenant_plan(tid)
        if plan.get("max_teams") is not None:
            count = await db.teams.count_documents({"tenant_id": tid})
            if count >= plan["max_teams"]:
                raise HTTPException(403, f"Pakken støtter maks {plan['max_teams']} lag. Oppgrader for flere.")
    doc = data.dict()
    doc.update({"id": new_id(), "tenant_id": tid, "debt": 0.0, "created_at": now_iso()})
    await db.teams.insert_one(doc)
    return _clean(doc)


@api.get("/teams/{team_id}")
async def get_team(team_id: str, request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    t = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Lag ikke funnet")
    return t


@api.put("/teams/{team_id}")
async def update_team(team_id: str, data: TeamIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    await db.teams.update_one({"id": team_id, "tenant_id": tid}, {"$set": data.dict()})
    return await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})


@api.delete("/teams/{team_id}")
async def delete_team(team_id: str, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    await db.teams.delete_one({"id": team_id, "tenant_id": tid})
    return {"ok": True}


# ---------------- People ----------------
@api.get("/people")
async def list_people(request: Request, user=Depends(require_perm("people", "read"))):
    tid = await require_tenant(request, user)
    return await db.people.find({"tenant_id": tid}, {"_id": 0}).to_list(2000)


@api.post("/people")
async def create_person(data: PersonIn, request: Request, user=Depends(require_perm("people", "write"))):
    tid = await require_tenant(request, user)
    doc = data.dict()
    doc.update({"id": new_id(), "tenant_id": tid, "debt": 0.0, "created_at": now_iso()})
    await db.people.insert_one(doc)
    return _clean(doc)


@api.get("/people/{person_id}")
async def get_person(person_id: str, request: Request, user=Depends(require_perm("people", "read"))):
    tid = await require_tenant(request, user)
    p = await db.people.find_one({"id": person_id, "tenant_id": tid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Person ikke funnet")
    teams = await db.teams.find({"id": {"$in": p.get("team_ids", [])}, "tenant_id": tid}, {"_id": 0}).to_list(100)
    history = await db.loans.find({"person_id": person_id, "tenant_id": tid}, {"_id": 0}).sort("loan_date", -1).to_list(500)
    return {"person": p, "teams": teams, "history": history}


@api.put("/people/{person_id}")
async def update_person(person_id: str, data: PersonIn, request: Request, user=Depends(require_perm("people", "write"))):
    tid = await require_tenant(request, user)
    await db.people.update_one({"id": person_id, "tenant_id": tid}, {"$set": data.dict()})
    return await db.people.find_one({"id": person_id, "tenant_id": tid}, {"_id": 0})


@api.delete("/people/{person_id}")
async def delete_person(person_id: str, request: Request, user=Depends(require_perm("people", "admin"))):
    tid = await require_tenant(request, user)
    await db.people.delete_one({"id": person_id, "tenant_id": tid})
    return {"ok": True}


# ---------------- Items ----------------
def _prep_item_doc(doc: dict) -> dict:
    if doc.get("is_clothing") or doc.get("is_ball"):
        for s in doc["sizes"]:
            if doc.get("is_clothing") and not s.get("jersey_number"):
                s["jersey_number"] = "X"
            if doc.get("is_ball"):
                s["jersey_number"] = ""
        doc["total_stock"] = sum(s.get("quantity", 0) for s in doc["sizes"])
    return doc


@api.get("/items")
async def list_items(request: Request, user=Depends(require_perm("inventory", "read"))):
    tid = await require_tenant(request, user)
    return await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)


@api.post("/items")
async def create_item(data: ItemIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    doc = _prep_item_doc(data.dict())
    doc.update({"id": new_id(), "tenant_id": tid, "created_at": now_iso()})
    await db.items.insert_one(doc)
    return _clean(doc)


@api.put("/items/{item_id}")
async def update_item(item_id: str, data: ItemIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    doc = _prep_item_doc(data.dict())
    await db.items.update_one({"id": item_id, "tenant_id": tid}, {"$set": doc})
    return await db.items.find_one({"id": item_id, "tenant_id": tid}, {"_id": 0})


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, request: Request, user=Depends(require_perm("inventory", "admin"))):
    tid = await require_tenant(request, user)
    await db.items.delete_one({"id": item_id, "tenant_id": tid})
    return {"ok": True}


BALL_SIZES = ["00 Mykball", "Street håndball", "00", "0", "1", "2", "3"]
IMPORT_COLUMNS = ["Varenavn", "Kategori", "Hovedgruppe", "Undergruppe", "Pris", "Lokasjon", "Type", "Størrelse", "Draktnr", "Antall", "Lokasjon pr str"]


def _xlsx_response(wb: Workbook, filename: str):
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@api.get("/items/import/template")
async def items_import_template(request: Request, user=Depends(require_perm("inventory", "write"))):
    await require_feature(request, user, "excel_import")
    wb = Workbook()
    ws = wb.active; ws.title = "Varer"; ws.append(IMPORT_COLUMNS)
    ws.append(["Kjegler", "Trening", "Trening", "Markering", 29, "Hylle A1", "vare", "", "", 50, ""])
    ws.append(["Hjemmedrakt", "Klær", "Drakt", "Hjemme", 450, "Skap B2", "klær", "S", "X", 5, "Skap B2 - øverst"])
    ws.append(["Hjemmedrakt", "Klær", "Drakt", "Hjemme", 450, "Skap B2", "klær", "M", "10", 8, "Skap B2 - midten"])
    ws.append(["Håndball Select", "Baller", "Trening", "Håndball", 299, "Ballbur", "ball", "00 Mykball", "", 10, "Ballbur hylle 1"])
    ws.append(["Håndball Select", "Baller", "Trening", "Håndball", 299, "Ballbur", "ball", "1", "", 15, "Ballbur hylle 2"])
    info = wb.create_sheet("Instruksjoner")
    info.append(["UTSTYRSROMMET - Import-mal"])
    info.append([])
    for c in IMPORT_COLUMNS:
        info.append([f"- {c}"])
    info.append([])
    info.append(["Type: 'vare' | 'klær' | 'ball'"])
    info.append(["Gyldige ballstørrelser:"])
    for b in BALL_SIZES:
        info.append([f"- {b}"])
    return _xlsx_response(wb, "utstyrsrommet_import_mal.xlsx")


@api.post("/items/import")
async def items_import(request: Request, file: UploadFile = File(...), user=Depends(require_perm("inventory", "write"))):
    tid = await require_feature(request, user, "excel_import")
    content = await file.read()
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(400, "Kunne ikke lese Excel-fil")
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "Tom fil")
    header = [str(h or "").strip().lower() for h in rows[0]]
    expected = [h.lower() for h in IMPORT_COLUMNS]
    if header[:len(expected)] != expected:
        raise HTTPException(400, f"Feil kolonner. Forventet: {', '.join(IMPORT_COLUMNS)}")

    grouped: Dict[str, Dict[str, Any]] = {}
    errors: List[str] = []
    for idx, row in enumerate(rows[1:], start=2):
        if row is None or all(v is None or (isinstance(v, str) and not v.strip()) for v in row):
            continue
        try:
            name = (str(row[0]) if row[0] is not None else "").strip()
            if not name:
                continue
            cat = (str(row[1]) if row[1] else "").strip()
            mg = (str(row[2]) if row[2] else "").strip()
            sg = (str(row[3]) if row[3] else "").strip()
            price = float(row[4]) if row[4] not in (None, "") else 0.0
            loc = (str(row[5]) if row[5] else "").strip()
            type_raw = (str(row[6]) if row[6] else "").strip().lower()
            is_cloth = type_raw in ("klær", "klar", "clothing")
            is_ball = type_raw in ("ball", "baller")
            size = (str(row[7]) if row[7] else "").strip()
            jersey = (str(row[8]) if row[8] else "").strip() or "X"
            qty = int(row[9]) if row[9] not in (None, "") else 0
            size_loc = (str(row[10]) if len(row) > 10 and row[10] else "").strip()
            k = f"{name}||{cat}||{mg}||{sg}"
            if k not in grouped:
                grouped[k] = {"id": new_id(), "tenant_id": tid, "name": name, "category": cat, "main_group": mg,
                              "sub_group": sg, "price": price, "location": loc, "is_clothing": is_cloth,
                              "is_ball": is_ball, "sizes": [], "total_stock": 0, "created_at": now_iso()}
            doc = grouped[k]
            if is_cloth or is_ball:
                doc["is_clothing"] = is_cloth or doc.get("is_clothing", False)
                doc["is_ball"] = is_ball or doc.get("is_ball", False)
                doc["sizes"].append({"size": size, "jersey_number": "" if is_ball else jersey,
                                     "quantity": qty, "location": size_loc})
            else:
                doc["total_stock"] = (doc.get("total_stock") or 0) + qty
        except Exception as e:
            errors.append(f"Rad {idx}: {e}")
    created = 0
    for doc in grouped.values():
        if doc.get("is_clothing") or doc.get("is_ball"):
            doc["total_stock"] = sum(s.get("quantity", 0) for s in doc["sizes"])
        await db.items.insert_one(doc)
        created += 1
    return {"created": created, "errors": errors}


# ---------------- Loans ----------------
async def _adjust_stock(tid: str, item_id: str, delta: int, size: Optional[str] = None):
    item = await db.items.find_one({"id": item_id, "tenant_id": tid})
    if not item:
        return
    if (item.get("is_clothing") or item.get("is_ball")) and size:
        sizes = item.get("sizes", [])
        for s in sizes:
            if s["size"] == size:
                s["quantity"] = max(0, s.get("quantity", 0) + delta)
        total = sum(s.get("quantity", 0) for s in sizes)
        await db.items.update_one({"id": item_id, "tenant_id": tid}, {"$set": {"sizes": sizes, "total_stock": total}})
    else:
        new_total = max(0, item.get("total_stock", 0) + delta)
        await db.items.update_one({"id": item_id, "tenant_id": tid}, {"$set": {"total_stock": new_total}})


@api.get("/loans")
async def list_loans(request: Request, status: Optional[str] = None, team_id: Optional[str] = None,
                     person_id: Optional[str] = None, user=Depends(require_perm("loans", "read"))):
    tid = await require_tenant(request, user)
    q: Dict[str, Any] = {"tenant_id": tid}
    if status: q["status"] = status
    if team_id: q["team_id"] = team_id
    if person_id: q["person_id"] = person_id
    return await db.loans.find(q, {"_id": 0}).sort("loan_date", -1).to_list(2000)


@api.post("/loans")
async def create_loan(data: LoanIn, request: Request, user=Depends(require_perm("loans", "write"))):
    tid = await require_tenant(request, user)
    item = await db.items.find_one({"id": data.item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    if (item.get("is_clothing") or item.get("is_ball")) and data.size:
        avail = next((s.get("quantity", 0) for s in item.get("sizes", []) if s["size"] == data.size), 0)
    else:
        avail = item.get("total_stock", 0)
    if data.quantity > avail:
        raise HTTPException(400, f"Ikke nok på lager (tilgjengelig: {avail})")

    price = float(item.get("price", 0))
    charge = price * data.quantity
    if data.mode == "handout" and not data.charge_price:
        charge = 0.0

    loan_doc = {
        "id": new_id(), "tenant_id": tid, "item_id": data.item_id, "item_name": item.get("name", ""),
        "quantity": data.quantity, "size": data.size, "jersey_number": data.jersey_number,
        "team_id": data.team_id, "person_id": data.person_id, "mode": data.mode,
        "unit_price": price, "amount_owed": charge, "status": "borrowed",
        "loan_date": now_iso(), "picked_up_by": data.person_id,
        "return_date": None, "received_by_person_id": None, "notes": data.notes,
    }
    await db.loans.insert_one(loan_doc)
    await _adjust_stock(tid, data.item_id, -data.quantity, data.size)

    if charge > 0:
        if data.team_id:
            await db.teams.update_one({"id": data.team_id, "tenant_id": tid}, {"$inc": {"debt": charge}})
        if data.person_id:
            await db.people.update_one({"id": data.person_id, "tenant_id": tid}, {"$inc": {"debt": charge}})
    return _clean(loan_doc)


@api.post("/loans/{loan_id}/return")
async def return_loan(loan_id: str, data: ReturnIn, request: Request, user=Depends(require_perm("loans", "write"))):
    tid = await require_tenant(request, user)
    loan = await db.loans.find_one({"id": loan_id, "tenant_id": tid})
    if not loan:
        raise HTTPException(404, "Utlån ikke funnet")
    if loan.get("status") == "returned":
        raise HTTPException(400, "Allerede returnert")
    qty = min(data.quantity, loan["quantity"])
    unit_owed = (loan.get("amount_owed", 0) / loan["quantity"]) if loan["quantity"] else 0
    owed_reduce = unit_owed * qty
    await _adjust_stock(tid, loan["item_id"], qty, loan.get("size"))
    if owed_reduce > 0:
        if loan.get("team_id"):
            await db.teams.update_one({"id": loan["team_id"], "tenant_id": tid}, {"$inc": {"debt": -owed_reduce}})
        if loan.get("person_id"):
            await db.people.update_one({"id": loan["person_id"], "tenant_id": tid}, {"$inc": {"debt": -owed_reduce}})
    if qty >= loan["quantity"]:
        await db.loans.update_one({"id": loan_id, "tenant_id": tid}, {"$set": {
            "status": "returned", "return_date": now_iso(),
            "received_by_person_id": data.received_by_person_id, "amount_owed": 0,
        }})
        return {"ok": True, "status": "returned", "amount_owed": 0}
    else:
        remaining = loan["quantity"] - qty
        new_owed = loan.get("amount_owed", 0) - owed_reduce
        await db.loans.update_one({"id": loan_id, "tenant_id": tid}, {"$set": {
            "quantity": remaining, "amount_owed": new_owed,
        }})
        returned_doc = {**loan}
        returned_doc.pop("_id", None)
        returned_doc.update({"id": new_id(), "quantity": qty, "status": "returned",
                             "return_date": now_iso(),
                             "received_by_person_id": data.received_by_person_id, "amount_owed": 0})
        await db.loans.insert_one(returned_doc)
        return {"ok": True, "status": "partial", "amount_owed": new_owed}


# ---------------- Dashboard ----------------
@api.get("/dashboard/stats")
async def dashboard_stats(request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    total_items = await db.items.count_documents({"tenant_id": tid})
    active_loans = await db.loans.count_documents({"tenant_id": tid, "status": "borrowed"})
    teams = await db.teams.count_documents({"tenant_id": tid})
    people = await db.people.count_documents({"tenant_id": tid})
    agg = await db.teams.aggregate([{"$match": {"tenant_id": tid}}, {"$group": {"_id": None, "total": {"$sum": "$debt"}}}]).to_list(1)
    team_debt = agg[0]["total"] if agg else 0
    agg2 = await db.people.aggregate([{"$match": {"tenant_id": tid}}, {"$group": {"_id": None, "total": {"$sum": "$debt"}}}]).to_list(1)
    person_debt = agg2[0]["total"] if agg2 else 0
    items = await db.items.find({"tenant_id": tid}, {"_id": 0, "name": 1, "total_stock": 1, "price": 1}).to_list(5000)
    stock_value = sum((i.get("total_stock", 0) * i.get("price", 0)) for i in items)
    low_stock = [i for i in items if i.get("total_stock", 0) <= 3]
    recent = await db.loans.find({"tenant_id": tid}, {"_id": 0}).sort("loan_date", -1).to_list(10)
    return {"total_items": total_items, "active_loans": active_loans, "teams": teams, "people": people,
            "team_debt": team_debt, "person_debt": person_debt, "stock_value": stock_value,
            "low_stock_count": len(low_stock), "low_stock_items": low_stock[:10], "recent_loans": recent}


# ---------------- Stock Audit ----------------
@api.get("/stock-counts")
async def list_stock_counts(request: Request, user=Depends(require_perm("stock_audit", "read"))):
    tid = await require_feature(request, user, "stock_audit")
    return await db.stock_counts.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.post("/stock-counts")
async def start_stock_count(data: StockCountIn, request: Request, user=Depends(require_perm("stock_audit", "write"))):
    tid = await require_feature(request, user, "stock_audit")
    doc = {"id": new_id(), "tenant_id": tid,
           "name": data.name or f"Varetelling {datetime.now().strftime('%Y-%m-%d')}",
           "status": "open", "created_at": now_iso(), "lines": []}
    await db.stock_counts.insert_one(doc)
    return _clean(doc)


@api.post("/stock-counts/{count_id}/lines")
async def add_count_line(count_id: str, data: StockCountLineIn, request: Request, user=Depends(require_perm("stock_audit", "write"))):
    tid = await require_feature(request, user, "stock_audit")
    item = await db.items.find_one({"id": data.item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    if (item.get("is_clothing") or item.get("is_ball")) and data.size:
        system = next((s.get("quantity", 0) for s in item.get("sizes", []) if s["size"] == data.size), 0)
    else:
        system = item.get("total_stock", 0)
    line = {"line_id": new_id(), "item_id": data.item_id, "item_name": item.get("name", ""),
            "size": data.size, "system_quantity": system, "counted_quantity": data.counted_quantity,
            "diff": data.counted_quantity - system, "adjusted": False}
    await db.stock_counts.update_one({"id": count_id, "tenant_id": tid}, {"$push": {"lines": line}})
    return line


@api.post("/stock-counts/{count_id}/apply")
async def apply_stock_count(count_id: str, request: Request, user=Depends(require_perm("stock_audit", "write"))):
    tid = await require_feature(request, user, "stock_audit")
    sc = await db.stock_counts.find_one({"id": count_id, "tenant_id": tid})
    if not sc:
        raise HTTPException(404, "Varetelling ikke funnet")
    for line in sc.get("lines", []):
        item = await db.items.find_one({"id": line["item_id"], "tenant_id": tid})
        if not item:
            continue
        if (item.get("is_clothing") or item.get("is_ball")) and line.get("size"):
            sizes = item.get("sizes", [])
            for s in sizes:
                if s["size"] == line["size"]:
                    s["quantity"] = line["counted_quantity"]
            total = sum(s.get("quantity", 0) for s in sizes)
            await db.items.update_one({"id": item["id"], "tenant_id": tid}, {"$set": {"sizes": sizes, "total_stock": total}})
        else:
            await db.items.update_one({"id": item["id"], "tenant_id": tid}, {"$set": {"total_stock": line["counted_quantity"]}})
    await db.stock_counts.update_one({"id": count_id, "tenant_id": tid}, {"$set": {"status": "applied", "applied_at": now_iso()}})
    return {"ok": True}


# ---------------- Exports ----------------
@api.get("/export/inventory")
async def export_inventory(request: Request, user=Depends(require_perm("inventory", "read"))):
    tid = await require_feature(request, user, "excel_export")
    items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(10000)
    wb = Workbook(); ws = wb.active; ws.title = "Beholdning"
    ws.append(["Varenavn", "Kategori", "Hovedgruppe", "Undergruppe", "Pris", "Beholdning", "Lokasjon",
               "Type", "Størrelse", "Draktnr", "Antall pr str", "Lokasjon pr str"])
    for it in items:
        type_str = "klær" if it.get("is_clothing") else ("ball" if it.get("is_ball") else "vare")
        if (it.get("is_clothing") or it.get("is_ball")) and it.get("sizes"):
            for s in it["sizes"]:
                ws.append([it.get("name"), it.get("category"), it.get("main_group"), it.get("sub_group"),
                           it.get("price"), it.get("total_stock"), it.get("location"), type_str,
                           s.get("size"), s.get("jersey_number"), s.get("quantity"), s.get("location", "")])
        else:
            ws.append([it.get("name"), it.get("category"), it.get("main_group"), it.get("sub_group"),
                       it.get("price"), it.get("total_stock"), it.get("location"), type_str, "", "", "", ""])
    return _xlsx_response(wb, "beholdning.xlsx")


@api.get("/export/team/{team_id}")
async def export_team(team_id: str, request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_feature(request, user, "excel_export")
    team = await db.teams.find_one({"id": team_id, "tenant_id": tid})
    if not team:
        raise HTTPException(404, "Lag ikke funnet")
    loans = await db.loans.find({"team_id": team_id, "tenant_id": tid}, {"_id": 0}).sort("loan_date", -1).to_list(5000)
    pids = list({l.get("person_id") for l in loans if l.get("person_id")} |
                {l.get("received_by_person_id") for l in loans if l.get("received_by_person_id")})
    people = {p["id"]: p for p in await db.people.find({"id": {"$in": pids}, "tenant_id": tid}, {"_id": 0}).to_list(1000)}
    wb = Workbook(); ws = wb.active; ws.title = "Oversikt"
    ws.append(["Lag", team.get("team_name")])
    ws.append(["Aldersklasse", team.get("age_class")])
    ws.append(["Kontaktperson", team.get("contact_person")])
    ws.append(["Epost", team.get("email")])
    ws.append(["Skyldig beløp (NOK)", round(team.get("debt", 0), 2)])
    ws2 = wb.create_sheet("Historikk")
    ws2.append(["Dato utlånt", "Vare", "Antall", "Størrelse", "Draktnr", "Modus", "Hentet av",
                "Status", "Dato returnert", "Mottatt av", "Skyldig"])
    for l in loans:
        ws2.append([l.get("loan_date", ""), l.get("item_name", ""), l.get("quantity", 0),
                    l.get("size") or "", l.get("jersey_number") or "", l.get("mode", ""),
                    people.get(l.get("picked_up_by"), {}).get("name", ""),
                    l.get("status", ""), l.get("return_date") or "",
                    people.get(l.get("received_by_person_id"), {}).get("name", ""),
                    l.get("amount_owed", 0)])
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name", "lag"))
    return _xlsx_response(wb, f"lag_{safe}.xlsx")


app.include_router(api)

app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"], expose_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
