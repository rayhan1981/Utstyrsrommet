from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import re
import uuid
import asyncio
import logging
import secrets as pysecrets
import hashlib
import base64 as _b64mod
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

import bcrypt
import jwt
import httpx
import stripe
from cryptography.fernet import Fernet, InvalidToken
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
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Utstyrsrommet API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("utstyrsrommet")

# ---------------- Plans ----------------
PLANS: Dict[str, Dict[str, Any]] = {
    "free": {
        "key": "free", "name": "Gratis", "price": 0, "lookup_key": "",
        "max_teams": 1, "max_users": 0,
        "stock_audit": False, "excel_export": False, "excel_import": False,
        "logo_upload": False, "settings": False,
        "features": ["Manuell gratis-tilgang gitt av plattformeier"],
    },
    "basic": {
        "key": "basic", "name": "Klubb Basic", "price": 399, "lookup_key": "utr_basic_monthly",
        "max_teams": 3, "max_users": 0,  # no extra users beyond admin
        "stock_audit": False, "excel_export": False, "excel_import": False,
        "logo_upload": False, "settings": False,
        "features": ["Dashboard", "Inntil 3 lag", "Personer", "Utstyr", "Utlån & Retur", "1 admin-bruker"],
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
        "qr_codes": True, "product_images": True,
        "features": ["Alt i Pro", "Ubegrenset lag", "5 ekstra brukere inkludert", "Kjøp flere brukere for 199,-/mnd", "Excel-import m/mal", "Klubbinnstillinger + logo", "Produktbilder", "QR-koder for utstyr", "Prioritert support"],
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
        # Block tenant users if customer is deactivated/deleted
        if user.get("role") != "platform_owner" and user.get("tenant_id"):
            cust = await db.customers.find_one({"id": user["tenant_id"]}, {"status": 1, "deleted_at": 1})
            if cust:
                if cust.get("deleted_at"):
                    raise HTTPException(status_code=403, detail="Kundekonto er slettet")
                if cust.get("status") == "inactive":
                    raise HTTPException(status_code=403, detail="Kundekonto er deaktivert")
        # Heartbeat: update last_seen (used to determine online/offline)
        try:
            await db.users.update_one({"id": user["id"]}, {"$set": {"last_seen": now_iso()}})
        except Exception:
            pass
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
    # Aktiv prøveperiode = full Deluxe
    if cust.get("subscription_status") == "trial":
        end = cust.get("trial_end_date") or cust.get("trial_ends_at")
        if end and datetime.fromisoformat(end) > datetime.now(timezone.utc):
            return PLANS["deluxe"]
    return PLANS.get(cust.get("plan", "basic"), PLANS["basic"])


def _trial_days_left(cust: dict) -> int:
    end = cust.get("trial_end_date") or cust.get("trial_ends_at")
    if not end:
        return 0
    try:
        delta = datetime.fromisoformat(end) - datetime.now(timezone.utc)
        return max(0, int(delta.total_seconds() // 86400) + (1 if delta.total_seconds() % 86400 > 0 else 0))
    except Exception:
        return 0


async def _sync_subscription_status(tid: str) -> dict:
    """Oppdater kundens subscription_status basert på trial-sluttdato."""
    cust = await db.customers.find_one({"id": tid}, {"_id": 0})
    if not cust:
        return {}
    status = cust.get("subscription_status") or cust.get("status", "trial")
    if status == "trial":
        end = cust.get("trial_end_date") or cust.get("trial_ends_at")
        if end and datetime.fromisoformat(end) < datetime.now(timezone.utc):
            # Trial utløpt – om bruker valgte abonnement, aktiver det. Ellers → expired
            selected = cust.get("selected_plan")
            if selected and selected in PLANS and selected != "free":
                await db.customers.update_one({"id": tid}, {"$set": {
                    "subscription_status": "active", "plan": selected,
                    "subscription_start_date": now_iso(),
                }})
                cust["subscription_status"] = "active"; cust["plan"] = selected
            else:
                await db.customers.update_one({"id": tid}, {"$set": {"subscription_status": "expired"}})
                cust["subscription_status"] = "expired"
    return cust


async def _is_write_allowed(tid: str) -> bool:
    """Returnerer False hvis kunden er i expired/cancelled → read-only. Owner-workspace alltid tillatt."""
    cust = await _sync_subscription_status(tid)
    if cust.get("is_owner_workspace"):
        return True
    status = cust.get("subscription_status") or cust.get("status", "trial")
    return status not in ("expired", "cancelled")


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
        # Platform owner alltid full tilgang
        if user.get("role") == "platform_owner":
            return user
        # For write/admin: sjekk om abonnement tillater skriv
        if order.get(level, 1) >= 2:
            tid = user.get("tenant_id")
            if tid and not await _is_write_allowed(tid):
                raise HTTPException(status_code=402, detail="Aktivt abonnement kreves. Prøveperioden din er avsluttet.")
        if user.get("role") == "admin":
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


async def send_trial_reminder_email(to: str, club_name: str, days_left: int):
    """Send trial expiration reminder (day 5 = 2 days left, day 7 = last day)."""
    if not EMAIL_KEY:
        return None
    link = f"{FRONTEND_URL}/abonnement"
    if days_left <= 0:
        headline = "Prøveperioden din utløper i dag"
        intro = f"Hei {club_name}! I dag er siste dag av den gratis Deluxe-prøveperioden hos <strong>{EMAIL_FROM_NAME}</strong>."
        urgency = "Velg en pakke nå for å unngå at kontoen settes i les-kun-modus i morgen."
        subject = f"Siste dag: {EMAIL_FROM_NAME}-prøveperioden utløper i dag"
    else:
        headline = f"{days_left} dager igjen av prøveperioden"
        intro = f"Hei {club_name}! Du har <strong>{days_left} dager</strong> igjen av den gratis Deluxe-prøveperioden hos <strong>{EMAIL_FROM_NAME}</strong>."
        urgency = "Velg en pakke før perioden utløper, så fortsetter alt sømløst uten tap av data."
        subject = f"{days_left} dager igjen av din {EMAIL_FROM_NAME}-prøveperiode"
    html = (
        f'<table width="100%" style="background:#f8fafc;padding:24px;font-family:Arial,sans-serif">'
        f'<tr><td align="center"><table width="560" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">'
        f'<tr><td><h1 style="color:#064E3B;margin:0 0 16px 0">{headline}</h1>'
        f'<p>{intro}</p><p>{urgency}</p>'
        f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#064E3B;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">Velg pakke nå</a></p>'
        f'<p style="color:#475569;font-size:13px">Priser: Basic 399/mnd, Pro 599/mnd, Deluxe 999/mnd. Ingen bindingstid.</p>'
        f'<p style="color:#94a3b8;font-size:12px;margin-top:24px">Sendt av {EMAIL_FROM_NAME}. Vi ber aldri om passord eller kortinfo per e-post.</p>'
        f'</td></tr></table></td></tr></table>'
    )
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY},
                             json={"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME})
        r.raise_for_status()
        return r.json().get("id")
    except Exception as e:
        logger.error(f"Trial reminder-epost feilet: {e}")
        return None


async def send_payment_receipt_email(to: str, club_name: str, amount_nok: float, plan_label: str, invoice_url: Optional[str] = None, period: Optional[str] = None):
    """Send receipt after successful Stripe payment."""
    if not EMAIL_KEY:
        return None
    amount_str = f"{amount_nok:,.2f}".replace(",", " ").replace(".", ",")
    period_html = f'<p><strong>Periode:</strong> {period}</p>' if period else ''
    link_html = (
        f'<p style="text-align:center;margin:24px 0"><a href="{invoice_url}" style="background:#064E3B;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">Se faktura (PDF)</a></p>'
        if invoice_url and invoice_url.startswith("https://") else ''
    )
    html = (
        f'<table width="100%" style="background:#f8fafc;padding:24px;font-family:Arial,sans-serif">'
        f'<tr><td align="center"><table width="560" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">'
        f'<tr><td><h1 style="color:#064E3B;margin:0 0 16px 0">Takk for betalingen!</h1>'
        f'<p>Hei {club_name},</p>'
        f'<p>Vi har mottatt din betaling for <strong>{EMAIL_FROM_NAME}</strong>.</p>'
        f'<table width="100%" style="background:#f1f5f9;border-radius:6px;padding:16px;margin:16px 0">'
        f'<tr><td><p style="margin:4px 0"><strong>Pakke:</strong> {plan_label}</p>'
        f'<p style="margin:4px 0"><strong>Beløp:</strong> {amount_str} NOK</p>'
        f'{period_html}'
        f'</td></tr></table>'
        f'{link_html}'
        f'<p style="color:#475569;font-size:13px">Dette er din offisielle kvittering. Oppbevar den for regnskapsformål.</p>'
        f'<p style="color:#94a3b8;font-size:12px;margin-top:24px">Sendt av {EMAIL_FROM_NAME}. Spørsmål? Svar på denne e-posten eller kontakt support@utstyrsrommet.no.</p>'
        f'</td></tr></table></td></tr></table>'
    )
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY},
                             json={"to": [to], "subject": f"Kvittering – {EMAIL_FROM_NAME} ({plan_label})", "html": html, "from_name": EMAIL_FROM_NAME})
        r.raise_for_status()
        return r.json().get("id")
    except Exception as e:
        logger.error(f"Kvittering-epost feilet: {e}")
        return None


async def _send_email_with_attachment(to: str, subject: str, body_text: str, filename: str, pdf_b64: str):
    """Send email via Emergent-managed email service with PDF attachment."""
    if not EMAIL_KEY:
        raise RuntimeError("E-posttjeneste ikke konfigurert")
    html = f'<pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">{body_text}</pre>'
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                         headers={"X-Email-Key": EMAIL_KEY},
                         json={
                             "to": [to], "subject": subject, "html": html,
                             "from_name": EMAIL_FROM_NAME,
                             "attachments": [{"filename": filename, "content": pdf_b64, "type": "application/pdf"}],
                         })
    r.raise_for_status()
    return r.json().get("id")


# =========== Tenant-configurable Email (SMTP / Resend / Default) ===========
def _fernet() -> Fernet:
    """Derive a stable Fernet key from JWT_SECRET for encrypting SMTP passwords and Resend keys."""
    digest = hashlib.sha256(JWT_SECRET.encode("utf-8")).digest()
    return Fernet(_b64mod.urlsafe_b64encode(digest))


def _enc(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def _dec(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, Exception):
        return ""


def _mask_secret(s: str, keep: int = 4) -> str:
    if not s:
        return ""
    if len(s) <= keep:
        return "•" * len(s)
    return "•" * (len(s) - keep) + s[-keep:]


async def _get_tenant_email_cfg(tid: str) -> dict:
    cfg = await db.tenant_email_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    return cfg


def _send_smtp_sync(cfg: dict, to: List[str], subject: str, html: str,
                     attachments: Optional[List[dict]] = None,
                     cc: Optional[List[str]] = None) -> dict:
    """Blocking SMTP send. Runs in executor via asyncio.to_thread. Returns {ok, provider_id, error}."""
    try:
        host = cfg.get("smtp_host"); port = int(cfg.get("smtp_port") or 587)
        username = cfg.get("smtp_username"); password = _dec(cfg.get("smtp_password_enc") or "")
        from_email = cfg.get("from_email"); from_name = cfg.get("from_name") or EMAIL_FROM_NAME
        use_ssl = bool(cfg.get("smtp_use_ssl"))
        use_tls = bool(cfg.get("smtp_use_tls", True))
        if not (host and from_email):
            return {"ok": False, "error": "SMTP-vert eller avsender-epost mangler"}
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = formataddr((from_name, from_email))
        msg["To"] = ", ".join(to)
        if cc: msg["Cc"] = ", ".join(cc)
        msg.set_content("E-posten er i HTML-format. Vennligst bruk en moderne e-postklient.")
        msg.add_alternative(html, subtype="html")
        for att in (attachments or []):
            data = _b64mod.b64decode(att.get("content") or "")
            maintype, _, subtype = (att.get("content_type") or "application/octet-stream").partition("/")
            if not subtype: subtype = "octet-stream"
            msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=att.get("filename") or "vedlegg")
        recipients = list(to) + (list(cc) if cc else [])
        if use_ssl:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, timeout=30, context=ctx) as s:
                if username and password: s.login(username, password)
                s.send_message(msg, from_addr=from_email, to_addrs=recipients)
        else:
            with smtplib.SMTP(host, port, timeout=30) as s:
                s.ehlo()
                if use_tls:
                    s.starttls(context=ssl.create_default_context()); s.ehlo()
                if username and password: s.login(username, password)
                s.send_message(msg, from_addr=from_email, to_addrs=recipients)
        return {"ok": True, "provider_id": "smtp:" + new_id()[:8]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _send_resend(cfg: dict, to: List[str], subject: str, html: str,
                        attachments: Optional[List[dict]] = None,
                        cc: Optional[List[str]] = None) -> dict:
    api_key = _dec(cfg.get("resend_api_key_enc") or "")
    from_email = cfg.get("from_email")
    from_name = cfg.get("from_name") or EMAIL_FROM_NAME
    if not (api_key and from_email):
        return {"ok": False, "error": "Resend API-nøkkel eller avsender-epost mangler"}
    payload = {
        "from": f"{from_name} <{from_email}>",
        "to": to, "subject": subject, "html": html,
    }
    if cc: payload["cc"] = cc
    if attachments:
        payload["attachments"] = [{
            "filename": a.get("filename"),
            "content": a.get("content"),  # base64
        } for a in attachments]
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post("https://api.resend.com/emails",
                             headers={"Authorization": f"Bearer {api_key}",
                                      "Content-Type": "application/json"}, json=payload)
        if r.status_code >= 400:
            return {"ok": False, "error": f"Resend {r.status_code}: {r.text[:200]}"}
        return {"ok": True, "provider_id": r.json().get("id")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _send_emergent(to: List[str], subject: str, html: str,
                          attachments: Optional[List[dict]] = None,
                          cc: Optional[List[str]] = None,
                          from_name: Optional[str] = None) -> dict:
    if not EMAIL_KEY:
        return {"ok": False, "error": "E-posttjeneste ikke konfigurert"}
    payload = {
        "to": to, "subject": subject, "html": html,
        "from_name": from_name or EMAIL_FROM_NAME,
    }
    if cc: payload["cc"] = cc
    if attachments:
        # Emergent email proxy forventer feltet 'type' (ikke 'content_type')
        payload["attachments"] = [{
            "filename": a.get("filename"),
            "content": a.get("content"),
            "type": a.get("type") or a.get("content_type") or "application/octet-stream",
        } for a in attachments]
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        r.raise_for_status()
        return {"ok": True, "provider_id": r.json().get("id")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def send_tenant_email(tid: Optional[str], to, subject: str, html: str,
                             attachments: Optional[List[dict]] = None,
                             cc=None) -> dict:
    """Unified email send: uses tenant's own SMTP/Resend if configured, else Emergent default.

    attachments format: [{"filename": str, "content": base64_str, "content_type": mime}]
    Returns: {ok, provider_id, error, method}
    """
    if isinstance(to, str): to = [to]
    if isinstance(cc, str): cc = [cc]
    cfg = await _get_tenant_email_cfg(tid) if tid else {}
    method = (cfg.get("method") or "default").lower()
    from_name = cfg.get("from_name") or EMAIL_FROM_NAME
    if method == "smtp" and cfg.get("smtp_host") and cfg.get("from_email"):
        res = await asyncio.to_thread(_send_smtp_sync, cfg, to, subject, html, attachments, cc)
        res["method"] = "smtp"; return res
    if method == "resend" and cfg.get("resend_api_key_enc") and cfg.get("from_email"):
        res = await _send_resend(cfg, to, subject, html, attachments, cc)
        res["method"] = "resend"; return res
    res = await _send_emergent(to, subject, html, attachments, cc, from_name=from_name)
    res["method"] = "default"
    return res


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
    plan: Optional[str] = None  # Valgfritt – prøveperiode trenger ikke pakke
    accept_terms: bool = False


class ExtendTrialIn(BaseModel):
    days: int = 7


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
    has_qr: bool = False
    image_url: Optional[str] = None
    images: List[str] = Field(default_factory=list)  # Opp til 4 bilder per variasjon
    purchase_price: Optional[float] = None


class ItemIn(BaseModel):
    name: str
    category: str = ""
    main_group: str = ""
    sub_group: str = ""
    price: float = 0.0
    purchase_price: Optional[float] = None
    total_stock: int = 0
    location: str = ""
    is_clothing: bool = False
    is_ball: bool = False
    sizes: List[SizeStock] = Field(default_factory=list)
    has_qr: bool = False
    image_url: Optional[str] = None
    images: List[str] = Field(default_factory=list)  # Opp til 5 bilder for hovedvare
    supplier_id: Optional[str] = None
    supplier_number: Optional[str] = None
    supplier_name: Optional[str] = None


class TenantEmailSettingsIn(BaseModel):
    method: str = "default"  # default | smtp | resend
    from_name: Optional[str] = None
    from_email: Optional[EmailStr] = None
    # SMTP
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 587
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None  # plaintext fra UI
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    # Resend
    resend_api_key: Optional[str] = None  # plaintext fra UI


class EmailTestIn(BaseModel):
    to: Optional[EmailStr] = None


class LoanIn(BaseModel):
    item_id: str
    quantity: int = 1
    size: Optional[str] = None
    jersey_number: Optional[str] = None
    team_id: Optional[str] = None
    person_id: Optional[str] = None
    mode: str = "loan"  # 'loan' or 'handout'
    loan_target: Optional[str] = None  # 'team' | 'person' - overstyrer hvem gjelden havner på
    due_in_days: int = 30  # 7 | 14 | 30
    charge_price: bool = True
    notes: Optional[str] = ""


class ReturnIn(BaseModel):
    quantity: int = 1
    received_by_person_id: Optional[str] = None


class ExtendDueDateIn(BaseModel):
    due_in_days: int = 7  # 7 | 14 | 30


class GenerateQrIn(BaseModel):
    sizes: Optional[List[str]] = None  # Hvis None: alle. Hvis tom liste: ingen. Ellers kun valgte.


class ClubIn(BaseModel):
    name: str
    org_number: str = ""
    logo_url: str = ""
    bank_account: str = ""
    kid_prefix: str = ""


class InvoiceLineIn(BaseModel):
    loan_id: str
    amount: float
    description: str


class InvoiceIn(BaseModel):
    person_id: Optional[str] = None
    team_id: Optional[str] = None
    loan_ids: List[str]
    due_in_days: int = 14
    notes: str = ""


class InvoiceSendIn(BaseModel):
    email: Optional[EmailStr] = None


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


class OwnerCustomerUpdateIn(BaseModel):
    club_name: Optional[str] = None
    owner_name: Optional[str] = None
    owner_email: Optional[EmailStr] = None
    owner_phone: Optional[str] = None
    plan: Optional[str] = None
    extra_user_seats: Optional[int] = None
    custom_price: Optional[float] = None
    status: Optional[str] = None  # "active" | "inactive"
    cancel_stripe: Optional[bool] = False


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
    # 'free' is a manual plan only assignable by platform owner – hidden from public listings
    return [{k: v for k, v in p.items() if k != "lookup_key"} for p in PLANS.values() if p["key"] != "free"]


# ---------------- Auth ----------------
@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Feil e-post eller passord")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Konto deaktivert")
    # Block login if tenant customer is deactivated or soft-deleted
    if user.get("role") != "platform_owner" and user.get("tenant_id"):
        cust = await db.customers.find_one({"id": user["tenant_id"]})
        if cust:
            if cust.get("deleted_at"):
                raise HTTPException(status_code=403, detail="Kundekonto er slettet. Kontakt support for gjenoppretting.")
            if cust.get("status") == "inactive":
                raise HTTPException(status_code=403, detail="Kundekonto er deaktivert. Kontakt support for å reaktivere.")
    token = create_access_token(user["id"], user["email"])
    _cookie(response, "access_token", token)
    # also clear impersonation on login
    response.delete_cookie("imp_cid", path="/")
    # Track login
    now = now_iso()
    ip = None
    try:
        from fastapi import Request as _R  # noqa
    except Exception:
        pass
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now, "last_seen": now}})
    # Close any previous "open" sessions for this user so history stays tidy
    await db.login_history.update_many(
        {"user_id": user["id"], "logged_out_at": None},
        {"$set": {"logged_out_at": now}}
    )
    await db.login_history.insert_one({
        "id": new_id(), "user_id": user["id"], "email": user["email"],
        "tenant_id": user.get("tenant_id"), "logged_in_at": now, "logged_out_at": None,
    })
    return {"user": _clean(dict(user)), "token": token}


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    # Mark newest login_history record as logged out for this user
    token = request.cookies.get("access_token") or (request.headers.get("Authorization", "")[7:] if request.headers.get("Authorization", "").startswith("Bearer ") else None)
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": False})
            uid = payload.get("sub")
            if uid:
                last = await db.login_history.find_one({"user_id": uid, "logged_out_at": None}, sort=[("logged_in_at", -1)])
                if last:
                    await db.login_history.update_one({"id": last["id"]}, {"$set": {"logged_out_at": now_iso()}})
                await db.users.update_one({"id": uid}, {"$set": {"last_seen": None}})
        except Exception:
            pass
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("imp_cid", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(request: Request, user=Depends(get_current_user)):
    tid = await resolve_tenant_id(request, user)
    customer = None
    plan = None
    trial_days_left = 0
    if tid:
        # Sync status før vi returnerer
        customer = await _sync_subscription_status(tid)
        if customer:
            # Effektiv plan: deluxe under trial
            if customer.get("subscription_status") == "trial":
                plan = PLANS["deluxe"]
            else:
                plan = PLANS.get(customer.get("plan", "basic"))
            trial_days_left = _trial_days_left(customer) if customer.get("subscription_status") == "trial" else 0
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
        "trial_days_left": trial_days_left,
        "impersonating": impersonating,
    }


