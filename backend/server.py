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

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Utstyrsrommet API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("utstyrsrommet")

# ---------------- Permissions ----------------
MODULES = ["dashboard", "teams", "people", "inventory", "loans", "stock_audit", "users", "settings"]
ACCESS_LEVELS = ["none", "read", "write", "admin"]


def default_perms(level: str = "read") -> Dict[str, str]:
    return {m: level for m in MODULES}


def admin_perms() -> Dict[str, str]:
    return {m: "admin" for m in MODULES}


# ---------------- Password / JWT ----------------
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


def require_perm(module: str, level: str = "read"):
    order = {"none": 0, "read": 1, "write": 2, "admin": 3}

    async def dep(user=Depends(get_current_user)):
        if user.get("role") == "admin":
            return user
        perms = user.get("permissions", {})
        user_level = perms.get(module, "none")
        if order.get(user_level, 0) < order.get(level, 1):
            raise HTTPException(status_code=403, detail=f"Mangler rettighet: {module}:{level}")
        return user

    return dep


def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Kun admin")
    return user


# ---------------- Email (Resend) ----------------
async def send_invitation_email(to: str, name: str, token: str):
    if not EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY mangler - hopper over e-post")
        return None
    link = f"{FRONTEND_URL}/sett-passord?token={token}"
    subject = f"Velkommen til {EMAIL_FROM_NAME}"
    html = (
        f'<table role="presentation" width="100%" style="background:#f8fafc;padding:24px;font-family:Arial,sans-serif">'
        f'<tr><td align="center"><table role="presentation" width="560" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">'
        f'<tr><td>'
        f'<h1 style="color:#064E3B;margin:0 0 16px 0;font-size:24px">Velkommen, {name}!</h1>'
        f'<p style="color:#0f172a;font-size:15px;line-height:1.6">Du har fått tilgang til <strong>{EMAIL_FROM_NAME}</strong> - lagerstyringssystemet for klubben.</p>'
        f'<p style="color:#0f172a;font-size:15px;line-height:1.6">Klikk på knappen nedenfor for å opprette ditt passord og aktivere kontoen.</p>'
        f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#064E3B;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">Opprett passord</a></p>'
        f'<p style="color:#475569;font-size:13px;line-height:1.6">Lenken er gyldig i 7 dager. Hvis du ikke forventet denne eposten, kan du trygt ignorere den.</p>'
        f'<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">'
        f'<p style="color:#94a3b8;font-size:12px">Sendt av {EMAIL_FROM_NAME}. Vi vil aldri be deg om passordet ditt via epost.</p>'
        f'</td></tr></table></td></tr></table>'
    )
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        r.raise_for_status()
        return r.json().get("id")
    except Exception as e:
        logger.error(f"E-post feilet: {e}")
        return None


# ---------------- Models ----------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class SetPasswordIn(BaseModel):
    token: str
    password: str


class UserCreateIn(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = ""
    address: Optional[str] = ""
    role: str = "user"  # admin | user
    permissions: Optional[Dict[str, str]] = None
    password: Optional[str] = None  # if provided, set directly; else send invitation


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
    team_name: str  # e.g. "Jenter 13"
    age_class: str = ""  # e.g. "2019"
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


class ItemIn(BaseModel):
    name: str
    category: str = ""
    main_group: str = ""
    sub_group: str = ""
    price: float = 0.0
    total_stock: int = 0
    location: str = ""
    is_clothing: bool = False
    sizes: List[SizeStock] = Field(default_factory=list)


class LoanIn(BaseModel):
    item_id: str
    quantity: int = 1
    team_id: Optional[str] = None
    person_id: Optional[str] = None  # who picked up
    mode: str = "loan"  # loan | handout
    charge_price: bool = True  # for handout: include price?
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


# ---------------- Startup ----------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.invitations.create_index("token", unique=True)
    await db.teams.create_index("id", unique=True)
    await db.people.create_index("id", unique=True)
    await db.items.create_index("id", unique=True)
    await db.loans.create_index("id", unique=True)
    await db.clubs.create_index("id", unique=True)

    # seed admin
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.users.insert_one({
            "id": new_id(),
            "email": ADMIN_EMAIL,
            "name": ADMIN_NAME,
            "phone": "",
            "address": "",
            "role": "admin",
            "permissions": admin_perms(),
            "active": True,
            "is_super_admin": True,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "created_at": now_iso(),
        })
        logger.info(f"Seedet admin: {ADMIN_EMAIL}")
    else:
        update = {"role": "admin", "is_super_admin": True, "active": True, "permissions": admin_perms()}
        if not verify_password(ADMIN_PASSWORD, existing.get("password_hash", "")):
            update["password_hash"] = hash_password(ADMIN_PASSWORD)
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": update})

    # seed default club
    clubs = await db.clubs.count_documents({})
    if clubs == 0:
        await db.clubs.insert_one({"id": new_id(), "name": "Min Idrettsklubb", "org_number": "", "logo_url": "", "created_at": now_iso()})


def _cookie_response(resp: Response, token: str):
    resp.set_cookie(
        key="access_token", value=token, httponly=True, secure=True, samesite="none",
        max_age=12 * 3600, path="/"
    )


def _clean(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


# ---------------- Auth routes ----------------
@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Feil e-post eller passord")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Konto deaktivert")
    token = create_access_token(user["id"], user["email"])
    _cookie_response(response, token)
    return {"user": _clean(dict(user)), "token": token}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api.get("/auth/invitation/{token}")
async def check_invitation(token: str):
    inv = await db.invitations.find_one({"token": token})
    if not inv:
        raise HTTPException(status_code=404, detail="Ugyldig invitasjon")
    if inv.get("used"):
        raise HTTPException(status_code=400, detail="Invitasjon er allerede brukt")
    user = await db.users.find_one({"id": inv["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"email": user["email"], "name": user["name"]}


@api.post("/auth/set-password")
async def set_password(data: SetPasswordIn, response: Response):
    inv = await db.invitations.find_one({"token": data.token})
    if not inv or inv.get("used"):
        raise HTTPException(status_code=400, detail="Ugyldig eller brukt invitasjon")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Passord må være minst 6 tegn")
    await db.users.update_one({"id": inv["user_id"]}, {"$set": {"password_hash": hash_password(data.password), "active": True}})
    await db.invitations.update_one({"token": data.token}, {"$set": {"used": True, "used_at": now_iso()}})
    user = await db.users.find_one({"id": inv["user_id"]}, {"_id": 0, "password_hash": 0})
    token = create_access_token(user["id"], user["email"])
    _cookie_response(response, token)
    return {"user": user, "token": token}


# ---------------- Users (admin) ----------------
@api.get("/users")
async def list_users(user=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users


@api.post("/users")
async def create_user(data: UserCreateIn, admin=Depends(require_admin)):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-post finnes allerede")
    uid = new_id()
    perms = data.permissions if data.permissions else (admin_perms() if data.role == "admin" else default_perms("read"))
    user_doc = {
        "id": uid, "email": email, "name": data.name, "phone": data.phone or "", "address": data.address or "",
        "role": data.role, "permissions": perms, "active": True, "is_super_admin": False,
        "password_hash": hash_password(data.password) if data.password else "",
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    inv_token = None
    if not data.password:
        inv_token = pysecrets.token_urlsafe(32)
        await db.invitations.insert_one({
            "token": inv_token, "user_id": uid, "created_at": now_iso(), "used": False,
        })
        await send_invitation_email(email, data.name, inv_token)
    _clean(user_doc)
    return {"user": user_doc, "invitation_sent": not data.password, "invitation_link": f"{FRONTEND_URL}/sett-passord?token={inv_token}" if inv_token else None}


@api.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdateIn, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Bruker ikke funnet")
    update = {k: v for k, v in data.dict(exclude_unset=True).items() if k != "password"}
    if target.get("is_super_admin"):
        # super admin cannot be demoted or deactivated
        update.pop("role", None)
        update.pop("active", None)
    if data.password:
        update["password_hash"] = hash_password(data.password)
    await db.users.update_one({"id": user_id}, {"$set": update})
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return user


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Bruker ikke funnet")
    if target.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Kan ikke slette overordnet admin")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


@api.post("/users/{user_id}/resend-invitation")
async def resend_invite(user_id: str, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Bruker ikke funnet")
    inv_token = pysecrets.token_urlsafe(32)
    await db.invitations.insert_one({"token": inv_token, "user_id": user_id, "created_at": now_iso(), "used": False})
    await send_invitation_email(target["email"], target["name"], inv_token)
    return {"ok": True, "invitation_link": f"{FRONTEND_URL}/sett-passord?token={inv_token}"}


# ---------------- Clubs ----------------
@api.get("/clubs")
async def list_clubs(user=Depends(get_current_user)):
    return await db.clubs.find({}, {"_id": 0}).to_list(100)


@api.post("/clubs")
async def create_club(data: ClubIn, user=Depends(require_perm("settings", "write"))):
    doc = {"id": new_id(), "name": data.name, "org_number": data.org_number, "logo_url": data.logo_url, "created_at": now_iso()}
    await db.clubs.insert_one(doc)
    return _clean(doc)


@api.put("/clubs/{club_id}")
async def update_club(club_id: str, data: ClubIn, user=Depends(require_perm("settings", "write"))):
    await db.clubs.update_one({"id": club_id}, {"$set": data.dict()})
    return await db.clubs.find_one({"id": club_id}, {"_id": 0})


@api.delete("/clubs/{club_id}")
async def delete_club(club_id: str, user=Depends(require_admin)):
    await db.clubs.delete_one({"id": club_id})
    return {"ok": True}


# ---------------- Teams ----------------
@api.get("/teams")
async def list_teams(user=Depends(require_perm("teams", "read"))):
    return await db.teams.find({}, {"_id": 0}).to_list(1000)


@api.post("/teams")
async def create_team(data: TeamIn, user=Depends(require_perm("teams", "write"))):
    doc = data.dict()
    doc["id"] = new_id()
    doc["debt"] = 0.0
    doc["created_at"] = now_iso()
    await db.teams.insert_one(doc)
    return _clean(doc)


@api.get("/teams/{team_id}")
async def get_team(team_id: str, user=Depends(require_perm("teams", "read"))):
    t = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Lag ikke funnet")
    return t


@api.put("/teams/{team_id}")
async def update_team(team_id: str, data: TeamIn, user=Depends(require_perm("teams", "write"))):
    await db.teams.update_one({"id": team_id}, {"$set": data.dict()})
    return await db.teams.find_one({"id": team_id}, {"_id": 0})


@api.delete("/teams/{team_id}")
async def delete_team(team_id: str, user=Depends(require_perm("teams", "admin"))):
    await db.teams.delete_one({"id": team_id})
    return {"ok": True}


# ---------------- People ----------------
@api.get("/people")
async def list_people(user=Depends(require_perm("people", "read"))):
    return await db.people.find({}, {"_id": 0}).to_list(2000)


@api.post("/people")
async def create_person(data: PersonIn, user=Depends(require_perm("people", "write"))):
    doc = data.dict()
    doc["id"] = new_id()
    doc["debt"] = 0.0
    doc["created_at"] = now_iso()
    await db.people.insert_one(doc)
    return _clean(doc)


@api.get("/people/{person_id}")
async def get_person(person_id: str, user=Depends(require_perm("people", "read"))):
    p = await db.people.find_one({"id": person_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Person ikke funnet")
    # Team debts for teams person is linked to
    teams = await db.teams.find({"id": {"$in": p.get("team_ids", [])}}, {"_id": 0}).to_list(100)
    # Loan history for person
    history = await db.loans.find({"person_id": person_id}, {"_id": 0}).sort("loan_date", -1).to_list(500)
    return {"person": p, "teams": teams, "history": history}


@api.put("/people/{person_id}")
async def update_person(person_id: str, data: PersonIn, user=Depends(require_perm("people", "write"))):
    await db.people.update_one({"id": person_id}, {"$set": data.dict()})
    return await db.people.find_one({"id": person_id}, {"_id": 0})


@api.delete("/people/{person_id}")
async def delete_person(person_id: str, user=Depends(require_perm("people", "admin"))):
    await db.people.delete_one({"id": person_id})
    return {"ok": True}


# ---------------- Items ----------------
@api.get("/items")
async def list_items(user=Depends(require_perm("inventory", "read"))):
    return await db.items.find({}, {"_id": 0}).to_list(5000)


@api.post("/items")
async def create_item(data: ItemIn, user=Depends(require_perm("inventory", "write"))):
    doc = data.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    # ensure jersey_number default X
    if doc.get("is_clothing"):
        for s in doc["sizes"]:
            if not s.get("jersey_number"):
                s["jersey_number"] = "X"
        doc["total_stock"] = sum(s.get("quantity", 0) for s in doc["sizes"])
    await db.items.insert_one(doc)
    return _clean(doc)


@api.put("/items/{item_id}")
async def update_item(item_id: str, data: ItemIn, user=Depends(require_perm("inventory", "write"))):
    doc = data.dict()
    if doc.get("is_clothing"):
        for s in doc["sizes"]:
            if not s.get("jersey_number"):
                s["jersey_number"] = "X"
        doc["total_stock"] = sum(s.get("quantity", 0) for s in doc["sizes"])
    await db.items.update_one({"id": item_id}, {"$set": doc})
    return await db.items.find_one({"id": item_id}, {"_id": 0})


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, user=Depends(require_perm("inventory", "admin"))):
    await db.items.delete_one({"id": item_id})
    return {"ok": True}


# ---------------- Items: Excel Import ----------------
IMPORT_COLUMNS = ["Varenavn", "Kategori", "Hovedgruppe", "Undergruppe", "Pris", "Lokasjon", "Klær (ja/nei)", "Størrelse", "Draktnr", "Antall"]


@api.get("/items/import/template")
async def items_import_template(user=Depends(require_perm("inventory", "write"))):
    wb = Workbook()
    ws = wb.active
    ws.title = "Varer"
    ws.append(IMPORT_COLUMNS)
    # Examples
    ws.append(["Ball Adidas", "Baller", "Trening", "Fotball", 299, "Hylle A1", "nei", "", "", 20])
    ws.append(["Hjemmedrakt", "Klær", "Drakt", "Hjemme", 450, "Skap B2", "ja", "S", "X", 5])
    ws.append(["Hjemmedrakt", "Klær", "Drakt", "Hjemme", 450, "Skap B2", "ja", "M", "10", 8])
    ws.append(["Hjemmedrakt", "Klær", "Drakt", "Hjemme", 450, "Skap B2", "ja", "L", "X", 6])
    info = wb.create_sheet("Instruksjoner")
    info.append(["UTSTYRSROMMET - Import-mal for varer"])
    info.append([])
    info.append(["Kolonner (må være i denne rekkefølgen):"])
    for c in IMPORT_COLUMNS:
        info.append([f"- {c}"])
    info.append([])
    info.append(["Regler:"])
    info.append(["- 'Klær (ja/nei)' = 'ja' betyr at Størrelse/Draktnr/Antall gjelder én størrelse."])
    info.append(["- For klær: legg til én rad per størrelse. Samme Varenavn grupperes automatisk."])
    info.append(["- For ikke-klær: fyll 'Antall' med total beholdning. La Størrelse/Draktnr stå tomme."])
    info.append(["- Draktnr: bruk 'X' hvis draktnummer mangler."])
    info.append(["- Pris i NOK (tall, uten valuta)."])
    return _xlsx_response(wb, "utstyrsrommet_import_mal.xlsx")


@api.post("/items/import")
async def items_import(file: UploadFile = File(...), user=Depends(require_perm("inventory", "write"))):
    content = await file.read()
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Kunne ikke lese Excel-fil")
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(status_code=400, detail="Tom fil")
    header = [str(h or "").strip() for h in rows[0]]
    expected = [h.lower() for h in IMPORT_COLUMNS]
    if [h.lower() for h in header[:len(expected)]] != expected:
        raise HTTPException(status_code=400, detail=f"Feil kolonner. Forventet: {', '.join(IMPORT_COLUMNS)}")

    grouped: Dict[str, Dict[str, Any]] = {}
    errors: List[str] = []
    for idx, row in enumerate(rows[1:], start=2):
        if row is None or all(v is None or (isinstance(v, str) and not v.strip()) for v in row):
            continue
        try:
            name = (str(row[0]) if row[0] is not None else "").strip()
            if not name:
                continue
            category = (str(row[1]) if row[1] is not None else "").strip()
            main_group = (str(row[2]) if row[2] is not None else "").strip()
            sub_group = (str(row[3]) if row[3] is not None else "").strip()
            price = float(row[4]) if row[4] not in (None, "") else 0.0
            location = (str(row[5]) if row[5] is not None else "").strip()
            is_cloth_raw = (str(row[6]) if row[6] is not None else "").strip().lower()
            is_clothing = is_cloth_raw in ("ja", "yes", "y", "true", "1")
            size = (str(row[7]) if row[7] is not None else "").strip()
            jersey = (str(row[8]) if row[8] is not None else "").strip() or "X"
            qty = int(row[9]) if row[9] not in (None, "") else 0

            key = f"{name}||{category}||{main_group}||{sub_group}"
            if key not in grouped:
                grouped[key] = {
                    "id": new_id(), "name": name, "category": category, "main_group": main_group,
                    "sub_group": sub_group, "price": price, "location": location,
                    "is_clothing": is_clothing, "sizes": [], "total_stock": 0,
                    "created_at": now_iso(),
                }
            doc = grouped[key]
            if is_clothing:
                doc["is_clothing"] = True
                doc["sizes"].append({"size": size, "jersey_number": jersey, "quantity": qty})
            else:
                doc["total_stock"] = (doc.get("total_stock") or 0) + qty
        except Exception as e:
            errors.append(f"Rad {idx}: {e}")

    created = 0
    for key, doc in grouped.items():
        if doc.get("is_clothing"):
            doc["total_stock"] = sum(s.get("quantity", 0) for s in doc["sizes"])
        await db.items.insert_one(doc)
        created += 1

    return {"created": created, "errors": errors}


# ---------------- Loans ----------------
async def _adjust_stock(item_id: str, delta: int, size: Optional[str] = None):
    item = await db.items.find_one({"id": item_id})
    if not item:
        return
    if item.get("is_clothing") and size:
        sizes = item.get("sizes", [])
        for s in sizes:
            if s["size"] == size:
                s["quantity"] = max(0, s.get("quantity", 0) + delta)
        total = sum(s.get("quantity", 0) for s in sizes)
        await db.items.update_one({"id": item_id}, {"$set": {"sizes": sizes, "total_stock": total}})
    else:
        new_total = max(0, item.get("total_stock", 0) + delta)
        await db.items.update_one({"id": item_id}, {"$set": {"total_stock": new_total}})


@api.get("/loans")
async def list_loans(status: Optional[str] = None, team_id: Optional[str] = None, person_id: Optional[str] = None,
                     user=Depends(require_perm("loans", "read"))):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if team_id:
        q["team_id"] = team_id
    if person_id:
        q["person_id"] = person_id
    return await db.loans.find(q, {"_id": 0}).sort("loan_date", -1).to_list(2000)


@api.post("/loans")
async def create_loan(data: LoanIn, user=Depends(require_perm("loans", "write"))):
    item = await db.items.find_one({"id": data.item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Vare ikke funnet")
    # check availability
    if item.get("is_clothing") and data.size:
        avail = next((s.get("quantity", 0) for s in item.get("sizes", []) if s["size"] == data.size), 0)
    else:
        avail = item.get("total_stock", 0)
    if data.quantity > avail:
        raise HTTPException(status_code=400, detail=f"Ikke nok på lager (tilgjengelig: {avail})")

    price = float(item.get("price", 0))
    charge = price * data.quantity
    if data.mode == "handout" and not data.charge_price:
        charge = 0.0

    loan_doc = {
        "id": new_id(),
        "item_id": data.item_id,
        "item_name": item.get("name", ""),
        "quantity": data.quantity,
        "size": data.size,
        "jersey_number": data.jersey_number,
        "team_id": data.team_id,
        "person_id": data.person_id,
        "mode": data.mode,
        "unit_price": price,
        "amount_owed": charge,
        "status": "borrowed",
        "loan_date": now_iso(),
        "picked_up_by": data.person_id,
        "return_date": None,
        "received_by_person_id": None,
        "notes": data.notes,
    }
    await db.loans.insert_one(loan_doc)
    await _adjust_stock(data.item_id, -data.quantity, data.size)

    if charge > 0:
        if data.team_id:
            await db.teams.update_one({"id": data.team_id}, {"$inc": {"debt": charge}})
        if data.person_id:
            await db.people.update_one({"id": data.person_id}, {"$inc": {"debt": charge}})

    return _clean(loan_doc)


@api.post("/loans/{loan_id}/return")
async def return_loan(loan_id: str, data: ReturnIn, user=Depends(require_perm("loans", "write"))):
    loan = await db.loans.find_one({"id": loan_id})
    if not loan:
        raise HTTPException(status_code=404, detail="Utlån ikke funnet")
    if loan.get("status") == "returned":
        raise HTTPException(status_code=400, detail="Allerede returnert")
    qty = min(data.quantity, loan["quantity"])
    # proportional owed amount
    unit_owed = (loan.get("amount_owed", 0) / loan["quantity"]) if loan["quantity"] else 0
    owed_reduce = unit_owed * qty

    await _adjust_stock(loan["item_id"], qty, loan.get("size"))

    if owed_reduce > 0:
        if loan.get("team_id"):
            await db.teams.update_one({"id": loan["team_id"]}, {"$inc": {"debt": -owed_reduce}})
        if loan.get("person_id"):
            await db.people.update_one({"id": loan["person_id"]}, {"$inc": {"debt": -owed_reduce}})

    if qty >= loan["quantity"]:
        await db.loans.update_one({"id": loan_id}, {"$set": {
            "status": "returned", "return_date": now_iso(),
            "received_by_person_id": data.received_by_person_id,
            "amount_owed": 0,
        }})
        return {"ok": True, "status": "returned", "amount_owed": 0}
    else:
        # partial return - split
        remaining = loan["quantity"] - qty
        new_owed = loan.get("amount_owed", 0) - owed_reduce
        await db.loans.update_one({"id": loan_id}, {"$set": {
            "quantity": remaining,
            "amount_owed": new_owed,
        }})
        returned_doc = {**loan}
        returned_doc.pop("_id", None)
        returned_doc.update({
            "id": new_id(), "quantity": qty, "status": "returned",
            "return_date": now_iso(),
            "received_by_person_id": data.received_by_person_id,
            "amount_owed": 0,
        })
        await db.loans.insert_one(returned_doc)
        return {"ok": True, "status": "partial", "amount_owed": new_owed}


# ---------------- Dashboard ----------------
@api.get("/dashboard/stats")
async def dashboard_stats(user=Depends(get_current_user)):
    total_items = await db.items.count_documents({})
    active_loans = await db.loans.count_documents({"status": "borrowed"})
    teams = await db.teams.count_documents({})
    people = await db.people.count_documents({})
    agg = await db.teams.aggregate([{"$group": {"_id": None, "total": {"$sum": "$debt"}}}]).to_list(1)
    team_debt = agg[0]["total"] if agg else 0
    agg2 = await db.people.aggregate([{"$group": {"_id": None, "total": {"$sum": "$debt"}}}]).to_list(1)
    person_debt = agg2[0]["total"] if agg2 else 0
    items = await db.items.find({}, {"_id": 0, "name": 1, "total_stock": 1, "price": 1}).to_list(5000)
    stock_value = sum((i.get("total_stock", 0) * i.get("price", 0)) for i in items)
    low_stock = [i for i in items if i.get("total_stock", 0) <= 3]
    recent = await db.loans.find({}, {"_id": 0}).sort("loan_date", -1).to_list(10)
    return {
        "total_items": total_items,
        "active_loans": active_loans,
        "teams": teams,
        "people": people,
        "team_debt": team_debt,
        "person_debt": person_debt,
        "stock_value": stock_value,
        "low_stock_count": len(low_stock),
        "low_stock_items": low_stock[:10],
        "recent_loans": recent,
    }


# ---------------- Stock Audit ----------------
@api.get("/stock-counts")
async def list_stock_counts(user=Depends(require_perm("stock_audit", "read"))):
    return await db.stock_counts.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.post("/stock-counts")
async def start_stock_count(data: StockCountIn, user=Depends(require_perm("stock_audit", "write"))):
    doc = {"id": new_id(), "name": data.name or f"Varetelling {datetime.now().strftime('%Y-%m-%d')}", "status": "open", "created_at": now_iso(), "lines": []}
    await db.stock_counts.insert_one(doc)
    return _clean(doc)


@api.post("/stock-counts/{count_id}/lines")
async def add_count_line(count_id: str, data: StockCountLineIn, user=Depends(require_perm("stock_audit", "write"))):
    item = await db.items.find_one({"id": data.item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Vare ikke funnet")
    if item.get("is_clothing") and data.size:
        system = next((s.get("quantity", 0) for s in item.get("sizes", []) if s["size"] == data.size), 0)
    else:
        system = item.get("total_stock", 0)
    line = {
        "line_id": new_id(), "item_id": data.item_id, "item_name": item.get("name", ""),
        "size": data.size, "system_quantity": system, "counted_quantity": data.counted_quantity,
        "diff": data.counted_quantity - system, "adjusted": False,
    }
    await db.stock_counts.update_one({"id": count_id}, {"$push": {"lines": line}})
    return line


@api.post("/stock-counts/{count_id}/apply")
async def apply_stock_count(count_id: str, user=Depends(require_perm("stock_audit", "write"))):
    sc = await db.stock_counts.find_one({"id": count_id})
    if not sc:
        raise HTTPException(status_code=404, detail="Varetelling ikke funnet")
    for line in sc.get("lines", []):
        if line.get("adjusted"):
            continue
        item = await db.items.find_one({"id": line["item_id"]})
        if not item:
            continue
        if item.get("is_clothing") and line.get("size"):
            sizes = item.get("sizes", [])
            for s in sizes:
                if s["size"] == line["size"]:
                    s["quantity"] = line["counted_quantity"]
            total = sum(s.get("quantity", 0) for s in sizes)
            await db.items.update_one({"id": item["id"]}, {"$set": {"sizes": sizes, "total_stock": total}})
        else:
            await db.items.update_one({"id": item["id"]}, {"$set": {"total_stock": line["counted_quantity"]}})
    await db.stock_counts.update_one({"id": count_id}, {"$set": {"status": "applied", "applied_at": now_iso()}})
    return {"ok": True}


# ---------------- Excel Exports ----------------
def _xlsx_response(wb: Workbook, filename: str):
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@api.get("/export/inventory")
async def export_inventory(user=Depends(require_perm("inventory", "read"))):
    items = await db.items.find({}, {"_id": 0}).to_list(10000)
    wb = Workbook()
    ws = wb.active
    ws.title = "Beholdning"
    ws.append(["Varenavn", "Kategori", "Hovedgruppe", "Undergruppe", "Pris", "Beholdning", "Lokasjon", "Størrelse", "Draktnr", "Antall pr str"])
    for it in items:
        if it.get("is_clothing") and it.get("sizes"):
            for s in it["sizes"]:
                ws.append([it.get("name"), it.get("category"), it.get("main_group"), it.get("sub_group"),
                           it.get("price"), it.get("total_stock"), it.get("location"), s.get("size"), s.get("jersey_number"), s.get("quantity")])
        else:
            ws.append([it.get("name"), it.get("category"), it.get("main_group"), it.get("sub_group"),
                       it.get("price"), it.get("total_stock"), it.get("location"), "", "", ""])
    return _xlsx_response(wb, "beholdning.xlsx")


@api.get("/export/team/{team_id}")
async def export_team(team_id: str, user=Depends(require_perm("teams", "read"))):
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Lag ikke funnet")
    loans = await db.loans.find({"team_id": team_id}, {"_id": 0}).sort("loan_date", -1).to_list(5000)
    people_ids = list({l.get("person_id") for l in loans if l.get("person_id")} |
                      {l.get("received_by_person_id") for l in loans if l.get("received_by_person_id")})
    people = {p["id"]: p for p in await db.people.find({"id": {"$in": people_ids}}, {"_id": 0}).to_list(1000)}

    wb = Workbook()
    ws = wb.active
    ws.title = "Oversikt"
    ws.append(["Lag", team.get("team_name")])
    ws.append(["Aldersklasse", team.get("age_class")])
    ws.append(["Kontaktperson", team.get("contact_person")])
    ws.append(["Epost", team.get("email")])
    ws.append(["Skyldig beløp (NOK)", round(team.get("debt", 0), 2)])

    ws2 = wb.create_sheet("Historikk")
    ws2.append(["Dato utlånt", "Vare", "Antall", "Størrelse", "Draktnr", "Modus", "Hentet av", "Status", "Dato returnert", "Mottatt av", "Skyldig"])
    for l in loans:
        picked = people.get(l.get("picked_up_by"), {}).get("name", "")
        recv = people.get(l.get("received_by_person_id"), {}).get("name", "")
        ws2.append([l.get("loan_date", ""), l.get("item_name", ""), l.get("quantity", 0),
                    l.get("size") or "", l.get("jersey_number") or "", l.get("mode", ""), picked,
                    l.get("status", ""), l.get("return_date") or "", recv, l.get("amount_owed", 0)])
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name", "lag"))
    return _xlsx_response(wb, f"lag_{safe_name}.xlsx")


# ---------------- Logo upload ----------------
@api.post("/clubs/{club_id}/logo")
async def upload_logo(club_id: str, file: UploadFile = File(...), user=Depends(require_perm("settings", "write"))):
    import base64
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo for stor (maks 2MB)")
    b64 = base64.b64encode(data).decode()
    data_url = f"data:{file.content_type};base64,{b64}"
    await db.clubs.update_one({"id": club_id}, {"$set": {"logo_url": data_url}})
    return {"logo_url": data_url}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