# ---------------- Cron: Trial reminder emails ----------------
async def _run_trial_reminders():
    """Send trial expiration reminders. Day 5 (2 days left) and day 7 (last day).
    Idempotent via `trial_reminders_sent` set on the customer document."""
    now = datetime.now(timezone.utc)
    cursor = db.customers.find({
        "is_owner_workspace": {"$ne": True},
        "status": "trial",
        "deleted_at": None,
    })
    sent_count = 0
    async for cust in cursor:
        end_iso = cust.get("trial_end_date") or cust.get("trial_ends_at")
        if not end_iso:
            continue
        try:
            end_dt = datetime.fromisoformat(end_iso)
        except Exception:
            continue
        days_left = (end_dt.date() - now.date()).days
        if days_left not in (0, 2):
            continue
        tag = "day7" if days_left == 0 else "day5"
        already = cust.get("trial_reminders_sent") or []
        if tag in already:
            continue
        email = cust.get("owner_email")
        if not email:
            continue
        res = await send_trial_reminder_email(
            to=email,
            club_name=cust.get("club_name") or cust.get("owner_name") or "kunde",
            days_left=max(days_left, 0),
        )
        if res is not None:
            await db.customers.update_one(
                {"id": cust["id"]},
                {"$addToSet": {"trial_reminders_sent": tag},
                 "$set": {f"trial_reminder_{tag}_sent_at": now.isoformat()}},
            )
            sent_count += 1
    logger.info(f"Trial reminders: sent {sent_count} emails")
    return sent_count


@api.post("/cron/trial-reminders")
async def cron_trial_reminders(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("authorization", "")
    if not WEBHOOK_CRON_SECRET or not auth.startswith("Bearer "):
        raise HTTPException(401, "Unauthorized")
    token = auth.split(" ", 1)[1].strip()
    if not pysecrets.compare_digest(token, WEBHOOK_CRON_SECRET):
        raise HTTPException(401, "Unauthorized")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("x-webhook-id") or (body.get("run_id") if isinstance(body, dict) else None) or new_id()
    # Idempotency: skip if we've already processed this run_id
    existing = await db.cron_runs.find_one({"run_id": run_id})
    if existing:
        return {"status": "duplicate", "run_id": run_id}
    await db.cron_runs.insert_one({"run_id": run_id, "job": "trial-reminders", "received_at": now_iso()})
    # Hand off actual work
    asyncio.create_task(_run_trial_reminders())
    return {"status": "accepted", "run_id": run_id}


# ---------------- Cron: Due-date reminders for team loans ----------------
async def _run_due_date_reminders():
    """Send e-postvarsel for utlån med nærme/forfalt frist.
    - 14 dager før frist → lagleder (idempotent: reminder_14_sent)
    - 7 dager før frist  → lagleder (idempotent: reminder_7_sent)
    - 1 dag etter frist   → lagleder + kopi til alle admin/aktive brukere (reminder_overdue_sent)
    PDF vedlegges hver melding. Grupperer alle lån per lag + milepel i én e-post.
    """
    now = datetime.now(timezone.utc)
    today = now.date()
    sent = 0
    # Finn lån med team_id, status=borrowed og due_date satt
    cursor = db.loans.find({"team_id": {"$ne": None}, "status": "borrowed", "due_date": {"$ne": None}})
    # Grupper (tenant_id, team_id, milepel) → set av loan_ids
    buckets: Dict[tuple, Dict[str, Any]] = {}
    async for ln in cursor:
        due_iso = ln.get("due_date")
        if not due_iso: continue
        try:
            due_dt = datetime.fromisoformat(due_iso.replace("Z", "+00:00"))
        except Exception:
            continue
        days_until = (due_dt.date() - today).days
        milestone = None; flag = None
        if days_until == 14 and not ln.get("reminder_14_sent"):
            milestone = "14_days_before"; flag = "reminder_14_sent"
        elif days_until == 7 and not ln.get("reminder_7_sent"):
            milestone = "7_days_before"; flag = "reminder_7_sent"
        elif days_until == -1 and not ln.get("reminder_overdue_sent"):
            milestone = "overdue"; flag = "reminder_overdue_sent"
        if not milestone: continue
        key = (ln["tenant_id"], ln["team_id"], milestone)
        b = buckets.setdefault(key, {"loan_ids": [], "flag": flag})
        b["loan_ids"].append(ln["id"])
    for (tid, team_id, milestone), b in buckets.items():
        try:
            pdf_bytes, team, club_name, _ = await _generate_team_equipment_pdf_for_tenant(tid, team_id, None)
            if not team: continue
            tm = team.get("team_manager") or {}; hc = team.get("head_coach") or {}
            to_email = tm.get("email") or hc.get("email") or team.get("email") or ""
            leader_name = tm.get("name") or hc.get("name") or team.get("contact_person") or ""
            if not to_email or not re.match(r"^[^@]+@[^@]+\.[^@]+$", to_email):
                logger.info(f"[due-reminder] Mangler lagleder-epost for team {team_id} ({milestone})")
                continue
            if milestone == "14_days_before":
                subject = f"Påminnelse: Utstyr for {team.get('team_name')} skal returneres om 14 dager"
                lead_html = f"<p>Hei {leader_name},</p><p>Dette er en vennlig påminnelse om at utstyr lånt til <strong>{team.get('team_name')}</strong> har frist for retur om <strong>14 dager</strong>. Vedlagt oversikt over hva som er utestående.</p>"
            elif milestone == "7_days_before":
                subject = f"Påminnelse: Utstyr for {team.get('team_name')} skal returneres om 7 dager"
                lead_html = f"<p>Hei {leader_name},</p><p>Fristen for retur av utstyr lånt til <strong>{team.get('team_name')}</strong> er om <strong>7 dager</strong>. Vedlagt oversikt.</p>"
            else:  # overdue
                subject = f"VIKTIG: Utstyr for {team.get('team_name')} er over frist"
                lead_html = f"<p>Hei {leader_name},</p><p>Utstyr lånt til <strong>{team.get('team_name')}</strong> er nå <strong>over frist</strong>. Vennligst returner snarest. Vedlagt oversikt.</p>"
            html = lead_html + f"<p>Mvh<br/>{club_name}</p>"
            pdf_b64 = _b64mod.b64encode(pdf_bytes).decode()
            safe = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name", "lag"))
            attachments = [{"filename": f"utstyr_{safe}.pdf", "content": pdf_b64, "type": "application/pdf"}]
            # Overdue → kopi til alle aktive brukere i tenanten
            cc_list = []
            if milestone == "overdue":
                users = await db.users.find({"tenant_id": tid, "active": True, "email": {"$ne": to_email}},
                                              {"_id": 0, "email": 1}).to_list(500)
                cc_list = [u["email"] for u in users if u.get("email")]
            res = await send_tenant_email(tid, to_email, subject, html,
                                           attachments=attachments, cc=cc_list or None)
            if res.get("ok"):
                await db.loans.update_many(
                    {"id": {"$in": b["loan_ids"]}, "tenant_id": tid},
                    {"$set": {b["flag"]: True, f"{b['flag']}_at": now.isoformat()}},
                )
                sent += 1
            else:
                logger.error(f"[due-reminder] Send feilet team={team_id} {milestone}: {res.get('error')}")
        except Exception as e:
            logger.exception(f"[due-reminder] Feil team={team_id} {milestone}: {e}")
    logger.info(f"[due-reminder] Sendt {sent} e-poster")
    return sent


@api.post("/cron/due-date-reminders")
async def cron_due_date_reminders(request: Request):
    auth = request.headers.get("authorization", "")
    if not WEBHOOK_CRON_SECRET or not auth.startswith("Bearer "):
        raise HTTPException(401, "Unauthorized")
    token = auth.split(" ", 1)[1].strip()
    if not pysecrets.compare_digest(token, WEBHOOK_CRON_SECRET):
        raise HTTPException(401, "Unauthorized")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("x-webhook-id") or (body.get("run_id") if isinstance(body, dict) else None) or new_id()
    existing = await db.cron_runs.find_one({"run_id": run_id})
    if existing:
        return {"status": "duplicate", "run_id": run_id}
    await db.cron_runs.insert_one({"run_id": run_id, "job": "due-date-reminders", "received_at": now_iso()})
    asyncio.create_task(_run_due_date_reminders())
    return {"status": "accepted", "run_id": run_id}


# ---------------- Trial admin (platform owner) ----------------
@api.post("/owner/customers/{customer_id}/extend-trial")
async def extend_trial(customer_id: str, data: ExtendTrialIn, user=Depends(require_platform_owner)):
    cust = await db.customers.find_one({"id": customer_id})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    base = cust.get("trial_end_date") or cust.get("trial_ends_at") or now_iso()
    base_dt = datetime.fromisoformat(base)
    new_end = max(base_dt, datetime.now(timezone.utc)) + timedelta(days=int(data.days))
    await db.customers.update_one({"id": customer_id}, {"$set": {
        "subscription_status": "trial", "status": "trial",
        "trial_end_date": new_end.isoformat(), "trial_ends_at": new_end.isoformat(),
    }})
    return {"ok": True, "trial_end_date": new_end.isoformat()}


# ---------------- Trial: select plan during trial (deferred activation) ----------------
class SelectPlanIn(BaseModel):
    plan: str


@api.post("/subscription/select-plan")
async def select_plan(data: SelectPlanIn, request: Request, user=Depends(require_admin)):
    tid = await require_tenant(request, user)
    if data.plan not in PLANS or data.plan == "free":
        raise HTTPException(400, "Ugyldig pakke")
    await db.customers.update_one({"id": tid}, {"$set": {"selected_plan": data.plan}})
    return {"ok": True, "selected_plan": data.plan}


# ---------------- Signup ----------------
@api.post("/signup")
async def signup(data: SignupIn, response: Response):
    if not data.accept_terms:
        raise HTTPException(400, "Du må godta bruksvilkårene for å opprette konto")
    if len(data.password) < 6:
        raise HTTPException(400, "Passord må være minst 6 tegn")
    email = data.owner_email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-post finnes allerede")

    customer_number = await _generate_customer_number()
    tenant_id = new_id()
    now = datetime.now(timezone.utc)
    trial_end = (now + timedelta(days=7))

    customer_doc = {
        "id": tenant_id,
        "customer_number": customer_number,
        "club_name": data.club_name,
        "owner_name": data.owner_name,
        "owner_email": email,
        "owner_phone": data.owner_phone,
        "plan": "deluxe",  # funksjonelt deluxe under trial
        "status": "trial",
        "subscription_status": "trial",
        "trial_start_date": now.isoformat(),
        "trial_end_date": trial_end.isoformat(),
        "trial_ends_at": trial_end.isoformat(),  # beholdes for Stripe-trial-mapping
        "selected_plan": None,
        "subscription_start_date": None,
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
    if data.plan not in PLANS or data.plan == "free":
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
        # Send receipt email + swap 50% coupon → 10% loyalty on yearly renewals
        try:
            cust_id_stripe = obj.get("customer")
            cust_doc = await db.customers.find_one({"stripe_customer_id": cust_id_stripe}) if cust_id_stripe else None
            if cust_doc and cust_doc.get("owner_email"):
                amount_paid = (obj.get("amount_paid") or 0) / 100.0
                currency = (obj.get("currency") or "nok").upper()
                plan_label = PLANS.get(cust_doc.get("plan", ""), {}).get("name", cust_doc.get("plan", "Abonnement"))
                billing_cycle = cust_doc.get("billing_cycle", "monthly")
                plan_label = f"{plan_label} ({'årlig' if billing_cycle == 'yearly' else 'månedlig'})"
                invoice_url = obj.get("hosted_invoice_url") or obj.get("invoice_pdf")
                lines = (obj.get("lines") or {}).get("data") or []
                period = None
                if lines:
                    p = lines[0].get("period") or {}
                    if p.get("start") and p.get("end"):
                        try:
                            s = datetime.fromtimestamp(p["start"], tz=timezone.utc).strftime("%d.%m.%Y")
                            e = datetime.fromtimestamp(p["end"], tz=timezone.utc).strftime("%d.%m.%Y")
                            period = f"{s} – {e}"
                        except Exception:
                            period = None
                if amount_paid > 0 and currency == "NOK":
                    await send_payment_receipt_email(
                        to=cust_doc["owner_email"],
                        club_name=cust_doc.get("club_name") or cust_doc.get("owner_name") or "kunde",
                        amount_nok=amount_paid,
                        plan_label=plan_label,
                        invoice_url=invoice_url,
                        period=period,
                    )
        except Exception as e:
            logger.error(f"Kvittering-epost feilet i webhook: {e}")
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


@api.get("/owner/customers/{customer_id}")
async def owner_get_customer(customer_id: str, user=Depends(require_platform_owner)):
    cust = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    users = await db.users.find({"tenant_id": customer_id}, {"_id": 0, "password_hash": 0}).to_list(500)
    teams_count = await db.teams.count_documents({"tenant_id": customer_id})
    people_count = await db.people.count_documents({"tenant_id": customer_id})
    items_count = await db.items.count_documents({"tenant_id": customer_id})
    loans_count = await db.loans.count_documents({"tenant_id": customer_id})
    return {"customer": cust, "users": users, "counts": {
        "teams": teams_count, "people": people_count, "items": items_count, "loans": loans_count,
        "users": len(users)
    }}


@api.patch("/owner/customers/{customer_id}")
async def owner_patch_customer(customer_id: str, data: OwnerCustomerUpdateIn, user=Depends(require_platform_owner)):
    cust = await db.customers.find_one({"id": customer_id})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    if cust.get("is_owner_workspace"):
        raise HTTPException(400, "Kan ikke endre plattformeiers arbeidsområde")

    update: Dict[str, Any] = {}
    if data.club_name is not None:
        update["club_name"] = data.club_name
    if data.owner_name is not None:
        update["owner_name"] = data.owner_name
    if data.owner_phone is not None:
        update["owner_phone"] = data.owner_phone
    if data.extra_user_seats is not None:
        update["extra_user_seats"] = max(0, int(data.extra_user_seats))
    if data.custom_price is not None:
        update["custom_price"] = float(data.custom_price)

    # Email change: update customer + primary admin user
    if data.owner_email is not None and data.owner_email.lower() != (cust.get("owner_email") or "").lower():
        new_email = data.owner_email.lower()
        clash = await db.users.find_one({"email": new_email})
        if clash and clash.get("tenant_id") != customer_id:
            raise HTTPException(400, "E-post er i bruk av en annen bruker")
        update["owner_email"] = new_email
        await db.users.update_one({"email": cust.get("owner_email", "").lower(), "tenant_id": customer_id}, {"$set": {"email": new_email}})

    # Plan change: optionally cancel Stripe sub
    if data.plan is not None:
        if data.plan not in PLANS:
            raise HTTPException(400, "Ugyldig pakke")
        update["plan"] = data.plan
        if data.cancel_stripe and cust.get("stripe_subscription_id"):
            try:
                stripe.Subscription.delete(cust["stripe_subscription_id"])
            except Exception as e:
                logger.error(f"Stripe cancel ved manuell planendring feilet: {e}")
            update["stripe_subscription_id"] = None
            update["status"] = "active" if data.status is None else data.status

    # Status change
    if data.status is not None:
        if data.status not in ("active", "inactive"):
            raise HTTPException(400, "Status må være 'active' eller 'inactive'")
        update["status"] = data.status

    if update:
        await db.customers.update_one({"id": customer_id}, {"$set": update})
    return await db.customers.find_one({"id": customer_id}, {"_id": 0})


@api.delete("/owner/customers/{customer_id}")
async def owner_delete_customer(customer_id: str, user=Depends(require_platform_owner)):
    """Soft delete: markeres som slettet. Permanent sletting etter 12 måneder (via scheduled task)."""
    cust = await db.customers.find_one({"id": customer_id})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    if cust.get("is_owner_workspace"):
        raise HTTPException(400, "Kan ikke slette plattformeiers arbeidsområde")
    purge_at = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
    await db.customers.update_one({"id": customer_id}, {"$set": {
        "deleted_at": now_iso(), "purge_at": purge_at, "status": "inactive"
    }})
    return {"ok": True, "deleted_at": now_iso(), "purge_at": purge_at}


@api.post("/owner/customers/{customer_id}/restore")
async def owner_restore_customer(customer_id: str, user=Depends(require_platform_owner)):
    cust = await db.customers.find_one({"id": customer_id})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    await db.customers.update_one({"id": customer_id}, {"$unset": {"deleted_at": "", "purge_at": ""}, "$set": {"status": "active"}})
    return {"ok": True}


@api.delete("/owner/customers/{customer_id}/users/{user_id}")
async def owner_delete_tenant_user(customer_id: str, user_id: str, user=Depends(require_platform_owner)):
    target = await db.users.find_one({"id": user_id, "tenant_id": customer_id})
    if not target:
        raise HTTPException(404, "Bruker ikke funnet")
    await db.users.delete_one({"id": user_id, "tenant_id": customer_id})
    return {"ok": True}


@api.delete("/owner/customers/{customer_id}/people/{person_id}")
async def owner_delete_tenant_person(customer_id: str, person_id: str, user=Depends(require_platform_owner)):
    await db.people.delete_one({"id": person_id, "tenant_id": customer_id})
    return {"ok": True}


@api.delete("/owner/customers/{customer_id}/items/{item_id}")
async def owner_delete_tenant_item(customer_id: str, item_id: str, user=Depends(require_platform_owner)):
    await db.items.delete_one({"id": item_id, "tenant_id": customer_id})
    return {"ok": True}


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
    # Online = last_seen innen 5 min
    threshold = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    for u in users:
        last_seen = u.get("last_seen")
        u["online"] = bool(last_seen and last_seen >= threshold)
    return users


@api.get("/users/{user_id}/login-history")
async def user_login_history(user_id: str, request: Request, admin=Depends(require_admin)):
    tid = await require_tenant(request, admin)
    target = await db.users.find_one({"id": user_id, "tenant_id": tid})
    if not target:
        raise HTTPException(404, "Bruker ikke funnet")
    history = await db.login_history.find({"user_id": user_id}, {"_id": 0}).sort("logged_in_at", -1).to_list(500)
    return history


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


async def _sync_team_people(tid: str, team_id: str, team_doc: dict):
    """Opprett eller oppdater personer basert på trenerroller på laget.
    Fjerner også team_id fra personer som ikke lenger er trenere på laget."""
    slots = ["head_coach", "team_manager", "trainer1", "trainer2", "trainer3", "trainer4", "trainer5"]
    current_names = set()
    for slot in slots:
        trainer = team_doc.get(slot) or {}
        name = (trainer.get("name") or "").strip()
        if not name:
            continue
        current_names.add(name)
        phone = (trainer.get("phone") or "").strip()
        email = (trainer.get("email") or "").strip()
        query = {"tenant_id": tid, "name": name}
        if phone:
            query["phone"] = phone
        existing = await db.people.find_one(query)
        if existing:
            team_ids = existing.get("team_ids") or []
            if team_id not in team_ids:
                team_ids.append(team_id)
            update = {"team_ids": team_ids}
            if email and not existing.get("email"):
                update["email"] = email
            if phone and not existing.get("phone"):
                update["phone"] = phone
            await db.people.update_one({"id": existing["id"]}, {"$set": update})
        else:
            await db.people.insert_one({
                "id": new_id(), "tenant_id": tid, "name": name,
                "phone": phone, "email": email, "team_ids": [team_id],
                "debt": 0.0, "auto_created_from_team": True, "created_at": now_iso(),
            })

    # Remove team_id from people who were trainers but are no longer in the team
    former_trainers = db.people.find({
        "tenant_id": tid, "team_ids": team_id, "auto_created_from_team": True,
        "name": {"$nin": list(current_names)} if current_names else {"$exists": True}
    })
    async for p in former_trainers:
        new_team_ids = [t for t in (p.get("team_ids") or []) if t != team_id]
        await db.people.update_one({"id": p["id"]}, {"$set": {"team_ids": new_team_ids}})


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
    await _sync_team_people(tid, doc["id"], doc)
    return _clean(doc)


@api.get("/teams/{team_id}")
async def get_team(team_id: str, request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    t = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Lag ikke funnet")
    people = await db.people.find({"tenant_id": tid, "team_ids": team_id}, {"_id": 0}).to_list(500)
    history = await db.loans.find({"team_id": team_id, "tenant_id": tid}, {"_id": 0}).sort("loan_date", -1).to_list(500)
    return {"team": t, "people": people, "history": history}


@api.put("/teams/{team_id}")
async def update_team(team_id: str, data: TeamIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    await db.teams.update_one({"id": team_id, "tenant_id": tid}, {"$set": data.dict()})
    team_doc = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})
    if team_doc:
        await _sync_team_people(tid, team_id, team_doc)
    return team_doc


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
    plan = await get_tenant_plan(tid)
    is_deluxe = bool(plan.get("qr_codes")) or user.get("role") == "platform_owner"
    allow_images = bool(plan.get("product_images")) or user.get("role") == "platform_owner"
    if not allow_images:
        doc["image_url"] = None
        doc["images"] = []
        for s in doc.get("sizes", []):
            s["image_url"] = None
            s["images"] = []
    else:
        doc["images"] = (doc.get("images") or [])[:5]
        if doc["images"] and not doc.get("image_url"): doc["image_url"] = doc["images"][0]
        for s in doc.get("sizes", []):
            s["images"] = (s.get("images") or [])[:4]
            if s["images"] and not s.get("image_url"): s["image_url"] = s["images"][0]
    # Auto-mark has_qr for new items on Deluxe plan
    if is_deluxe:
        if doc.get("is_clothing") or doc.get("is_ball"):
            for s in doc.get("sizes", []):
                s["has_qr"] = True
            doc["has_qr"] = True  # samle-flag: all sizes har QR
        else:
            doc["has_qr"] = True
    doc.update({"id": new_id(), "tenant_id": tid, "created_at": now_iso()})
    await db.items.insert_one(doc)
    return _clean(doc)


@api.post("/items/bulk-generate-qr")
async def bulk_generate_qr(request: Request, user=Depends(require_perm("inventory", "write"))):
    """Aktiver QR for ALLE varer og størrelser som ikke har det ennå. Kun deluxe."""
    tid = await require_feature(request, user, "qr_codes")
    items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(10000)
    items_updated = 0
    sizes_updated = 0
    for it in items:
        changed = False
        if it.get("is_clothing") or it.get("is_ball"):
            sizes = it.get("sizes", [])
            for s in sizes:
                if not s.get("has_qr"):
                    s["has_qr"] = True
                    sizes_updated += 1
                    changed = True
            if changed or (not it.get("has_qr") and sizes):
                await db.items.update_one(
                    {"id": it["id"], "tenant_id": tid},
                    {"$set": {"sizes": sizes, "has_qr": any(s.get("has_qr") for s in sizes)}}
                )
                items_updated += 1
        else:
            if not it.get("has_qr"):
                await db.items.update_one({"id": it["id"], "tenant_id": tid}, {"$set": {"has_qr": True}})
                items_updated += 1
    return {"ok": True, "items_updated": items_updated, "sizes_updated": sizes_updated}


@api.post("/items/{item_id}/generate-qr")
async def generate_item_qr(item_id: str, data: GenerateQrIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_feature(request, user, "qr_codes")
    item = await db.items.find_one({"id": item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    if item.get("is_clothing") or item.get("is_ball"):
        sizes = item.get("sizes", [])
        chosen = set(data.sizes) if data.sizes is not None else {s["size"] for s in sizes}
        for s in sizes:
            if s["size"] in chosen:
                s["has_qr"] = True
        item["sizes"] = sizes
        item["has_qr"] = any(s.get("has_qr") for s in sizes)
        await db.items.update_one({"id": item_id, "tenant_id": tid}, {"$set": {"sizes": sizes, "has_qr": item["has_qr"]}})
    else:
        await db.items.update_one({"id": item_id, "tenant_id": tid}, {"$set": {"has_qr": True}})
        item["has_qr"] = True
    return _clean(item)


def _build_qr_png_b64(payload: str, logo_img=None) -> str:
    """Lager QR-PNG med valgfri logo-overlay og returnerer base64 data-URL."""
    import qrcode, base64 as _b64
    from qrcode.constants import ERROR_CORRECT_H
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, border=1, box_size=10)
    qr.add_data(payload)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    if logo_img is not None:
        from PIL import Image
        qw, qh = qr_img.size
        lw = int(qw * 0.22); lh = int(qh * 0.22)
        resized = logo_img.resize((lw, lh), Image.LANCZOS)
        pad = int(lw * 0.12)
        bg = Image.new("RGBA", (lw + pad * 2, lh + pad * 2), (255, 255, 255, 255))
        bg.paste(resized, (pad, pad), resized)
        qr_img.paste(bg, ((qw - bg.size[0]) // 2, (qh - bg.size[1]) // 2), bg)
    buf = io.BytesIO()
    qr_img.save(buf, format="PNG")
    return "data:image/png;base64," + _b64.b64encode(buf.getvalue()).decode()


async def _load_club_logo(tid: str):
    try:
        from PIL import Image
        import base64 as _b64
        club = await db.clubs.find_one({"tenant_id": tid}, {"_id": 0, "logo_url": 1})
        url = (club or {}).get("logo_url") or ""
        if url.startswith("data:image"):
            logo_bytes = _b64.b64decode(url.split(",", 1)[1])
            return Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
    except Exception as e:
        logger.warning(f"Logo-load feilet: {e}")
    return None


@api.get("/items/{item_id}/qr-images")
async def get_item_qr_images(item_id: str, request: Request, user=Depends(require_perm("inventory", "read"))):
    """Returnerer alle genererte QR-koder for en vare som data-URLs for Vis QR-dialog."""
    tid = await require_feature(request, user, "qr_codes")
    item = await db.items.find_one({"id": item_id, "tenant_id": tid}, {"_id": 0})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    logo = await _load_club_logo(tid)
    out = []
    if item.get("is_clothing") or item.get("is_ball"):
        for s in item.get("sizes", []):
            if s.get("has_qr"):
                payload = f"{item['id']}#{s['size']}"
                out.append({
                    "label": f"{item['name']} - {s['size']}",
                    "size": s["size"],
                    "payload": payload,
                    "data_url": _build_qr_png_b64(payload, logo),
                })
    elif item.get("has_qr"):
        out.append({
            "label": item["name"], "size": None, "payload": item["id"],
            "data_url": _build_qr_png_b64(item["id"], logo),
        })
    return {"item": {"id": item["id"], "name": item["name"]}, "qr_codes": out}


@api.put("/items/{item_id}")
async def update_item(item_id: str, data: ItemIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    doc = _prep_item_doc(data.dict())
    plan = await get_tenant_plan(tid)
    allow_images = bool(plan.get("product_images")) or user.get("role") == "platform_owner"
    if not allow_images:
        doc["image_url"] = None
        doc["images"] = []
        for s in doc.get("sizes", []):
            s["image_url"] = None
            s["images"] = []
    else:
        doc["images"] = (doc.get("images") or [])[:5]
        if doc["images"] and not doc.get("image_url"): doc["image_url"] = doc["images"][0]
        for s in doc.get("sizes", []):
            s["images"] = (s.get("images") or [])[:4]
            if s["images"] and not s.get("image_url"): s["image_url"] = s["images"][0]
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
        "loan_target": data.loan_target or ("team" if (data.team_id and not data.person_id) else "person" if data.person_id else None),
        "unit_price": price, "amount_owed": charge, "status": "borrowed",
        "loan_date": now_iso(), "picked_up_by": data.person_id,
        "due_in_days": int(data.due_in_days),
        "due_date": (datetime.now(timezone.utc) + timedelta(days=int(data.due_in_days))).isoformat(),
        "overdue_dismissed_at": None,
        "return_date": None, "received_by_person_id": None, "notes": data.notes,
    }
    await db.loans.insert_one(loan_doc)
    await _adjust_stock(tid, data.item_id, -data.quantity, data.size)

    if charge > 0:
        # Skyldig beløp styres av loan_target
        target = loan_doc["loan_target"]
        if target == "team" and data.team_id:
            await db.teams.update_one({"id": data.team_id, "tenant_id": tid}, {"$inc": {"debt": charge}})
        elif target == "person" and data.person_id:
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
        target = loan.get("loan_target") or ("team" if (loan.get("team_id") and not loan.get("person_id")) else "person" if loan.get("person_id") else None)
        if target == "team" and loan.get("team_id"):
            await db.teams.update_one({"id": loan["team_id"], "tenant_id": tid}, {"$inc": {"debt": -owed_reduce}})
        elif target == "person" and loan.get("person_id"):
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


@api.post("/loans/{loan_id}/extend")
async def extend_loan_due_date(loan_id: str, data: ExtendDueDateIn, request: Request, user=Depends(require_perm("loans", "write"))):
    tid = await require_tenant(request, user)
    loan = await db.loans.find_one({"id": loan_id, "tenant_id": tid})
    if not loan:
        raise HTTPException(404, "Utlån ikke funnet")
    days = int(data.due_in_days)
    if days not in (7, 14, 30):
        raise HTTPException(400, "Forfallsdato må være 7, 14 eller 30 dager")
    new_due = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    await db.loans.update_one({"id": loan_id, "tenant_id": tid}, {"$set": {
        "due_in_days": days, "due_date": new_due, "overdue_dismissed_at": None,
    }, "$push": {"due_date_history": {"extended_at": now_iso(), "new_due_date": new_due, "by": user["id"]}}})
    return {"ok": True, "due_date": new_due}


@api.get("/notifications")
async def list_notifications(request: Request, user=Depends(get_current_user)):
    tid = await resolve_tenant_id(request, user)
    if not tid:
        return {"overdue": [], "unseen_count": 0}
    now_dt = datetime.now(timezone.utc).isoformat()
    overdue = await db.loans.find({
        "tenant_id": tid, "status": "borrowed", "due_date": {"$lt": now_dt},
    }, {"_id": 0}).sort("due_date", 1).to_list(500)
    # last dismissal time pr user+loan
    unseen = []
    for ln in overdue:
        dis = ln.get("overdue_dismissed_at")
        if not dis or dis < ln.get("due_date", ""):
            unseen.append(ln)
    return {"overdue": overdue, "unseen": unseen, "unseen_count": len(unseen)}


@api.post("/notifications/dismiss")
async def dismiss_notifications(request: Request, user=Depends(get_current_user)):
    tid = await resolve_tenant_id(request, user)
    now_dt = datetime.now(timezone.utc).isoformat()
    await db.loans.update_many({"tenant_id": tid, "status": "borrowed", "due_date": {"$lt": now_dt}},
                               {"$set": {"overdue_dismissed_at": now_iso()}})
    return {"ok": True}


# ---------------- Invoices ----------------
@api.get("/invoices")
async def list_invoices(request: Request, user=Depends(require_perm("loans", "read"))):
    tid = await require_tenant(request, user)
    return await db.invoices.find({"tenant_id": tid}, {"_id": 0, "pdf_data": 0}).sort("created_at", -1).to_list(500)


async def _next_invoice_number(tid: str) -> str:
    count = await db.invoices.count_documents({"tenant_id": tid})
    return f"{datetime.now().year}{count + 1:04d}"


def _build_invoice_pdf(invoice: dict, club: Optional[dict], recipient: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdf_canvas
    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    y = h - 20 * mm
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20 * mm, y, "FAKTURA")
    c.setFont("Helvetica", 9)
    c.drawRightString(w - 20 * mm, y, f"Fakturanr: {invoice['invoice_number']}")
    y -= 6 * mm
    c.drawRightString(w - 20 * mm, y, f"Dato: {datetime.fromisoformat(invoice['created_at']).strftime('%d.%m.%Y')}")
    y -= 5 * mm
    c.drawRightString(w - 20 * mm, y, f"Forfall: {datetime.fromisoformat(invoice['due_date']).strftime('%d.%m.%Y')}")

    # Issuer (club)
    y_i = h - 20 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y_i - 10 * mm, (club or {}).get("name", "Klubb"))
    c.setFont("Helvetica", 9)
    y_i -= 15 * mm
    if club and club.get("org_number"):
        c.drawString(20 * mm, y_i, f"Org.nr: {club['org_number']}")
        y_i -= 4 * mm
    if club and club.get("bank_account"):
        c.drawString(20 * mm, y_i, f"Konto: {club['bank_account']}")

    # Recipient
    y -= 15 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Til:")
    c.setFont("Helvetica", 10)
    y -= 5 * mm
    c.drawString(20 * mm, y, recipient.get("name", ""))
    if recipient.get("email"):
        y -= 4 * mm
        c.drawString(20 * mm, y, recipient["email"])

    # Table
    y -= 12 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Beskrivelse")
    c.drawRightString(w - 20 * mm, y, "Beløp (NOK)")
    y -= 2 * mm
    c.line(20 * mm, y, w - 20 * mm, y)
    y -= 5 * mm
    c.setFont("Helvetica", 10)
    for line in invoice["lines"]:
        c.drawString(20 * mm, y, line["description"][:80])
        c.drawRightString(w - 20 * mm, y, f"{line['amount']:,.2f}".replace(",", " "))
        y -= 5 * mm
        if y < 40 * mm:
            c.showPage(); y = h - 20 * mm
    y -= 3 * mm
    c.line(20 * mm, y, w - 20 * mm, y)
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y, "Totalt å betale")
    c.drawRightString(w - 20 * mm, y, f"NOK {invoice['total']:,.2f}".replace(",", " "))

    if invoice.get("kid"):
        y -= 10 * mm
        c.setFont("Helvetica", 9)
        c.drawString(20 * mm, y, f"KID: {invoice['kid']}")
    if invoice.get("notes"):
        y -= 8 * mm
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(20 * mm, y, f"Notat: {invoice['notes'][:120]}")
    c.save()
    return buf.getvalue()


@api.post("/invoices")
async def create_invoice(data: InvoiceIn, request: Request, user=Depends(require_perm("loans", "write"))):
    tid = await require_tenant(request, user)
    if not data.loan_ids:
        raise HTTPException(400, "Ingen linjer valgt")
    loans = await db.loans.find({"id": {"$in": data.loan_ids}, "tenant_id": tid}, {"_id": 0}).to_list(1000)
    if not loans:
        raise HTTPException(404, "Fant ingen utlån")

    lines = []
    total = 0.0
    for l in loans:
        amt = float(l.get("amount_owed") or 0)
        if amt <= 0:
            continue
        desc = f"{l.get('item_name','')}"
        if l.get("size"):
            desc += f" ({l['size']})"
        desc += f" x {l.get('quantity', 1)} - utlånt {datetime.fromisoformat(l['loan_date']).strftime('%d.%m.%Y')}"
        lines.append({"loan_id": l["id"], "amount": round(amt, 2), "description": desc})
        total += amt

    if not lines:
        raise HTTPException(400, "Alle valgte linjer har 0 i skyldig beløp")

    # Resolve recipient
    recipient = {"name": "", "email": None}
    if data.person_id:
        p = await db.people.find_one({"id": data.person_id, "tenant_id": tid})
        if p:
            recipient = {"name": p.get("name", ""), "email": p.get("email")}
    elif data.team_id:
        t = await db.teams.find_one({"id": data.team_id, "tenant_id": tid})
        if t:
            recipient = {"name": t.get("team_name", ""), "email": t.get("email")}

    cust = await db.customers.find_one({"id": tid}, {"_id": 0})
    club = await db.clubs.find_one({"tenant_id": tid}, {"_id": 0})

    inv_number = await _next_invoice_number(tid)
    kid = f"{(cust or {}).get('customer_number', '0')}{inv_number}"
    due_date = (datetime.now(timezone.utc) + timedelta(days=int(data.due_in_days))).isoformat()
    invoice = {
        "id": new_id(), "tenant_id": tid,
        "invoice_number": inv_number, "kid": kid,
        "person_id": data.person_id, "team_id": data.team_id,
        "recipient_name": recipient["name"], "recipient_email": recipient["email"],
        "lines": lines, "total": round(total, 2),
        "created_at": now_iso(), "due_date": due_date,
        "status": "unpaid", "notes": data.notes,
        "sent_at": None, "paid_at": None,
    }
    pdf_bytes = _build_invoice_pdf(invoice, club, recipient)
    # Store PDF as base64 for retrieval
    import base64
    invoice["pdf_data"] = base64.b64encode(pdf_bytes).decode()
    await db.invoices.insert_one(invoice)
    inv_out = {k: v for k, v in invoice.items() if k not in ("_id", "pdf_data")}
    return inv_out


@api.get("/invoices/{invoice_id}/pdf")
async def get_invoice_pdf(invoice_id: str, request: Request, user=Depends(require_perm("loans", "read"))):
    tid = await require_tenant(request, user)
    inv = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid})
    if not inv:
        raise HTTPException(404, "Faktura ikke funnet")
    import base64
    pdf_bytes = base64.b64decode(inv["pdf_data"])
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="faktura-{inv["invoice_number"]}.pdf"'})


@api.post("/invoices/{invoice_id}/send")
async def send_invoice_email(invoice_id: str, data: InvoiceSendIn, request: Request, user=Depends(require_perm("loans", "write"))):
    tid = await require_tenant(request, user)
    inv = await db.invoices.find_one({"id": invoice_id, "tenant_id": tid})
    if not inv:
        raise HTTPException(404, "Faktura ikke funnet")
    to_email = data.email or inv.get("recipient_email")
    if not to_email:
        raise HTTPException(400, "Mangler mottakers e-postadresse")
    import base64
    pdf_b64 = inv["pdf_data"]
    try:
        await _send_email_with_attachment(
            to_email,
            f"Faktura {inv['invoice_number']} - NOK {inv['total']:.2f}",
            f"Hei {inv.get('recipient_name', '')},\n\nVedlagt følger faktura nr {inv['invoice_number']} på NOK {inv['total']:.2f}.\nForfall: {datetime.fromisoformat(inv['due_date']).strftime('%d.%m.%Y')}\nKID: {inv.get('kid', '')}\n\nMvh,\nUTSTYRSROMMET",
            f"faktura-{inv['invoice_number']}.pdf", pdf_b64,
        )
    except Exception as e:
        logger.error(f"Faktura-sending feilet: {e}")
        raise HTTPException(500, f"Kunne ikke sende faktura: {e}")
    await db.invoices.update_one({"id": invoice_id, "tenant_id": tid}, {"$set": {"sent_at": now_iso(), "status": "sent"}})
    return {"ok": True}


# ---------------- QR Labels ----------------
@api.get("/inventory/qr-labels")
async def inventory_qr_labels(
    request: Request,
    scope: str = "all",      # 'all' | 'item' | 'main_group' | 'sub_group'
    value: str = "",         # when scope != 'all'
    size: str = "medium",    # 'small' (2cm) | 'medium' (6cm) | 'large' (10cm)
    user=Depends(require_perm("inventory", "read"))
):
    tid = await require_feature(request, user, "qr_codes")
    # Build filter: only items that have QR enabled
    q: Dict[str, Any] = {"tenant_id": tid, "has_qr": True}
    if scope == "item" and value:
        q["id"] = value
    elif scope == "main_group" and value:
        q["main_group"] = value
    elif scope == "sub_group" and value:
        q["sub_group"] = value
    items = await db.items.find(q, {"_id": 0}).sort([("main_group", 1), ("sub_group", 1), ("name", 1)]).to_list(5000)
    # Expand: ett label pr aktiv størrelse (sized), eller én label (sizeless)
    labels: List[Dict[str, Any]] = []
    for it in items:
        if it.get("is_clothing") or it.get("is_ball"):
            for s in it.get("sizes", []):
                if s.get("has_qr"):
                    labels.append({"payload": f"{it['id']}#{s['size']}",
                                   "name": f"{it['name']} ({s['size']})"})
        elif it.get("has_qr"):
            labels.append({"payload": it["id"], "name": it["name"]})
    if not labels:
        raise HTTPException(404, "Ingen varer med QR-kode funnet for valgt filter")

    logo_img = await _load_club_logo(tid)

    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader

    # Grid config per size
    size_cfg = {
        "small":  {"qr_mm": 20, "label_mm": 6, "font": 7},
        "medium": {"qr_mm": 60, "label_mm": 12, "font": 11},
        "large":  {"qr_mm": 100, "label_mm": 16, "font": 14},
    }
    cfg = size_cfg.get(size, size_cfg["medium"])
    qr_mm = cfg["qr_mm"]
    label_mm = cfg["label_mm"]
    cell_w = qr_mm + 6
    cell_h = qr_mm + label_mm + 4

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    margin_mm = 10
    usable_w = (page_w / mm) - 2 * margin_mm
    usable_h = (page_h / mm) - 2 * margin_mm
    cols = max(1, int(usable_w // cell_w))
    rows = max(1, int(usable_h // cell_h))
    per_page = cols * rows

    for i, lab in enumerate(labels):
        page_idx_on_page = i % per_page
        col = page_idx_on_page % cols
        row = page_idx_on_page // cols
        x_mm = margin_mm + col * cell_w
        y_mm = (page_h / mm) - margin_mm - row * cell_h - cell_h

        qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, border=1, box_size=10)
        qr.add_data(lab["payload"])
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
        if logo_img is not None:
            from PIL import Image
            qw, qh = qr_img.size
            lw = int(qw * 0.22); lh = int(qh * 0.22)
            logo_resized = logo_img.resize((lw, lh), Image.LANCZOS)
            pad = int(lw * 0.12)
            bg = Image.new("RGBA", (lw + pad * 2, lh + pad * 2), (255, 255, 255, 255))
            bg.paste(logo_resized, (pad, pad), logo_resized)
            qr_img.paste(bg, ((qw - bg.size[0]) // 2, (qh - bg.size[1]) // 2), bg)

        img_buf = io.BytesIO(); qr_img.save(img_buf, format="PNG"); img_buf.seek(0)
        c.drawImage(ImageReader(img_buf), x_mm * mm, (y_mm + label_mm) * mm, qr_mm * mm, qr_mm * mm)
        c.setFont("Helvetica-Bold", cfg["font"])
        text = (lab["name"] or "")[:40]
        c.drawCentredString((x_mm + qr_mm / 2) * mm, (y_mm + label_mm / 2 - 1) * mm, text)

        if (i + 1) % per_page == 0 and (i + 1) < len(labels):
            c.showPage()
    c.save()
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": 'attachment; filename="qr-etiketter.pdf"'})


@api.get("/inventory/qr-filters")
async def inventory_qr_filters(request: Request, user=Depends(require_perm("inventory", "read"))):
    tid = await require_feature(request, user, "qr_codes")
    items = await db.items.find({"tenant_id": tid, "has_qr": True}, {"_id": 0}).to_list(5000)
    main_groups = sorted({(i.get("main_group") or "").strip() for i in items if (i.get("main_group") or "").strip()})
    sub_groups = sorted({(i.get("sub_group") or "").strip() for i in items if (i.get("sub_group") or "").strip()})
    # Count aktive QR-labels (per-size for sized, ellers 1 pr vare)
    total = 0
    for it in items:
        if it.get("is_clothing") or it.get("is_ball"):
            total += sum(1 for s in it.get("sizes", []) if s.get("has_qr"))
        else:
            total += 1
    return {
        "items": [{"id": i["id"], "name": i["name"], "main_group": i.get("main_group"), "sub_group": i.get("sub_group")} for i in items],
        "main_groups": main_groups, "sub_groups": sub_groups, "total": total,
    }


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
    # Pre-populate lines for all items, sorted by location then name
    items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(10000)

    def _sort_key(it):
        return ((it.get("location") or "").lower(), (it.get("name") or "").lower())

    items.sort(key=_sort_key)

    lines = []
    for it in items:
        if (it.get("is_clothing") or it.get("is_ball")) and it.get("sizes"):
            # One line per size, sorted by size's own location then size label
            sizes = sorted(it["sizes"], key=lambda s: ((s.get("location") or it.get("location") or "").lower(), str(s.get("size") or "")))
            for s in sizes:
                lines.append({
                    "line_id": new_id(), "item_id": it["id"], "item_name": it.get("name", ""),
                    "size": s.get("size"),
                    "location": s.get("location") or it.get("location") or "",
                    "system_quantity": s.get("quantity", 0),
                    "counted_quantity": None,
                    "diff": 0, "adjusted": False, "counted_at": None,
                })
        else:
            lines.append({
                "line_id": new_id(), "item_id": it["id"], "item_name": it.get("name", ""),
                "size": None,
                "location": it.get("location") or "",
                "system_quantity": it.get("total_stock", 0),
                "counted_quantity": None,
                "diff": 0, "adjusted": False, "counted_at": None,
            })

    doc = {"id": new_id(), "tenant_id": tid,
           "name": data.name or f"Varetelling {datetime.now().strftime('%Y-%m-%d')}",
           "status": "open", "created_at": now_iso(), "lines": lines}
    await db.stock_counts.insert_one(doc)
    return _clean(doc)


@api.put("/stock-counts/{count_id}/lines/{line_id}")
async def update_count_line(count_id: str, line_id: str, data: StockCountLineIn, request: Request, user=Depends(require_perm("stock_audit", "write"))):
    tid = await require_feature(request, user, "stock_audit")
    sc = await db.stock_counts.find_one({"id": count_id, "tenant_id": tid})
    if not sc:
        raise HTTPException(404, "Varetelling ikke funnet")
    for ln in sc.get("lines", []):
        if ln.get("line_id") == line_id:
            ln["counted_quantity"] = int(data.counted_quantity)
            ln["diff"] = int(data.counted_quantity) - int(ln.get("system_quantity") or 0)
            ln["counted_at"] = now_iso()
            await db.stock_counts.update_one({"id": count_id, "tenant_id": tid}, {"$set": {"lines": sc["lines"]}})
            return ln
    raise HTTPException(404, "Linje ikke funnet")


@api.delete("/stock-counts/{count_id}/lines/{line_id}")
async def delete_count_line(count_id: str, line_id: str, request: Request, user=Depends(require_perm("stock_audit", "write"))):
    tid = await require_feature(request, user, "stock_audit")
    sc = await db.stock_counts.find_one({"id": count_id, "tenant_id": tid})
    if not sc:
        raise HTTPException(404, "Varetelling ikke funnet")
    new_lines = [ln for ln in sc.get("lines", []) if ln.get("line_id") != line_id]
    await db.stock_counts.update_one({"id": count_id, "tenant_id": tid}, {"$set": {"lines": new_lines}})
    return {"ok": True}


@api.delete("/stock-counts/{count_id}")
async def delete_stock_count(count_id: str, request: Request, user=Depends(require_perm("stock_audit", "admin"))):
    tid = await require_feature(request, user, "stock_audit")
    await db.stock_counts.delete_one({"id": count_id, "tenant_id": tid})
    return {"ok": True}


@api.post("/stock-counts/{count_id}/lines")
async def add_count_line(count_id: str, data: StockCountLineIn, request: Request, user=Depends(require_perm("stock_audit", "write"))):
    tid = await require_feature(request, user, "stock_audit")
    item = await db.items.find_one({"id": data.item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    if (item.get("is_clothing") or item.get("is_ball")) and data.size:
        system = next((s.get("quantity", 0) for s in item.get("sizes", []) if s["size"] == data.size), 0)
        loc = next((s.get("location") or item.get("location", "") for s in item.get("sizes", []) if s["size"] == data.size), item.get("location", ""))
    else:
        system = item.get("total_stock", 0)
        loc = item.get("location", "")
    line = {"line_id": new_id(), "item_id": data.item_id, "item_name": item.get("name", ""),
            "size": data.size, "location": loc, "system_quantity": system, "counted_quantity": data.counted_quantity,
            "diff": data.counted_quantity - system, "adjusted": False, "counted_at": now_iso()}
    await db.stock_counts.update_one({"id": count_id, "tenant_id": tid}, {"$push": {"lines": line}})
    return line


@api.post("/stock-counts/{count_id}/apply")
async def apply_stock_count(count_id: str, request: Request, user=Depends(require_perm("stock_audit", "write"))):
    tid = await require_feature(request, user, "stock_audit")
    sc = await db.stock_counts.find_one({"id": count_id, "tenant_id": tid})
    if not sc:
        raise HTTPException(404, "Varetelling ikke funnet")
    for line in sc.get("lines", []):
        if line.get("counted_quantity") is None:
            continue  # skip uncounted lines
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
    tid = await require_tenant(request, user)
    team = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})
    if not team:
        raise HTTPException(404, "Lag ikke funnet")
    loans = await db.loans.find({"team_id": team_id, "tenant_id": tid}, {"_id": 0}).sort("loan_date", -1).to_list(5000)
    pids = list({l.get("person_id") for l in loans if l.get("person_id")} |
                {l.get("picked_up_by") for l in loans if l.get("picked_up_by")})
    people = {p["id"]: p for p in await db.people.find({"id": {"$in": pids}, "tenant_id": tid}, {"_id": 0}).to_list(1000)}
    cust = await db.customers.find_one({"id": tid}, {"_id": 0}) or {}
    club = await db.clubs.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    club_name = club.get("name") or cust.get("club_name") or "Klubben"
    pdf_bytes = _build_team_equipment_pdf(team, loans, people, club, cust, user, club_name)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name", "lag"))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="utstyr_{safe}.pdf"'})


async def _generate_team_equipment_pdf_for_tenant(tid: str, team_id: str, user: Optional[dict] = None) -> tuple:
    """Hjelper: genererer PDF-bytes + metadata (team, club_name, user) for et lag."""
    team = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})
    if not team: return None, None, None, None
    loans = await db.loans.find({"team_id": team_id, "tenant_id": tid}, {"_id": 0}).sort("loan_date", -1).to_list(5000)
    pids = list({l.get("person_id") for l in loans if l.get("person_id")} |
                {l.get("picked_up_by") for l in loans if l.get("picked_up_by")})
    people = {p["id"]: p for p in await db.people.find({"id": {"$in": pids}, "tenant_id": tid}, {"_id": 0}).to_list(1000)}
    cust = await db.customers.find_one({"id": tid}, {"_id": 0}) or {}
    club = await db.clubs.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    club_name = club.get("name") or cust.get("club_name") or "Klubben"
    effective_user = user or {"name": club_name, "email": cust.get("owner_email"), "phone": cust.get("owner_phone")}
    pdf_bytes = _build_team_equipment_pdf(team, loans, people, club, cust, effective_user, club_name)
    return pdf_bytes, team, club_name, loans


class TeamSendEquipmentIn(BaseModel):
    to: Optional[EmailStr] = None  # override; defaults to lagleder-epost
    cc: Optional[EmailStr] = None
    message: Optional[str] = None


@api.post("/teams/{team_id}/send-equipment-list")
async def send_team_equipment_list(team_id: str, data: TeamSendEquipmentIn, request: Request,
                                     user=Depends(require_perm("teams", "write"))):
    """Send utstyrsoversikt (PDF) rett til lagleder på epost."""
    tid = await require_tenant(request, user)
    pdf_bytes, team, club_name, _ = await _generate_team_equipment_pdf_for_tenant(tid, team_id, user)
    if not team:
        raise HTTPException(404, "Lag ikke funnet")
    tm = team.get("team_manager") or {}
    hc = team.get("head_coach") or {}
    recipient = {"name": tm.get("name") or hc.get("name") or team.get("contact_person") or "",
                 "email": tm.get("email") or hc.get("email") or team.get("email") or ""}
    to_email = (data.to or recipient["email"] or "").strip()
    if not to_email or not re.match(r"^[^@]+@[^@]+\.[^@]+$", to_email):
        raise HTTPException(400, "Mangler gyldig e-post til lagleder. Sett e-post på laget først, eller angi mottaker.")
    pdf_b64 = _b64mod.b64encode(pdf_bytes).decode()
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name", "lag"))
    filename = f"utstyr_{safe}.pdf"
    msg = (data.message or "").strip()
    html = (
        f'<p>Hei {recipient["name"] or ""},</p>'
        f'<p>Vedlagt er oversikt over utstyr og eventuelt utestående beløp for <strong>{team.get("team_name")}</strong>.</p>'
        + (f'<p>{msg}</p>' if msg else '')
        + f'<p>Vennligst sjekk listen og returner utstyr før fristdato.</p>'
        f'<p>Mvh<br/>{club_name}</p>'
    )
    cc_list = []
    if data.cc: cc_list.append(data.cc)
    if user.get("email") and user["email"] != to_email and user["email"] not in cc_list:
        cc_list.append(user["email"])
    attachments = [{"filename": filename, "content": pdf_b64, "type": "application/pdf"}]
    res = await send_tenant_email(tid, to_email,
                                   f"Utstyrsoversikt – {team.get('team_name')}",
                                   html, attachments=attachments, cc=cc_list or None)
    if not res.get("ok"):
        raise HTTPException(502, f"E-post feilet: {res.get('error')}")
    await db.teams.update_one({"id": team_id, "tenant_id": tid}, {"$set": {
        "equipment_list_sent_at": now_iso(), "equipment_list_sent_to": to_email,
    }})
    return {"ok": True, "sent_to": to_email, "provider_id": res.get("provider_id"), "method": res.get("method")}


def _build_team_equipment_pdf(team: dict, loans: list, people: dict, club: dict,
                               cust: dict, user: dict, club_name: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader
    import base64 as _b64

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    LEFT = 20 * mm; RIGHT = w - 20 * mm
    y = h - 20 * mm

    # --- Letterhead: Club info (logo + name + contact) ---
    logo_url = club.get("logo_url") or ""
    if logo_url.startswith("data:image"):
        try:
            logo_bytes = _b64.b64decode(logo_url.split(",", 1)[1])
            img = ImageReader(io.BytesIO(logo_bytes))
            c.drawImage(img, LEFT, y - 18 * mm, 20 * mm, 20 * mm, mask="auto", preserveAspectRatio=True)
            text_x = LEFT + 24 * mm
        except Exception:
            text_x = LEFT
    else:
        text_x = LEFT

    c.setFont("Helvetica-Bold", 14)
    c.drawString(text_x, y, club_name)
    c.setFont("Helvetica", 9)
    y_h = y - 5 * mm
    if club.get("org_number"):
        c.drawString(text_x, y_h, f"Org.nr: {club['org_number']}"); y_h -= 4 * mm
    if cust.get("owner_email"):
        c.drawString(text_x, y_h, cust["owner_email"]); y_h -= 4 * mm
    if cust.get("owner_phone"):
        c.drawString(text_x, y_h, f"Tlf: {cust['owner_phone']}"); y_h -= 4 * mm
    if cust.get("address") or cust.get("postal_code") or cust.get("city"):
        addr = " ".join(x for x in [cust.get("address"), cust.get("postal_code"), cust.get("city")] if x)
        c.drawString(text_x, y_h, addr); y_h -= 4 * mm

    # --- Dato (right side) ---
    c.setFont("Helvetica", 9)
    c.drawRightString(RIGHT, y, datetime.now(timezone.utc).strftime("%d.%m.%Y"))

    y = min(y_h, y - 22 * mm) - 4 * mm
    c.line(LEFT, y, RIGHT, y)
    y -= 8 * mm

    # --- Adressert til [lag] v/ [lagleder] ---
    tm = team.get("team_manager") or {}
    hc = team.get("head_coach") or {}
    leader = tm.get("name") or hc.get("name") or team.get("contact_person") or ""
    c.setFont("Helvetica-Bold", 11)
    c.drawString(LEFT, y, f"Til: {team.get('team_name') or ''}" + (f" v/ {leader}" if leader else ""))
    y -= 6 * mm
    if team.get("age_class"):
        c.setFont("Helvetica", 9)
        c.drawString(LEFT, y, f"Årsklasse: {team.get('age_class')}")
        y -= 5 * mm

    # --- Tittel ---
    y -= 4 * mm
    c.setFont("Helvetica-Bold", 15)
    c.drawString(LEFT, y, "Oversikt over utstyr og utestående beløp")
    y -= 8 * mm

    def nok(v):
        return f"{(v or 0):,.0f}".replace(",", " ") + " kr"

    def _fmt_date(iso):
        if not iso: return ""
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%d.%m.%Y")
        except Exception:
            return str(iso)[:10]

    def _ensure_space(need_mm):
        nonlocal y
        if y < (25 * mm + need_mm):
            c.showPage()
            y = h - 20 * mm

    # --- Section 1: Utestående utstyr (status=borrowed med skyldig beløp) ---
    unreturned = [l for l in loans if l.get("status") == "borrowed" and float(l.get("amount_owed") or 0) > 0]
    unreturned.sort(key=lambda l: l.get("loan_date") or "")

    c.setFont("Helvetica-Bold", 12)
    c.drawString(LEFT, y, "Utestående utstyr (ikke levert tilbake)")
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 9)
    # Columns: Vare | Str/Nr | Antall | Skyldig | Frist
    col_vare = LEFT
    col_str = LEFT + 85 * mm
    col_ant = LEFT + 115 * mm
    col_skyld = LEFT + 135 * mm
    col_frist = RIGHT - 24 * mm
    c.drawString(col_vare, y, "Vare")
    c.drawString(col_str, y, "Str/Nr")
    c.drawRightString(col_ant + 10 * mm, y, "Antall")
    c.drawRightString(col_skyld + 25 * mm, y, "Skyldig")
    c.drawRightString(RIGHT, y, "Frist")
    y -= 2 * mm
    c.line(LEFT, y, RIGHT, y)
    y -= 5 * mm
    c.setFont("Helvetica", 9)
    total_amt = 0.0; total_qty = 0; lines_count = 0
    if not unreturned:
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(LEFT, y, "Ingen utestående varer.")
        y -= 6 * mm
    else:
        for l in unreturned:
            _ensure_space(6 * mm)
            name = (l.get("item_name") or "")[:50]
            size_bits = []
            if l.get("size"): size_bits.append(l["size"])
            if l.get("jersey_number") and l["jersey_number"] not in ("X", ""): size_bits.append(f"#{l['jersey_number']}")
            size_str = " ".join(size_bits) or "-"
            qty = int(l.get("quantity") or 0)
            amt = float(l.get("amount_owed") or 0)
            due = _fmt_date(l.get("due_date"))
            c.drawString(col_vare, y, name)
            c.drawString(col_str, y, size_str)
            c.drawRightString(col_ant + 10 * mm, y, str(qty))
            c.drawRightString(col_skyld + 25 * mm, y, nok(amt))
            c.drawRightString(RIGHT, y, due)
            y -= 5 * mm
            total_amt += amt; total_qty += qty; lines_count += 1
        y -= 1 * mm
        c.line(LEFT, y, RIGHT, y); y -= 5 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(col_skyld + 25 * mm, y, nok(total_amt))
        c.drawString(LEFT, y, f"Sum ({lines_count} linjer, {total_qty} varer)")
        y -= 8 * mm

    # --- Section 2: Utleverte forbruksvarer (handout uten skyld) ---
    _ensure_space(30 * mm)
    handouts = [l for l in loans if (l.get("mode") == "handout" and float(l.get("amount_owed") or 0) == 0)]
    handouts.sort(key=lambda l: l.get("loan_date") or "")

    c.setFont("Helvetica-Bold", 12)
    c.drawString(LEFT, y, "Utleverte forbruksvarer (uten skyldig beløp)")
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 9)
    col_dato = LEFT
    col_vare2 = LEFT + 32 * mm
    col_str2 = LEFT + 95 * mm
    col_ant2 = LEFT + 125 * mm
    col_hent = LEFT + 148 * mm
    c.drawString(col_dato, y, "Dato")
    c.drawString(col_vare2, y, "Vare")
    c.drawString(col_str2, y, "Str/Nr")
    c.drawRightString(col_ant2 + 10 * mm, y, "Antall")
    c.drawString(col_hent, y, "Utlevert til")
    y -= 2 * mm
    c.line(LEFT, y, RIGHT, y)
    y -= 5 * mm
    c.setFont("Helvetica", 9)
    h_qty_total = 0; h_lines = 0
    if not handouts:
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(LEFT, y, "Ingen forbruksvarer utlevert.")
        y -= 6 * mm
    else:
        for l in handouts:
            _ensure_space(6 * mm)
            name = (l.get("item_name") or "")[:40]
            size_bits = []
            if l.get("size"): size_bits.append(l["size"])
            if l.get("jersey_number") and l["jersey_number"] not in ("X", ""): size_bits.append(f"#{l['jersey_number']}")
            size_str = " ".join(size_bits) or "-"
            qty = int(l.get("quantity") or 0)
            dato = _fmt_date(l.get("loan_date"))
            pid = l.get("picked_up_by") or l.get("person_id")
            picked = (people.get(pid) or {}).get("name") or "-"
            c.drawString(col_dato, y, dato)
            c.drawString(col_vare2, y, name)
            c.drawString(col_str2, y, size_str)
            c.drawRightString(col_ant2 + 10 * mm, y, str(qty))
            c.drawString(col_hent, y, picked[:28])
            y -= 5 * mm
            h_qty_total += qty; h_lines += 1
        y -= 1 * mm
        c.line(LEFT, y, RIGHT, y); y -= 5 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawString(LEFT, y, f"Sum ({h_lines} linjer, {h_qty_total} varer)")
        y -= 8 * mm

    # --- Oppsummering ---
    _ensure_space(40 * mm)
    y -= 2 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(LEFT, y, "Oppsummering")
    y -= 6 * mm
    c.setFont("Helvetica", 10)
    c.drawString(LEFT, y, f"Utestående utstyr: {lines_count} linjer, totalt {total_qty} varer")
    y -= 5 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(LEFT, y, f"Totalt utestående beløp: {nok(total_amt)}")
    y -= 7 * mm
    c.setFont("Helvetica", 10)
    c.drawString(LEFT, y, f"Utleverte forbruksvarer: {h_lines} linjer, totalt {h_qty_total} varer")
    y -= 12 * mm

    # --- Avslutning / signatur ---
    _ensure_space(25 * mm)
    c.setFont("Helvetica", 10)
    c.drawString(LEFT, y, "Mvh")
    y -= 5 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(LEFT, y, user.get("name") or user.get("email") or "")
    y -= 5 * mm
    c.setFont("Helvetica", 10)
    if user.get("phone"):
        c.drawString(LEFT, y, user.get("phone"))
        y -= 5 * mm
    c.drawString(LEFT, y, club_name)

    c.save()
    return buf.getvalue()


# ============== VAREMOTTAK (Goods Receipt) ==============
class StockReceiptIn(BaseModel):
    request_id: Optional[str] = None
    item_id: str
    size: Optional[str] = None
    jersey_number: Optional[str] = None
    quantity: int
    order_ref: str = ""
    comment: str = ""


class QrResolveIn(BaseModel):
    code: str


@api.post("/stock-receipts/resolve-qr")
async def resolve_receipt_qr(data: QrResolveIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    code = (data.code or "").strip()
    if not code:
        raise HTTPException(400, "Mangler QR-kode")
    item_id = code; size = None
    if "#" in code:
        item_id, size = code.split("#", 1)
    item = await db.items.find_one({"id": item_id, "tenant_id": tid}, {"_id": 0})
    if not item:
        raise HTTPException(404, "QR-koden tilhører ikke en vare i systemet")
    return {"item": item, "size": size}


@api.get("/stock-receipts")
async def list_receipts(request: Request, user=Depends(require_perm("inventory", "read"))):
    tid = await require_tenant(request, user)
    return await db.stock_receipts.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)


@api.post("/stock-receipts")
async def create_receipt(data: StockReceiptIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    if not isinstance(data.quantity, int) or data.quantity <= 0:
        raise HTTPException(400, "Mottatt antall må være et positivt heltall")
    if data.request_id:
        existing = await db.stock_receipts.find_one({"tenant_id": tid, "request_id": data.request_id}, {"_id": 0})
        if existing:
            return existing
    item = await db.items.find_one({"id": data.item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare finnes ikke")
    qty_before = 0; qty_after = 0
    if item.get("is_clothing") or item.get("is_ball"):
        if not data.size:
            raise HTTPException(400, "Størrelse må oppgis for klær og baller")
        sizes = item.get("sizes") or []
        found = None
        for s in sizes:
            if s.get("size") == data.size and (
                not data.jersey_number or data.jersey_number in ("X", s.get("jersey_number"))
            ):
                found = s; break
        if not found:
            raise HTTPException(404, "Fant ikke angitt variant på varen")
        qty_before = int(found.get("quantity") or 0)
        found["quantity"] = qty_before + data.quantity
        qty_after = found["quantity"]
        new_total = sum(int(s.get("quantity") or 0) for s in sizes)
        await db.items.update_one({"id": data.item_id, "tenant_id": tid},
                                  {"$set": {"sizes": sizes, "total_stock": new_total}})
    else:
        qty_before = int(item.get("total_stock") or 0)
        qty_after = qty_before + data.quantity
        await db.items.update_one({"id": data.item_id, "tenant_id": tid},
                                  {"$set": {"total_stock": qty_after}})
    receipt = {
        "id": new_id(), "tenant_id": tid, "request_id": data.request_id,
        "item_id": data.item_id, "item_name": item.get("name"),
        "size": data.size, "jersey_number": data.jersey_number,
        "quantity": data.quantity, "qty_before": qty_before, "qty_after": qty_after,
        "order_ref": data.order_ref, "comment": data.comment,
        "user_id": user.get("id"), "user_name": user.get("name"),
        "created_at": now_iso(),
    }
    await db.stock_receipts.insert_one(receipt)
    receipt.pop("_id", None)
    return receipt


# ============== TEAM NEEDS (Innmeldt Behov) ==============
NEED_RULES = {
    "Håndball":    {"min": 1, "max": 50, "size_required": True,  "jersey_required": False},
    "Hjemmedrakt": {"min": 1, "max": 1,  "size_required": True,  "jersey_required": True},
    "Bortedrakt":  {"min": 1, "max": 1,  "size_required": True,  "jersey_required": True},
    "Tape":        {"min": 1, "max": 10, "size_required": False, "jersey_required": False},
    "Isposer":     {"min": 1, "max": 10, "size_required": False, "jersey_required": False},
    "Andre klær":  {"min": 1, "max": 1,  "size_required": True,  "jersey_required": False},
}
NEED_HEADERS = ["Varetype", "Vare/variant", "Størrelse", "Draktnummer", "Antall", "Kommentar"]


def _current_seasons():
    y = datetime.now(timezone.utc).year
    return [f"{str(y)[-2:]}/{str(y+1)[-2:]}", f"{str(y+1)[-2:]}/{str(y+2)[-2:]}"]


@api.get("/needs/seasons")
async def need_seasons():
    return {"seasons": _current_seasons()}


async def _build_needs_template_bytes(tid: str, team_id: str) -> bytes:
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.styles import PatternFill, Font
    team = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})
    if not team:
        raise HTTPException(404, "Lag finnes ikke")
    teams = await db.teams.find({"tenant_id": tid}, {"_id": 0}).to_list(500)
    items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    seasons = _current_seasons()
    wb = Workbook()
    ws = wb.active; ws.title = "Behov"
    hdr_font = Font(bold=True, color="FFFFFF")
    hdr_fill = PatternFill(start_color="7F1D1D", end_color="7F1D1D", fill_type="solid")
    ws["A1"] = "UTSTYRSROMMET – Innmeldt Behov"
    ws["A1"].font = Font(bold=True, size=14, color="7F1D1D")
    ws["A2"] = "Fyll ut lag, årsklasse og sesong, deretter én linje per enhet. Klær registreres som én enhet per linje."
    ws["A2"].font = Font(italic=True, size=10, color="555555")
    ws["A4"] = "Lagsnavn:"; ws["B4"] = team.get("team_name") or ""
    ws["A5"] = "Årsklasse:"; ws["B5"] = team.get("age_class") or ""
    ws["A6"] = "Sesong:"; ws["B6"] = seasons[0]
    ws["A7"] = "Lag-ID (ikke endre):"; ws["B7"] = team_id
    for r in range(4, 8):
        ws[f"A{r}"].font = Font(bold=True)
    for ci, h in enumerate(NEED_HEADERS, start=1):
        c = ws.cell(row=9, column=ci, value=h)
        c.font = hdr_font; c.fill = hdr_fill
    ref = wb.create_sheet("Referanse")
    team_names = sorted({t.get("team_name") for t in teams if t.get("team_name")})
    age_classes = sorted({t.get("age_class") for t in teams if t.get("age_class")})
    item_names = sorted({i.get("name") for i in items if i.get("name")})
    all_sizes = set()
    for it in items:
        for s in it.get("sizes") or []:
            if s.get("size"): all_sizes.add(s.get("size"))
    sizes = sorted(all_sizes)
    varetypes = list(NEED_RULES.keys())
    def _col(col_idx, header, values):
        ref.cell(row=1, column=col_idx, value=header)
        for i, v in enumerate(values, start=2):
            ref.cell(row=i, column=col_idx, value=v)
    _col(1, "Lag", team_names)
    _col(2, "Årsklasse", age_classes)
    _col(3, "Sesonger", seasons)
    _col(4, "Varetype", varetypes)
    _col(5, "Vare", item_names)
    _col(6, "Størrelse", sizes)
    dv_team = DataValidation(type="list", formula1=f"=Referanse!$A$2:$A${1+max(len(team_names),1)}", allow_blank=True)
    dv_age = DataValidation(type="list", formula1=f"=Referanse!$B$2:$B${1+max(len(age_classes),1)}", allow_blank=True)
    dv_season = DataValidation(type="list", formula1=f"=Referanse!$C$2:$C${1+len(seasons)}", allow_blank=True)
    dv_type = DataValidation(type="list", formula1=f"=Referanse!$D$2:$D${1+len(varetypes)}", allow_blank=False, errorTitle="Ugyldig varetype", error="Velg fra listen")
    dv_item = DataValidation(type="list", formula1=f"=Referanse!$E$2:$E${1+max(len(item_names),1)}", allow_blank=True)
    dv_size = DataValidation(type="list", formula1=f"=Referanse!$F$2:$F${1+max(len(sizes),1)}", allow_blank=True)
    dv_qty = DataValidation(type="whole", operator="between", formula1=1, formula2=50, allow_blank=True, errorTitle="Ugyldig antall", error="Antall må være heltall 1-50")
    for dv in (dv_team, dv_age, dv_season, dv_type, dv_item, dv_size, dv_qty):
        ws.add_data_validation(dv)
    dv_team.add("B4"); dv_age.add("B5"); dv_season.add("B6")
    rows_count = 205
    dv_type.add(f"A10:A{10+rows_count}")
    dv_item.add(f"B10:B{10+rows_count}")
    dv_size.add(f"C10:C{10+rows_count}")
    dv_qty.add(f"E10:E{10+rows_count}")
    widths = [16, 32, 14, 12, 9, 36]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64+i)].width = w
    ref.sheet_state = "hidden"
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


@api.get("/teams/{team_id}/needs/template")
async def team_needs_template(team_id: str, request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    xlsx = await _build_needs_template_bytes(tid, team_id)
    team = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0}) or {}
    seasons = _current_seasons()
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name") or "lag")
    return Response(content=xlsx,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="behov_mal_{safe}_{seasons[0].replace("/","-")}.xlsx"'})


class NeedConfirmIn(BaseModel):
    season: str
    lines: List[dict]
    strategy: str = "replace"
    filename: Optional[str] = None


async def _compute_need_coverage(tid, needs):
    items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    item_by_id = {i["id"]: i for i in items}
    def vk(iid, size, jersey): return f"{iid}|{size or ''}|{jersey or ''}"
    avail = {}
    for i in items:
        if i.get("is_clothing") or i.get("is_ball"):
            for s in i.get("sizes") or []:
                jk = s.get("jersey_number") if i.get("is_clothing") else ""
                avail[vk(i["id"], s.get("size"), jk)] = int(s.get("quantity") or 0)
        else:
            avail[vk(i["id"], None, None)] = int(i.get("total_stock") or 0)
    computed = []
    for need in needs:
        for ln in need.get("lines", []):
            item_id = ln.get("item_id")
            size = ln.get("size") or None
            jersey = ln.get("jersey_number") or ""
            it = item_by_id.get(item_id, {})
            key = vk(item_id, size, jersey if it.get("is_clothing") else "")
            avail_now = avail.get(key, 0)
            needed = int(ln.get("quantity") or 0)
            can_cover = min(needed, avail_now)
            avail[key] = max(0, avail_now - can_cover)
            must_order = max(0, needed - can_cover)
            pprice = it.get("purchase_price")
            missing_price = pprice in (None, "", 0)
            cost = (must_order * pprice) if not missing_price else None
            alt = None
            if must_order > 0 and it:
                for cand in items:
                    if cand.get("id") == item_id: continue
                    if bool(cand.get("is_clothing")) != bool(it.get("is_clothing")): continue
                    if bool(cand.get("is_ball")) != bool(it.get("is_ball")): continue
                    if (cand.get("category") or "") != (it.get("category") or ""): continue
                    if cand.get("is_clothing") or cand.get("is_ball"):
                        for cs in cand.get("sizes") or []:
                            if cs.get("size") == size and int(cs.get("quantity") or 0) > 0:
                                alt = {"item_id": cand["id"], "name": cand.get("name"), "size": cs.get("size"),
                                       "quantity_available": int(cs.get("quantity") or 0),
                                       "reason": "Samme kategori og størrelse"}
                                break
                    else:
                        if int(cand.get("total_stock") or 0) > 0:
                            alt = {"item_id": cand["id"], "name": cand.get("name"), "size": None,
                                   "quantity_available": int(cand.get("total_stock") or 0),
                                   "reason": "Samme kategori"}
                    if alt: break
            computed.append({
                "need_id": need.get("id"), "line_id": ln.get("id"),
                "item_type": ln.get("item_type"), "item_id": item_id,
                "item_name": it.get("name") or ln.get("item_name") or "?",
                "size": size, "jersey_number": jersey, "quantity": needed,
                "available_now": avail_now, "can_cover": can_cover, "must_order": must_order,
                "unit_purchase_price": pprice, "line_cost": cost,
                "missing_price": missing_price, "alternative": alt,
                "comment": ln.get("comment"),
            })
    return computed


@api.get("/teams/{team_id}/needs")
async def get_team_needs(team_id: str, request: Request, season: Optional[str] = None, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    q = {"tenant_id": tid, "team_id": team_id}
    if season: q["season"] = season
    needs = await db.team_needs.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    computed = await _compute_need_coverage(tid, needs)
    return {"seasons": _current_seasons(), "needs": needs, "lines_computed": computed,
            "computed_at": now_iso()}


@api.post("/teams/{team_id}/needs/import")
async def import_team_needs(team_id: str, request: Request, file: UploadFile = File(...), user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    team = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0})
    if not team:
        raise HTTPException(404, "Lag finnes ikke")
    content = await file.read()
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(400, "Kunne ikke lese Excel-fil")
    ws = wb.active
    file_season = str(ws["B6"].value or "").strip()
    file_team_id = str(ws["B7"].value or "").strip()
    file_team_name = str(ws["B4"].value or "").strip()
    file_age = str(ws["B5"].value or "").strip()
    if file_team_id and file_team_id != team_id:
        raise HTTPException(400, f"Malen tilhører et annet lag ({file_team_name!r}).")
    valid_seasons = _current_seasons()
    if file_season not in valid_seasons:
        raise HTTPException(400, f"Ugyldig sesong: {file_season!r}. Gyldige: {', '.join(valid_seasons)}")
    items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)
    items_by_name = {i["name"].lower(): i for i in items if i.get("name")}
    lines_preview = []
    errors = []
    for ridx, row in enumerate(ws.iter_rows(min_row=10, values_only=True), start=10):
        if row is None or all(v is None or (isinstance(v, str) and not v.strip()) for v in (row[:6] if row else [])):
            continue
        vtype = (str(row[0]) if row[0] else "").strip()
        iname = (str(row[1]) if row[1] else "").strip()
        size = (str(row[2]) if row[2] else "").strip()
        jersey = (str(row[3]) if row[3] else "").strip()
        qty_raw = row[4] if len(row) > 4 else None
        comment = (str(row[5]) if len(row) > 5 and row[5] else "").strip()
        line_err = []
        if vtype not in NEED_RULES:
            line_err.append(f"Ukjent varetype {vtype!r}")
        rule = NEED_RULES.get(vtype, {})
        try:
            qty = int(qty_raw) if qty_raw not in (None, "") else 0
        except Exception:
            qty = 0; line_err.append("Antall må være heltall")
        if rule and (qty < rule.get("min", 1) or qty > rule.get("max", 50)):
            line_err.append(f"Antall {qty} ugyldig for {vtype} (må være {rule.get('min')}-{rule.get('max')})")
        if rule.get("size_required") and not size:
            line_err.append("Størrelse er påkrevd")
        if rule.get("jersey_required") and not jersey:
            line_err.append("Draktnummer er påkrevd")
        it = items_by_name.get(iname.lower()) if iname else None
        if not iname:
            line_err.append("Vare/variant mangler")
        elif not it:
            line_err.append(f"Fant ikke vare {iname!r} i katalogen")
        lines_preview.append({
            "row": ridx, "item_type": vtype, "item_name": iname,
            "item_id": it["id"] if it else None,
            "size": size, "jersey_number": jersey,
            "quantity": qty, "comment": comment, "errors": line_err,
        })
        if line_err:
            errors.extend([f"Rad {ridx}: {e}" for e in line_err])
    existing = await db.team_needs.find({"tenant_id": tid, "team_id": team_id, "season": file_season}, {"_id": 0}).to_list(100)
    return {
        "team_id": team_id, "team_name": team.get("team_name"),
        "age_class": file_age, "season": file_season,
        "filename": file.filename, "lines": lines_preview,
        "errors": errors, "has_existing": bool(existing),
    }


@api.post("/teams/{team_id}/needs/confirm")
async def confirm_team_needs(team_id: str, data: NeedConfirmIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    if data.season not in _current_seasons():
        raise HTTPException(400, "Ugyldig sesong")
    clean = []
    for ln in data.lines:
        if ln.get("errors"): continue
        if not ln.get("item_id"): continue
        clean.append({
            "id": new_id(),
            "item_type": ln.get("item_type"),
            "item_id": ln.get("item_id"),
            "item_name": ln.get("item_name"),
            "size": ln.get("size") or None,
            "jersey_number": ln.get("jersey_number") or None,
            "quantity": int(ln.get("quantity") or 0),
            "comment": ln.get("comment") or "",
            "original_item_id": ln.get("item_id"),
        })
    if not clean:
        raise HTTPException(400, "Ingen gyldige linjer å importere")
    if data.strategy == "replace":
        await db.team_needs.delete_many({"tenant_id": tid, "team_id": team_id, "season": data.season})
    doc = {
        "id": new_id(), "tenant_id": tid, "team_id": team_id, "season": data.season,
        "filename": data.filename or "", "lines": clean,
        "imported_by": user.get("name") or user.get("email"),
        "created_at": now_iso(),
    }
    await db.team_needs.insert_one(doc)
    return {"ok": True, "need_id": doc["id"]}


@api.delete("/teams/{team_id}/needs/{need_id}")
async def delete_team_need(team_id: str, need_id: str, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    r = await db.team_needs.delete_one({"id": need_id, "tenant_id": tid, "team_id": team_id})
    if not r.deleted_count:
        raise HTTPException(404, "Fant ikke")
    return {"ok": True}


# ============== LEVERANDØRER ==============
class SupplierIn(BaseModel):
    name: str
    address: str = ""
    postal_code: str = ""
    city: str = ""
    country: str = "Norge"
    email: str = ""
    phone: str = ""
    contact_person: str = ""
    org_number: str = ""
    notes: str = ""
    active: bool = True


async def _next_supplier_number(tid: str) -> str:
    key = f"supplier_counter_{tid}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"{seq:05d}"


@api.get("/suppliers")
async def list_suppliers(request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    # Backfill any suppliers missing supplier_number
    missing = await db.suppliers.find({"tenant_id": tid, "supplier_number": {"$in": [None, ""]}}, {"_id": 0}).to_list(500)
    for m in missing:
        num = await _next_supplier_number(tid)
        await db.suppliers.update_one({"id": m["id"], "tenant_id": tid}, {"$set": {"supplier_number": num}})
    return await db.suppliers.find({"tenant_id": tid}, {"_id": 0}).sort("name", 1).to_list(500)


@api.post("/suppliers")
async def create_supplier(data: SupplierIn, request: Request, user=Depends(require_admin)):
    tid = await require_tenant(request, user)
    if not data.name.strip():
        raise HTTPException(400, "Leverandørnavn er obligatorisk")
    num = await _next_supplier_number(tid)
    doc = {**data.dict(), "id": new_id(), "tenant_id": tid,
           "supplier_number": num, "created_at": now_iso()}
    await db.suppliers.insert_one(doc); doc.pop("_id", None); return doc


@api.put("/suppliers/{sid}")
async def update_supplier(sid: str, data: SupplierIn, request: Request, user=Depends(require_admin)):
    tid = await require_tenant(request, user)
    await db.suppliers.update_one({"id": sid, "tenant_id": tid}, {"$set": data.dict()})
    return await db.suppliers.find_one({"id": sid, "tenant_id": tid}, {"_id": 0})


@api.delete("/suppliers/{sid}")
async def delete_supplier(sid: str, request: Request, user=Depends(require_admin)):
    tid = await require_tenant(request, user)
    orders = await db.purchase_orders.count_documents({"tenant_id": tid, "supplier_id": sid})
    if orders:
        await db.suppliers.update_one({"id": sid, "tenant_id": tid}, {"$set": {"active": False}})
        return {"ok": True, "deactivated": True}
    await db.suppliers.delete_one({"id": sid, "tenant_id": tid})
    return {"ok": True}


@api.get("/suppliers/{sid}/orders")
async def supplier_orders(sid: str, request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    return await db.purchase_orders.find({"tenant_id": tid, "supplier_id": sid}, {"_id": 0}).sort("created_at", -1).to_list(500)


# ============== UNIQUE PO NUMBER ==============
async def _next_po_number(tid: str, prefix: str = "") -> str:
    """5-digit sequence per tenant per year, with -YY suffix. Thread-safe."""
    yr = datetime.now(timezone.utc).strftime("%y")
    key = f"po_{tid}_{yr}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"{prefix}{seq:05d}-{yr}"


# ============== BEHOVSSKJEMA ==============
class BehovsskjemaIn(BaseModel):
    team_id: str
    season: str


@api.post("/behovsskjema")
async def create_behovsskjema(data: BehovsskjemaIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    team = await db.teams.find_one({"id": data.team_id, "tenant_id": tid}, {"_id": 0})
    if not team:
        raise HTTPException(404, "Lag finnes ikke")
    if data.season not in _current_seasons():
        raise HTTPException(400, f"Ugyldig sesong. Gyldige: {', '.join(_current_seasons())}")
    po_num = await _next_po_number(tid)
    doc = {
        "id": new_id(), "tenant_id": tid, "po_number": po_num,
        "team_id": data.team_id, "team_name": team.get("team_name"),
        "age_class": team.get("age_class"), "season": data.season,
        "status": "ikke_sendt", "sent_at": None, "sent_to": None,
        "imported_at": None, "last_import_file": None,
        "notes": "", "created_at": now_iso(),
        "created_by": user.get("name") or user.get("email"),
    }
    await db.behovsskjema.insert_one(doc); doc.pop("_id", None)
    return doc


@api.get("/behovsskjema")
async def list_behovsskjema(request: Request, user=Depends(require_perm("teams", "read")), team_id: Optional[str] = None):
    tid = await require_tenant(request, user)
    q = {"tenant_id": tid}
    if team_id: q["team_id"] = team_id
    return await db.behovsskjema.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.put("/behovsskjema/{sid}")
async def update_behovsskjema(sid: str, data: dict, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    allowed = {k: data[k] for k in ("notes", "status", "sent_at", "sent_to",
                                     "recipient_name", "recipient_email", "message") if k in data}
    await db.behovsskjema.update_one({"id": sid, "tenant_id": tid}, {"$set": allowed})
    return await db.behovsskjema.find_one({"id": sid, "tenant_id": tid}, {"_id": 0})


@api.post("/behovsskjema/{sid}/send")
async def send_behovsskjema(sid: str, data: dict, request: Request, user=Depends(require_perm("teams", "write"))):
    """Send behovsskjema (Excel template) via email to lagleder."""
    tid = await require_tenant(request, user)
    bs = await db.behovsskjema.find_one({"id": sid, "tenant_id": tid}, {"_id": 0})
    if not bs:
        raise HTTPException(404, "Fant ikke")
    to_email = (data.get("recipient_email") or bs.get("recipient_email") or "").strip()
    if not to_email or not re.match(r"^[^@]+@[^@]+\.[^@]+$", to_email):
        raise HTTPException(400, "Ugyldig e-postadresse")
    if not EMAIL_KEY:
        raise HTTPException(503, "E-posttjeneste er ikke konfigurert")
    # Generate Excel template directly as bytes
    try:
        xlsx_bytes = await _build_needs_template_bytes(tid, bs["team_id"])
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Template generation failed")
        raise HTTPException(500, f"Kunne ikke generere mal: {e}")
    import base64
    att_b64 = base64.b64encode(xlsx_bytes).decode()
    recipient_name = data.get("recipient_name") or bs.get("recipient_name") or ""
    custom_msg = data.get("message") or bs.get("message") or ""
    club = await db.customers.find_one({"id": tid}, {"_id": 0}) or {}
    html = (
        f'<p>Hei {recipient_name or ""},</p>'
        f'<p>Her er behovsskjemaet for <strong>{bs.get("team_name")}</strong> '
        f'(årsklasse {bs.get("age_class")}, sesong {bs.get("season")}).</p>'
        f'<p><strong>Innkjøpsnummer:</strong> {bs.get("po_number")}</p>'
        + (f'<p>{custom_msg}</p>' if custom_msg else '')
        + f'<p>Vennligst fyll ut Excel-malen og returner den til oss.</p>'
        f'<p>Mvh<br/>{club.get("club_name") or "Klubben"}</p>'
    )
    filename = f"behovsskjema_{bs.get('po_number')}_{(bs.get('team_name') or '').replace(' ','_')}.xlsx"
    attachments = [{
        "filename": filename,
        "content": att_b64,
        "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }]
    cc_list = [user.get("email")] if user.get("email") else None
    res = await send_tenant_email(
        tid, to_email,
        f"Behovsskjema {bs.get('po_number')} – {bs.get('team_name')}",
        html, attachments=attachments, cc=cc_list,
    )
    if not res.get("ok"):
        raise HTTPException(502, f"E-post feilet: {res.get('error')}")
    provider_id = res.get("provider_id")
    await db.behovsskjema.update_one({"id": sid, "tenant_id": tid}, {"$set": {
        "status": "sendt", "sent_at": now_iso(), "sent_to": to_email,
        "recipient_name": recipient_name, "recipient_email": to_email,
        "last_email_id": provider_id,
    }})
    return {"ok": True, "sent_to": to_email, "provider_id": provider_id, "method": res.get("method")}


@api.delete("/behovsskjema/{sid}")
async def delete_behovsskjema(sid: str, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    bs = await db.behovsskjema.find_one({"id": sid, "tenant_id": tid})
    if not bs:
        raise HTTPException(404, "Fant ikke")
    orders = await db.purchase_orders.count_documents({"tenant_id": tid, "behovsskjema_id": sid})
    if orders:
        await db.behovsskjema.update_one({"id": sid, "tenant_id": tid}, {"$set": {"status": "arkivert"}})
        return {"ok": True, "archived": True}
    await db.behovsskjema.delete_one({"id": sid, "tenant_id": tid})
    return {"ok": True}


# ============== PURCHASE ORDERS (LEVERANDØRBESTILLINGER) ==============
class OrderLineIn(BaseModel):
    item_id: Optional[str] = None
    item_name: str
    size: Optional[str] = None
    jersey_number: Optional[str] = None
    quantity: int
    unit_price: float = 0.0


class PurchaseOrderIn(BaseModel):
    supplier_id: str
    behovsskjema_id: Optional[str] = None  # None for lagerbestilling
    team_id: Optional[str] = None  # None for lagerbestilling
    season: Optional[str] = None
    is_stock_order: bool = False
    lines: List[OrderLineIn]
    notes: str = ""
    delivery_date: Optional[str] = None


@api.post("/orders")
async def create_order(data: PurchaseOrderIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    supplier = await db.suppliers.find_one({"id": data.supplier_id, "tenant_id": tid}, {"_id": 0})
    if not supplier:
        raise HTTPException(404, "Leverandør finnes ikke")
    if not data.lines:
        raise HTTPException(400, "Minst én varelinje kreves")
    # Lagerbestilling: new LB-prefix number. Team order: reuse behovsskjema's po_number.
    po_number = None
    behov = None
    if data.is_stock_order:
        po_number = await _next_po_number(tid, prefix="LB")
    else:
        if not data.behovsskjema_id:
            raise HTTPException(400, "behovsskjema_id kreves for lagsbestilling")
        behov = await db.behovsskjema.find_one({"id": data.behovsskjema_id, "tenant_id": tid}, {"_id": 0})
        if not behov:
            raise HTTPException(404, "Behovsskjema finnes ikke")
        po_number = behov["po_number"]
    total = sum((ln.quantity or 0) * (ln.unit_price or 0) for ln in data.lines)
    order_lines = []
    for ln in data.lines:
        order_lines.append({
            "id": new_id(), **ln.dict(),
            "received_quantity": 0, "line_status": "ulevert",
            "receipts": [], "reserved_from_po": None, "reserved_for_po": None,
        })
    doc = {
        "id": new_id(), "tenant_id": tid, "po_number": po_number,
        "supplier_id": data.supplier_id, "supplier_name": supplier.get("name"),
        "behovsskjema_id": data.behovsskjema_id,
        "team_id": data.team_id or (behov["team_id"] if behov else None),
        "team_name": behov["team_name"] if behov else None,
        "age_class": behov["age_class"] if behov else None,
        "season": data.season or (behov["season"] if behov else None),
        "is_stock_order": data.is_stock_order,
        "lines": order_lines, "notes": data.notes,
        "delivery_date": data.delivery_date,
        "status": "bestilt",  # bestilt | delvis_levert | levert | manko | restbestilling | arkivert
        "manual_status": None, "manual_status_reason": None,
        "status_history": [{"status": "bestilt", "at": now_iso(), "by": user.get("name"), "note": "Opprettet"}],
        "pdf_versions": [],
        "sent_at": None, "sent_to": None,
        "total_amount": total,
        "created_at": now_iso(), "created_by": user.get("name") or user.get("email"),
        "ready_for_pickup_notified": False,
    }
    await db.purchase_orders.insert_one(doc)
    if data.behovsskjema_id:
        await db.behovsskjema.update_one({"id": data.behovsskjema_id, "tenant_id": tid},
                                         {"$set": {"status": "bestilt"}})
    doc.pop("_id", None)
    return doc


@api.get("/orders")
async def list_orders(request: Request, user=Depends(get_current_user),
                      team_id: Optional[str] = None, supplier_id: Optional[str] = None,
                      is_stock_order: Optional[bool] = None):
    tid = await require_tenant(request, user)
    q = {"tenant_id": tid}
    if team_id: q["team_id"] = team_id
    if supplier_id: q["supplier_id"] = supplier_id
    if is_stock_order is not None: q["is_stock_order"] = is_stock_order
    return await db.purchase_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.get("/orders/by-po/{po_number}")
async def get_order_by_po(po_number: str, request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    o = await db.purchase_orders.find_one({"tenant_id": tid, "po_number": po_number}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Fant ingen bestilling med dette nummeret")
    return o


class OrderReceiveLine(BaseModel):
    line_id: str
    quantity: int
    comment: str = ""
    confirm_over: bool = False


class OrderReceiveIn(BaseModel):
    receipts: List[OrderReceiveLine]
    request_id: Optional[str] = None


@api.post("/orders/{oid}/receive")
async def receive_order(oid: str, data: OrderReceiveIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    # idempotency
    if data.request_id:
        existing = await db.stock_receipts.find_one({"tenant_id": tid, "request_id": data.request_id}, {"_id": 0})
        if existing:
            return {"ok": True, "idempotent": True}
    order = await db.purchase_orders.find_one({"id": oid, "tenant_id": tid})
    if not order:
        raise HTTPException(404, "Bestilling finnes ikke")
    lines = order.get("lines") or []
    updates = []
    for rec in data.receipts:
        if rec.quantity <= 0: continue
        ln = next((l for l in lines if l["id"] == rec.line_id), None)
        if not ln:
            raise HTTPException(400, f"Fant ikke linje {rec.line_id}")
        remaining = (ln.get("quantity") or 0) - (ln.get("received_quantity") or 0)
        if rec.quantity > remaining and not rec.confirm_over:
            raise HTTPException(400, f"Mottatt {rec.quantity} er mer enn restantall {remaining}. Bekreft med confirm_over.")
        ln["received_quantity"] = (ln.get("received_quantity") or 0) + rec.quantity
        ln["receipts"] = (ln.get("receipts") or []) + [{
            "at": now_iso(), "by": user.get("name"), "quantity": rec.quantity, "comment": rec.comment,
        }]
        if ln["received_quantity"] >= (ln.get("quantity") or 0):
            ln["line_status"] = "levert"; ln["delivered_at"] = now_iso()
        else:
            ln["line_status"] = "delvis_levert"
        # Update inventory
        if ln.get("item_id"):
            item = await db.items.find_one({"id": ln["item_id"], "tenant_id": tid})
            if item:
                if item.get("is_clothing") or item.get("is_ball"):
                    sizes = item.get("sizes") or []
                    for s in sizes:
                        if s.get("size") == ln.get("size"):
                            s["quantity"] = int(s.get("quantity") or 0) + rec.quantity
                            break
                    new_total = sum(int(s.get("quantity") or 0) for s in sizes)
                    await db.items.update_one({"id": ln["item_id"], "tenant_id": tid},
                                              {"$set": {"sizes": sizes, "total_stock": new_total}})
                else:
                    await db.items.update_one({"id": ln["item_id"], "tenant_id": tid},
                                              {"$inc": {"total_stock": rec.quantity}})
        # Also log in stock_receipts for history
        await db.stock_receipts.insert_one({
            "id": new_id(), "tenant_id": tid, "request_id": data.request_id,
            "item_id": ln.get("item_id"), "item_name": ln.get("item_name"),
            "size": ln.get("size"), "jersey_number": ln.get("jersey_number"),
            "quantity": rec.quantity, "qty_before": 0, "qty_after": 0,
            "order_ref": order.get("po_number"), "comment": rec.comment,
            "order_id": oid, "order_line_id": ln["id"],
            "user_id": user.get("id"), "user_name": user.get("name"),
            "created_at": now_iso(),
        })
        updates.append(ln["id"])
    # Order status
    all_lines = lines
    total_q = sum(l.get("quantity") or 0 for l in all_lines)
    recv_q = sum(l.get("received_quantity") or 0 for l in all_lines)
    new_status = "bestilt"
    if recv_q >= total_q and total_q > 0: new_status = "levert"
    elif recv_q > 0: new_status = "delvis_levert"
    status_entry = {"status": new_status, "at": now_iso(), "by": user.get("name"), "note": f"Mottak {len(updates)} linjer"}
    await db.purchase_orders.update_one({"id": oid, "tenant_id": tid},
                                        {"$set": {"lines": lines, "status": new_status},
                                         "$push": {"status_history": status_entry}})
    return {"ok": True, "status": new_status, "lines_updated": updates}


class ManualStatusIn(BaseModel):
    status: str
    reason: str


@api.post("/orders/{oid}/manual-status")
async def set_manual_status(oid: str, data: ManualStatusIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    if not data.reason.strip():
        raise HTTPException(400, "Begrunnelse er påkrevd ved manuell statusendring")
    allowed = {"bestilt", "delvis_levert", "levert", "manko", "restbestilling", "arkivert"}
    if data.status not in allowed:
        raise HTTPException(400, "Ugyldig status")
    order = await db.purchase_orders.find_one({"id": oid, "tenant_id": tid})
    if not order:
        raise HTTPException(404, "Fant ikke")
    entry = {"status": data.status, "at": now_iso(), "by": user.get("name"),
             "note": f"Manuell: {data.reason}", "manual": True, "from_status": order.get("status")}
    await db.purchase_orders.update_one({"id": oid, "tenant_id": tid},
                                        {"$set": {"status": data.status,
                                                  "manual_status": data.status,
                                                  "manual_status_reason": data.reason},
                                         "$push": {"status_history": entry}})
    return {"ok": True}


@api.post("/orders/{oid}/resume-auto-status")
async def resume_auto_status(oid: str, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    order = await db.purchase_orders.find_one({"id": oid, "tenant_id": tid})
    if not order:
        raise HTTPException(404, "Fant ikke")
    lines = order.get("lines") or []
    total_q = sum(l.get("quantity") or 0 for l in lines)
    recv_q = sum(l.get("received_quantity") or 0 for l in lines)
    auto = "bestilt"
    if total_q > 0 and recv_q >= total_q: auto = "levert"
    elif recv_q > 0: auto = "delvis_levert"
    entry = {"status": auto, "at": now_iso(), "by": user.get("name"), "note": "Gjenopptok automatisk status"}
    await db.purchase_orders.update_one({"id": oid, "tenant_id": tid},
                                        {"$set": {"status": auto, "manual_status": None, "manual_status_reason": None},
                                         "$push": {"status_history": entry}})
    return {"ok": True, "status": auto}


# ============== ORDER PDF ==============
def _build_order_pdf(order: dict, club: dict, supplier: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdf_canvas
    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    y = h - 20 * mm
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20 * mm, y, "BESTILLING")
    c.setFont("Helvetica", 9)
    c.drawRightString(w - 20 * mm, y, f"Innkjøpsnr: {order['po_number']}")
    y -= 6 * mm
    try:
        dt = datetime.fromisoformat(order['created_at'].replace("Z","+00:00"))
        c.drawRightString(w - 20 * mm, y, f"Dato: {dt.strftime('%d.%m.%Y')}")
    except Exception: pass
    # Club
    y_i = h - 35 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y_i, (club or {}).get("name") or (club or {}).get("club_name") or "Klubb")
    c.setFont("Helvetica", 9)
    y_i -= 4 * mm
    for key in ("address", "postal_code", "city", "email", "phone"):
        v = (club or {}).get(key)
        if v: c.drawString(20 * mm, y_i, str(v)); y_i -= 4 * mm
    # Supplier
    y_s = h - 35 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(110 * mm, y_s, "Leverandør:")
    c.setFont("Helvetica", 9)
    y_s -= 4 * mm
    c.drawString(110 * mm, y_s, supplier.get("name", "")); y_s -= 4 * mm
    if supplier.get("address"): c.drawString(110 * mm, y_s, supplier["address"]); y_s -= 4 * mm
    if supplier.get("postal_code") or supplier.get("city"):
        c.drawString(110 * mm, y_s, f"{supplier.get('postal_code','')} {supplier.get('city','')}"); y_s -= 4 * mm
    if supplier.get("email"): c.drawString(110 * mm, y_s, supplier["email"]); y_s -= 4 * mm
    # Team/season
    y = h - 70 * mm
    if order.get("team_name"):
        c.setFont("Helvetica-Bold", 10)
        c.drawString(20 * mm, y, f"Lag: {order['team_name']}  ·  Årsklasse: {order.get('age_class','')}  ·  Sesong: {order.get('season','')}")
        y -= 7 * mm
    else:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(20 * mm, y, "Lagerbestilling"); y -= 7 * mm
    # Table header
    c.setFont("Helvetica-Bold", 9)
    c.drawString(20 * mm, y, "Vare")
    c.drawString(90 * mm, y, "Str/#")
    c.drawRightString(130 * mm, y, "Antall")
    c.drawRightString(155 * mm, y, "À-pris")
    c.drawRightString(w - 20 * mm, y, "Sum")
    y -= 2 * mm; c.line(20 * mm, y, w - 20 * mm, y); y -= 5 * mm
    c.setFont("Helvetica", 9)
    total = 0
    for ln in order.get("lines") or []:
        qty = ln.get("quantity") or 0; price = ln.get("unit_price") or 0
        s = qty * price; total += s
        c.drawString(20 * mm, y, (ln.get("item_name") or "")[:50])
        sz = ln.get("size") or ""
        jn = ln.get("jersey_number") or ""
        c.drawString(90 * mm, y, f"{sz}{' #'+jn if jn and jn != 'X' else ''}")
        c.drawRightString(130 * mm, y, str(qty))
        c.drawRightString(155 * mm, y, f"{price:,.2f}".replace(",", " "))
        c.drawRightString(w - 20 * mm, y, f"{s:,.2f}".replace(",", " "))
        y -= 5 * mm
        if y < 50 * mm: c.showPage(); y = h - 20 * mm
    y -= 3 * mm; c.line(20 * mm, y, w - 20 * mm, y); y -= 6 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(110 * mm, y, "Totalt (eks. mva):")
    c.drawRightString(w - 20 * mm, y, f"NOK {total:,.2f}".replace(",", " "))
    y -= 5 * mm
    c.setFont("Helvetica", 8)
    c.drawString(110 * mm, y, "MVA 25% kommer i tillegg der det er aktuelt.")
    if order.get("notes"):
        y -= 10 * mm
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(20 * mm, y, f"Notat: {order['notes'][:150]}")
    c.save()
    return buf.getvalue()


@api.get("/orders/{oid}/pdf")
async def get_order_pdf(oid: str, request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    order = await db.purchase_orders.find_one({"id": oid, "tenant_id": tid}, {"_id": 0})
    if not order: raise HTTPException(404, "Fant ikke")
    supplier = await db.suppliers.find_one({"id": order["supplier_id"], "tenant_id": tid}, {"_id": 0}) or {}
    cust = await db.customers.find_one({"id": tid}, {"_id": 0}) or {}
    club = await db.club_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    if not club.get("name"):
        club = {"name": cust.get("club_name"), "email": cust.get("owner_email"),
                "phone": cust.get("owner_phone"), "address": cust.get("address", ""),
                "postal_code": cust.get("postal_code", ""), "city": cust.get("city", "")}
    try:
        pdf = _build_order_pdf(order, club, supplier)
    except Exception as e:
        logger.exception("PDF generation failed")
        raise HTTPException(500, f"PDF-feil: {e}")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="bestilling_{order["po_number"]}.pdf"'})


# ============== UDEKKET BEHOV + RESERVATIONS ==============
@api.get("/behovsskjema/{sid}/udekket")
async def get_udekket_behov(sid: str, request: Request, user=Depends(require_perm("teams", "read"))):
    """Returnerer udekket behov for et skjema, basert på behovs-import OG tidligere bestilte mengder."""
    tid = await require_tenant(request, user)
    bs = await db.behovsskjema.find_one({"id": sid, "tenant_id": tid}, {"_id": 0})
    if not bs: raise HTTPException(404, "Fant ikke")
    # Fetch team-needs for this team+season
    needs = await db.team_needs.find({"tenant_id": tid, "team_id": bs["team_id"], "season": bs["season"]}, {"_id": 0}).to_list(500)
    coverage = await _compute_need_coverage(tid, needs)
    # Reduce must_order by amounts already in existing non-archived orders for this behovsskjema
    prev_orders = await db.purchase_orders.find({"tenant_id": tid, "behovsskjema_id": sid,
                                                 "status": {"$nin": ["arkivert"]}}, {"_id": 0}).to_list(500)
    already = {}
    for o in prev_orders:
        for ln in o.get("lines") or []:
            k = f"{ln.get('item_id')}|{ln.get('size') or ''}|{ln.get('jersey_number') or ''}"
            already[k] = already.get(k, 0) + int(ln.get("quantity") or 0)
    # Find open stock orders (LB) that could reserve
    stock_orders = await db.purchase_orders.find({"tenant_id": tid, "is_stock_order": True,
                                                   "status": {"$in": ["bestilt", "delvis_levert"]}}, {"_id": 0}).to_list(500)
    stock_available = {}
    for o in stock_orders:
        for ln in o.get("lines") or []:
            if ln.get("reserved_for_po"): continue
            remaining = (ln.get("quantity") or 0) - (ln.get("received_quantity") or 0)
            if remaining <= 0: continue
            k = f"{ln.get('item_id')}|{ln.get('size') or ''}|{ln.get('jersey_number') or ''}"
            stock_available.setdefault(k, []).append({
                "order_id": o["id"], "line_id": ln["id"], "po_number": o["po_number"],
                "remaining": remaining,
            })
    out = []
    for l in coverage:
        k = f"{l['item_id']}|{l.get('size') or ''}|{l.get('jersey_number') or ''}"
        already_ordered = already.get(k, 0)
        remaining_to_order = max(0, l["must_order"] - already_ordered)
        out.append({**l, "already_ordered": already_ordered,
                    "remaining_to_order": remaining_to_order,
                    "stock_order_candidates": stock_available.get(k, [])})
    return {"behovsskjema": bs, "lines": out}


class ReserveStockIn(BaseModel):
    stock_order_id: str
    stock_line_id: str
    behovsskjema_id: str
    quantity: int


@api.post("/stock-reservations")
async def reserve_from_stock_order(data: ReserveStockIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    bs = await db.behovsskjema.find_one({"id": data.behovsskjema_id, "tenant_id": tid}, {"_id": 0})
    if not bs: raise HTTPException(404, "Behovsskjema finnes ikke")
    order = await db.purchase_orders.find_one({"id": data.stock_order_id, "tenant_id": tid})
    if not order: raise HTTPException(404, "Lagerbestilling finnes ikke")
    lines = order.get("lines") or []
    found = next((l for l in lines if l["id"] == data.stock_line_id), None)
    if not found: raise HTTPException(404, "Linje finnes ikke")
    if found.get("reserved_for_po"):
        raise HTTPException(400, f"Linje er allerede reservert til {found['reserved_for_po']}")
    found["reserved_for_po"] = bs["po_number"]
    found["reserved_for_team"] = bs["team_name"]
    found["reserved_quantity"] = data.quantity
    await db.purchase_orders.update_one({"id": data.stock_order_id, "tenant_id": tid}, {"$set": {"lines": lines}})
    return {"ok": True, "reserved_po": bs["po_number"]}


# ============== NOTIFY LAGLEDER (SMS + email) ==============
class NotifyIn(BaseModel):
    channel: str  # email | sms | both
    message: Optional[str] = None  # editable preview; falls back to default


async def _send_sms(to: str, body: str) -> dict:
    """Returns {ok, provider_id, error}. Requires Twilio env vars."""
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER):
        return {"ok": False, "error": "Twilio er ikke konfigurert. Legg til TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN og TWILIO_FROM_NUMBER i miljøvariabler."}
    try:
        from twilio.rest import Client
        c = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        m = c.messages.create(body=body, from_=TWILIO_FROM_NUMBER, to=to)
        return {"ok": True, "provider_id": m.sid}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _send_plain_email(to: str, subject: str, html: str) -> dict:
    if not EMAIL_KEY: return {"ok": False, "error": "E-posttjeneste ikke konfigurert"}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY},
                             json={"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME})
        r.raise_for_status()
        return {"ok": True, "provider_id": r.json().get("id")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# =============== TENANT EMAIL SETTINGS (per-klubb avsender) ===============
def _redact_email_cfg(cfg: dict) -> dict:
    """Return safe-to-ship representation (never password/API-key)."""
    if not cfg: cfg = {}
    return {
        "method": cfg.get("method") or "default",
        "from_name": cfg.get("from_name") or "",
        "from_email": cfg.get("from_email") or "",
        "smtp_host": cfg.get("smtp_host") or "",
        "smtp_port": cfg.get("smtp_port") or 587,
        "smtp_username": cfg.get("smtp_username") or "",
        "smtp_password_set": bool(cfg.get("smtp_password_enc")),
        "smtp_password_masked": _mask_secret(_dec(cfg.get("smtp_password_enc") or "")) if cfg.get("smtp_password_enc") else "",
        "smtp_use_tls": bool(cfg.get("smtp_use_tls", True)),
        "smtp_use_ssl": bool(cfg.get("smtp_use_ssl", False)),
        "resend_api_key_set": bool(cfg.get("resend_api_key_enc")),
        "resend_api_key_masked": _mask_secret(_dec(cfg.get("resend_api_key_enc") or "")) if cfg.get("resend_api_key_enc") else "",
        "verified_at": cfg.get("verified_at"),
        "last_test_at": cfg.get("last_test_at"),
        "last_test_ok": cfg.get("last_test_ok"),
        "last_test_error": cfg.get("last_test_error"),
    }


@api.get("/email-settings")
async def get_email_settings(request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    cfg = await _get_tenant_email_cfg(tid)
    return _redact_email_cfg(cfg)


@api.put("/email-settings")
async def put_email_settings(data: TenantEmailSettingsIn, request: Request, user=Depends(require_perm("inventory", "admin"))):
    tid = await require_tenant(request, user)
    method = (data.method or "default").lower()
    if method not in ("default", "smtp", "resend"):
        raise HTTPException(400, "Ugyldig metode")
    existing = await _get_tenant_email_cfg(tid)
    update = {
        "tenant_id": tid,
        "method": method,
        "from_name": (data.from_name or "").strip() or existing.get("from_name") or "",
        "from_email": (data.from_email or "").strip() if data.from_email else existing.get("from_email", ""),
        "smtp_host": (data.smtp_host or "").strip(),
        "smtp_port": int(data.smtp_port or 587),
        "smtp_username": (data.smtp_username or "").strip(),
        "smtp_use_tls": bool(data.smtp_use_tls),
        "smtp_use_ssl": bool(data.smtp_use_ssl),
        "updated_at": now_iso(),
        "updated_by": user.get("email"),
    }
    # Preserve or update encrypted secrets
    if data.smtp_password:
        update["smtp_password_enc"] = _enc(data.smtp_password)
    else:
        update["smtp_password_enc"] = existing.get("smtp_password_enc", "")
    if data.resend_api_key:
        update["resend_api_key_enc"] = _enc(data.resend_api_key)
    else:
        update["resend_api_key_enc"] = existing.get("resend_api_key_enc", "")
    await db.tenant_email_settings.update_one({"tenant_id": tid}, {"$set": update}, upsert=True)
    cfg = await _get_tenant_email_cfg(tid)
    return _redact_email_cfg(cfg)


@api.post("/email-settings/test")
async def test_email_settings(data: EmailTestIn, request: Request, user=Depends(require_perm("inventory", "admin"))):
    tid = await require_tenant(request, user)
    to = data.to or user.get("email")
    if not to:
        raise HTTPException(400, "Mangler mottakers e-post")
    cfg = await _get_tenant_email_cfg(tid)
    method = (cfg.get("method") or "default")
    html = (
        f'<p>Hei!</p><p>Dette er en test av e-postoppsettet for <strong>{cfg.get("from_name") or EMAIL_FROM_NAME}</strong>.</p>'
        f'<p>Metode: <code>{method}</code><br/>Avsender: {cfg.get("from_email") or "(standard)"}</p>'
        f'<p>Hvis du har fått denne, fungerer e-postoppsettet.</p>'
        f'<p style="color:#64748b;font-size:12px">Sendt {now_iso()}</p>'
    )
    res = await send_tenant_email(tid, to, "Test-epost fra Utstyrsrommet", html)
    await db.tenant_email_settings.update_one({"tenant_id": tid}, {"$set": {
        "last_test_at": now_iso(),
        "last_test_ok": bool(res.get("ok")),
        "last_test_error": res.get("error") if not res.get("ok") else None,
        "verified_at": now_iso() if res.get("ok") and method != "default" else cfg.get("verified_at"),
    }}, upsert=True)
    if not res.get("ok"):
        raise HTTPException(502, f"Test-epost feilet: {res.get('error')}")
    return {"ok": True, "to": to, "method": res.get("method"), "provider_id": res.get("provider_id")}


@api.post("/orders/{oid}/notify-lagleder")
async def notify_lagleder(oid: str, data: NotifyIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    order = await db.purchase_orders.find_one({"id": oid, "tenant_id": tid}, {"_id": 0})
    if not order: raise HTTPException(404, "Fant ikke")
    if not order.get("team_id"):
        raise HTTPException(400, "Dette er en lagerbestilling – lagleder kan ikke varsles.")
    # Verify ready: all lines delivered
    lines = order.get("lines") or []
    total_q = sum(l.get("quantity") or 0 for l in lines)
    recv_q = sum(l.get("received_quantity") or 0 for l in lines)
    if total_q == 0 or recv_q < total_q:
        raise HTTPException(400, f"Bestillingen er ikke fullstendig mottatt ({recv_q}/{total_q}). Varsling er deaktivert.")
    if order.get("ready_for_pickup_notified"):
        raise HTTPException(409, "Lagleder er allerede varslet for denne bestillingen.")
    team = await db.teams.find_one({"id": order["team_id"], "tenant_id": tid}, {"_id": 0}) or {}
    cust = await db.customers.find_one({"id": tid}, {"_id": 0}) or {}
    tm = team.get("team_manager") or {}
    hc = team.get("head_coach") or {}
    recipient = tm if (tm.get("email") or tm.get("phone")) else hc
    if not (recipient.get("email") or recipient.get("phone")):
        raise HTTPException(400, "Mangler kontaktinformasjon på lagleder/hovedtrener.")
    club_name = cust.get("club_name") or "klubben"
    contact = cust.get("owner_name") or cust.get("owner_email") or ""
    default_msg = (
        f"Hei! Utstyret til {order['team_name']}, sesong {order.get('season','')}, "
        f"med innkjøpsnummer {order['po_number']}, har nå ankommet og er mottatt. "
        f"Varene er klare for henting. Ta kontakt med {contact} for å avtale henting. "
        f"OBS! Denne meldingen kan ikke besvares.\n\nHilsen {club_name}"
    )
    body = (data.message or default_msg).strip()
    log = []
    user_email = user.get("email")
    # Build attachments (order PDF) for email
    attachments = None
    try:
        supplier = await db.suppliers.find_one({"id": order["supplier_id"], "tenant_id": tid}, {"_id": 0}) or {}
        club = await db.club_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {}
        if not club.get("name"):
            club = {"name": cust.get("club_name"), "email": cust.get("owner_email"),
                    "phone": cust.get("owner_phone"), "address": cust.get("address", ""),
                    "postal_code": cust.get("postal_code", ""), "city": cust.get("city", "")}
        pdf_bytes = _build_order_pdf(order, club, supplier)
        attachments = [{
            "filename": f"bestilling_{order['po_number']}.pdf",
            "content": _b64mod.b64encode(pdf_bytes).decode(),
            "content_type": "application/pdf",
        }]
    except Exception as e:
        logger.warning(f"Kunne ikke generere PDF for varsling: {e}")
    if data.channel in ("sms", "both") and recipient.get("phone"):
        r = await _send_sms(recipient["phone"], body)
        log.append({"channel": "sms", "to": recipient["phone"], "at": now_iso(), **r})
    if data.channel in ("email", "both") and recipient.get("email"):
        html = f'<pre style="font-family:Arial;font-size:13px;white-space:pre-wrap">{body}</pre>'
        r = await send_tenant_email(tid, recipient["email"],
                                    f"Utstyret for {order['team_name']} er klart",
                                    html, attachments=attachments,
                                    cc=[user_email] if user_email else None)
        log.append({"channel": "email", "to": recipient["email"], "at": now_iso(), **r})
    any_ok = any(x.get("ok") for x in log)
    update = {"$push": {"notification_log": {"$each": log}}}
    if any_ok:
        update["$set"] = {"ready_for_pickup_notified": True, "notified_at": now_iso()}
    await db.purchase_orders.update_one({"id": oid, "tenant_id": tid}, update)
    return {"ok": any_ok, "log": log}


# =========== Send purchase order PDF to supplier/anyone ===========
class OrderSendIn(BaseModel):
    to: EmailStr
    cc: Optional[EmailStr] = None
    subject: Optional[str] = None
    message: Optional[str] = None


@api.post("/orders/{oid}/send")
async def send_order_email(oid: str, data: OrderSendIn, request: Request, user=Depends(require_perm("teams", "write"))):
    """Send bestillings-PDF som vedlegg til leverandør eller annen mottaker."""
    tid = await require_tenant(request, user)
    order = await db.purchase_orders.find_one({"id": oid, "tenant_id": tid}, {"_id": 0})
    if not order: raise HTTPException(404, "Fant ikke bestilling")
    supplier = await db.suppliers.find_one({"id": order["supplier_id"], "tenant_id": tid}, {"_id": 0}) or {}
    cust = await db.customers.find_one({"id": tid}, {"_id": 0}) or {}
    club = await db.club_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    if not club.get("name"):
        club = {"name": cust.get("club_name"), "email": cust.get("owner_email"),
                "phone": cust.get("owner_phone"), "address": cust.get("address", ""),
                "postal_code": cust.get("postal_code", ""), "city": cust.get("city", "")}
    try:
        pdf_bytes = _build_order_pdf(order, club, supplier)
    except Exception as e:
        logger.exception("PDF generation failed")
        raise HTTPException(500, f"PDF-feil: {e}")
    pdf_b64 = _b64mod.b64encode(pdf_bytes).decode()
    filename = f"bestilling_{order['po_number']}.pdf"
    club_name = club.get("name") or "klubben"
    subject = (data.subject or f"Bestilling {order['po_number']} fra {club_name}").strip()
    msg = (data.message or "").strip()
    html = (
        f'<p>Hei {supplier.get("name") or ""},</p>'
        f'<p>Vedlagt følger bestilling <strong>{order["po_number"]}</strong> fra {club_name}.</p>'
        + (f'<p>{msg}</p>' if msg else '')
        + f'<p>Vennligst bekreft mottak og forventet leveringsdato.</p>'
        f'<p>Mvh<br/>{club_name}</p>'
    )
    user_email = user.get("email")
    cc_list = []
    if data.cc: cc_list.append(data.cc)
    if user_email and user_email not in cc_list and user_email != data.to: cc_list.append(user_email)
    attachments = [{"filename": filename, "content": pdf_b64, "content_type": "application/pdf"}]
    res = await send_tenant_email(tid, data.to, subject, html,
                                   attachments=attachments, cc=cc_list or None)
    if not res.get("ok"):
        raise HTTPException(502, f"E-post feilet: {res.get('error')}")
    await db.purchase_orders.update_one({"id": oid, "tenant_id": tid}, {"$set": {
        "sent_at": now_iso(), "sent_to": data.to, "last_email_id": res.get("provider_id"),
    }, "$push": {"status_history": {"status": order.get("status"), "at": now_iso(),
                                     "by": user.get("name"), "note": f"PDF sendt til {data.to}"}}})
    return {"ok": True, "sent_to": data.to, "provider_id": res.get("provider_id"), "method": res.get("method")}


@api.get("/teams/{team_id}/purchase-history")
async def team_purchase_history(team_id: str, request: Request, user=Depends(require_perm("teams", "read"))):
    """Lagshistorikk: Total innkjøpspris per år og per måned."""
    tid = await require_tenant(request, user)
    orders = await db.purchase_orders.find({"tenant_id": tid, "team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    years = {}
    for o in orders:
        try:
            dt = datetime.fromisoformat(o.get("created_at").replace("Z", "+00:00") if o.get("created_at") else "")
        except Exception:
            continue
        y = dt.year; m = dt.month
        total = sum((ln.get("quantity") or 0) * (ln.get("unit_price") or 0) for ln in o.get("lines", []))
        years.setdefault(y, {"year": y, "total": 0, "months": {i: 0 for i in range(1, 13)}, "orders": []})
        years[y]["total"] += total
        years[y]["months"][m] = (years[y]["months"][m] or 0) + total
        years[y]["orders"].append({
            "id": o["id"], "po_number": o["po_number"],
            "supplier_name": o.get("supplier_name"), "status": o.get("status"),
            "total": total, "created_at": o.get("created_at"),
            "season": o.get("season"),
        })
    return {"years": sorted(years.values(), key=lambda x: -x["year"]), "orders": orders}


app.include_router(api)

app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"], expose_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
