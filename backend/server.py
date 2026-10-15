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
        "key": "basic", "name": "Klubb Basic", "price": 249, "lookup_key": "utr_basic_monthly",
        "max_teams": 3, "max_users": 0,  # no extra users beyond admin
        "stock_audit": False, "excel_export": False, "excel_import": False,
        "logo_upload": False, "settings": False,
        "features": ["Dashboard", "Inntil 3 lag", "Personer", "Utstyr", "Utlån & Retur", "1 admin-bruker"],
    },
    "pro": {
        "key": "pro", "name": "Klubb Pro", "price": 449, "lookup_key": "utr_pro_monthly",
        "max_teams": 10, "max_users": 3,
        "stock_audit": True, "excel_export": True, "excel_import": False,
        "logo_upload": False, "settings": False,
        "features": ["Alt i Basic", "Inntil 10 lag", "3 ekstra brukere", "Varetelling", "Excel-eksport (beholdning + lag)", "Invitasjons-epost"],
    },
    "deluxe": {
        # Intern nøkkel beholdes som "deluxe" for bakoverkompatibilitet med DB-records.
        # Visningsnavnet er "Klubb Premium" fra og med Introduksjonspris 2026.
        "key": "deluxe", "name": "Klubb Premium", "price": 849, "lookup_key": "utr_deluxe_monthly",
        "max_teams": None, "max_users": 5,
        "stock_audit": True, "excel_export": True, "excel_import": True,
        "logo_upload": True, "settings": True, "allow_user_addon": True,
        "qr_codes": True, "product_images": True,
        "team_portal": True,  # Lagsportal (utstyrsrommet.no/portal) kun for Premium
        "features": ["Alt i Pro", "Ubegrenset lag", "5 ekstra brukere inkludert", "Kjøp flere brukere for 199,-/mnd", "Excel-import m/mal", "Klubbinnstillinger + logo", "Produktbilder", "QR-koder for utstyr", "Lagsportal (utstyrsrommet.no/portal)", "Prioritert support"],
    },
}

MODULES = ["dashboard", "teams", "people", "inventory", "loans", "stock_audit", "users", "settings"]


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
        # Platform-eier (app-eier) skal ALDRI logges i noen klubbs synlige logger.
        if user.get("role") != "platform_owner":
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
    """Return current tenant_id based on user and impersonation cookie.

    Platform-eier er standalone og ikke knyttet til noen klubb. Når platform-eier
    ikke impersonerer en kunde returneres None – da vises OwnerStandaloneDashboard
    og alle tenant-scopede endepunkter må enten returnere tomt eller 400.
    """
    if user.get("role") == "platform_owner":
        imp = request.cookies.get("imp_cid")
        if imp:
            cust = await db.customers.find_one({"id": imp})
            if cust:
                return cust["id"]
        return None  # Platform-eier uten impersonering = ingen klubbkontekst
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
    # Aktiv prøveperiode = full Premium
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
def _build_user_signature_html(user: Optional[dict]) -> str:
    """Bygg standard HTML-signatur fra pålogget bruker. Navn + rolle/tittel + telefon + e-post."""
    if not user:
        return ""
    name = (user.get("name") or "").strip()
    title = (user.get("role_title") or "").strip()
    phone = (user.get("phone") or "").strip()
    email = (user.get("email") or "").strip()
    lines = []
    if name: lines.append(f'<strong style="color:#1e293b">{name}</strong>')
    if title: lines.append(f'<span style="color:#64748b">{title}</span>')
    if phone: lines.append(f'<span style="color:#64748b">Tlf: {phone}</span>')
    if email: lines.append(f'<a href="mailto:{email}" style="color:#991b1b;text-decoration:none">{email}</a>')
    if not lines:
        return ""
    return (
        '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px 0" />'
        '<p style="font-family:Arial,sans-serif;font-size:12px;line-height:1.6;margin:0;color:#475569">'
        + "<br/>".join(lines) +
        '</p>'
    )


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
        intro = f"Hei {club_name}! I dag er siste dag av den gratis Premium-prøveperioden hos <strong>{EMAIL_FROM_NAME}</strong>."
        urgency = "Velg en pakke nå for å unngå at kontoen settes i les-kun-modus i morgen."
        subject = f"Siste dag: {EMAIL_FROM_NAME}-prøveperioden utløper i dag"
    else:
        headline = f"{days_left} dager igjen av prøveperioden"
        intro = f"Hei {club_name}! Du har <strong>{days_left} dager</strong> igjen av den gratis Premium-prøveperioden hos <strong>{EMAIL_FROM_NAME}</strong>."
        urgency = "Velg en pakke før perioden utløper, så fortsetter alt sømløst uten tap av data."
        subject = f"{days_left} dager igjen av din {EMAIL_FROM_NAME}-prøveperiode"
    html = (
        f'<table width="100%" style="background:#f8fafc;padding:24px;font-family:Arial,sans-serif">'
        f'<tr><td align="center"><table width="560" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">'
        f'<tr><td><h1 style="color:#064E3B;margin:0 0 16px 0">{headline}</h1>'
        f'<p>{intro}</p><p>{urgency}</p>'
        f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#064E3B;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">Velg pakke nå</a></p>'
        f'<p style="color:#475569;font-size:13px">Introduksjonspris 2026: Basic 249/mnd, Pro 449/mnd, Premium 849/mnd. Ingen bindingstid.</p>'
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


async def _send_email_with_attachment(to: str, subject: str, body_text: str, filename: str, pdf_b64: str, sender_user: Optional[dict] = None):
    """Send email via Emergent-managed email service with PDF attachment.
    sender_user: Hvis gitt, legges HTML-signatur til nederst."""
    if not EMAIL_KEY:
        raise RuntimeError("E-posttjeneste ikke konfigurert")
    html = f'<pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">{body_text}</pre>'
    if sender_user:
        # Signatur bygges via samme helper (defineres lenger ned, men funksjoner er evaluert ved kall-tid)
        html += _build_user_signature_html(sender_user)
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
        reply_to = (cfg.get("reply_to") or "").strip()
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.set_content("E-posten er i HTML-format. Vennligst bruk en moderne e-postklient.")
        msg.add_alternative(html, subtype="html")
        for att in (attachments or []):
            data = _b64mod.b64decode(att.get("content") or "")
            ct = att.get("content_type") or att.get("type") or "application/octet-stream"
            maintype, _, subtype = ct.partition("/")
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
    reply_to = (cfg.get("reply_to") or "").strip()
    if reply_to:
        payload["reply_to"] = reply_to
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
                          from_name: Optional[str] = None,
                          reply_to: Optional[str] = None) -> dict:
    if not EMAIL_KEY:
        return {"ok": False, "error": "E-posttjeneste ikke konfigurert"}
    payload = {
        "to": to, "subject": subject, "html": html,
        "from_name": from_name or EMAIL_FROM_NAME,
    }
    if reply_to:
        payload["reply_to"] = reply_to
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
                             cc=None, sender_user: Optional[dict] = None) -> dict:
    """Unified email send: uses tenant's own SMTP/Resend if configured, else Emergent default.

    attachments format: [{"filename": str, "content": base64_str, "content_type": mime}]
    sender_user: Hvis gitt, legges en HTML-signatur (navn, rolle/tittel, tlf, e-post) til nederst.
    Returns: {ok, provider_id, error, method}
    """
    if isinstance(to, str): to = [to]
    if isinstance(cc, str): cc = [cc]
    if sender_user:
        html = html + _build_user_signature_html(sender_user)
    cfg = await _get_tenant_email_cfg(tid) if tid else {}
    method = (cfg.get("method") or "default").lower()
    from_name = cfg.get("from_name") or EMAIL_FROM_NAME
    reply_to = (cfg.get("reply_to") or "").strip() or None
    if method == "smtp" and cfg.get("smtp_host") and cfg.get("from_email"):
        res = await asyncio.to_thread(_send_smtp_sync, cfg, to, subject, html, attachments, cc)
        res["method"] = "smtp"; return res
    if method == "resend" and cfg.get("resend_api_key_enc") and cfg.get("from_email"):
        res = await _send_resend(cfg, to, subject, html, attachments, cc)
        res["method"] = "resend"; return res
    res = await _send_emergent(to, subject, html, attachments, cc, from_name=from_name, reply_to=reply_to)
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
    postal_code: str = ""
    city: str = ""
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
    role_title: Optional[str] = ""  # Admin-styrt fritekst (f.eks. "Daglig leder", "Lagleder G12")
    permissions: Optional[Dict[str, str]] = None
    reset_permissions: Optional[List[str]] = None  # ["inventory","suppliers","teams","people","users"]
    can_view_login_history: Optional[bool] = False
    password: Optional[str] = None


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    role: Optional[str] = None
    role_title: Optional[str] = None  # Kun admin kan endre
    permissions: Optional[Dict[str, str]] = None
    reset_permissions: Optional[List[str]] = None
    can_view_login_history: Optional[bool] = None
    active: Optional[bool] = None
    password: Optional[str] = None


class ResetSectionIn(BaseModel):
    password: str
    confirm: bool = False
    section: str  # "inventory" | "suppliers" | "teams" | "people" | "users" | "all"


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


class TeamMembership(BaseModel):
    team_id: str
    role: str = ""  # Rollen personen har på nettopp dette laget


class PersonIn(BaseModel):
    name: str = ""  # Vil bli auto-utledet fra first_name + last_name hvis tom
    first_name: str = ""
    last_name: str = ""
    role: str = ""  # Primærrolle (brukes som fallback når person ikke er knyttet til et spesifikt lag)
    phone: str = ""
    email: str = ""
    street_address: str = ""  # Gateadresse og gatenummer
    postal_code: str = ""     # 4 siffer
    postal_city: str = ""     # Automatisk utledet via geonorge.no
    notes: str = ""           # Fritekst – kun synlig i personens detaljvisning
    team_ids: List[str] = Field(default_factory=list)
    team_memberships: List[TeamMembership] = Field(default_factory=list)  # Per-lag rolle; sannhetskilde når satt


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
    main_item_number: str = ""  # Hovedvarenummer – fritekst (f.eks. "HJEM100"). Variantens komplette varenummer bygges automatisk.
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
    reply_to: Optional[str] = None  # Svar-til adresse (valgfri, tom streng = fjern)
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
    due_date: Optional[str] = None  # ISO-dato; overstyrer due_in_days hvis satt
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


class StockManualAdjustIn(BaseModel):
    item_id: str
    size: Optional[str] = None
    new_quantity: int
    reason: str


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
    postal_code: Optional[str] = None
    city: Optional[str] = None
    plan: Optional[str] = None
    extra_user_seats: Optional[int] = None
    custom_price: Optional[float] = None
    status: Optional[str] = None  # "active" | "inactive"
    cancel_stripe: Optional[bool] = False


class OwnerCreateCustomerIn(BaseModel):
    club_name: str
    owner_name: str
    owner_email: EmailStr
    owner_phone: str = ""
    postal_code: str = ""
    city: str = ""
    plan: str = "free"  # "free" | "basic" | "pro" | "deluxe"
    password: Optional[str] = None  # None → generer sterkt passord automatisk
    billing_mode: str = "manual"  # "manual" (fakturere utenfor) | "stripe" (opprett Stripe-kunde)


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






    # Merk: `role_title` kan IKKE endres av bruker selv – kun av admin via PUT /users/{id}




# ---------------- Cron: Trial reminder emails ----------------




# ---------------- Notification settings (per tenant) ----------------
DEFAULT_REMINDER_BEFORE = [14, 7]
DEFAULT_REMINDER_AFTER = [1]




async def _get_notification_settings(tid: str) -> dict:
    cfg = await db.notification_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    return {
        "enabled": bool(cfg.get("enabled", True)),
        "reminder_before_days": cfg.get("reminder_before_days") or DEFAULT_REMINDER_BEFORE,
        "reminder_after_days": cfg.get("reminder_after_days") or DEFAULT_REMINDER_AFTER,
    }






# ---------------- Cron: Due-date reminders for team loans ----------------




# ---------------- Trial admin (platform owner) ----------------


# ---------------- Trial: select plan during trial (deferred activation) ----------------




# ---------------- Signup ----------------


# ---------------- Subscription ----------------
















# ---------------- Platform Owner: Impersonation ----------------




























# ---------------- Platform Owner: Field-Level Override (impersonering kreves) ----------------
# Allow-list of collections platform-eier kan overstyre felter i. Innenfor hver samling kan
# alle felter overstyres UNNTATT de i FORBIDDEN_FIELDS (sikkerhet) OG tenant_id-feltet
# (ville kunne lekke dokumentet til feil klubb).














# ---------------- Invitations / Set password ----------------




# ---------------- Users (per tenant) ----------------










async def _log_activity(tid: str, user: dict, action: str, description: str, meta: Optional[dict] = None):
    """Lagre en aktivitetsoppføring i activity_log. Platform-eier logges normalt ikke her
    (de har ingen klubbkontekst), MEN sikkerhetssensitive handlinger (owner_field_override,
    hard_delete_customer m.m.) logges inline direkte i de respektive endepunktene med
    is_owner_action=True slik at de dukker opp i audit-visningen."""
    if not tid or (user and user.get("role") == "platform_owner"):
        return
    try:
        await db.activity_log.insert_one({
            "id": new_id(), "tenant_id": tid, "at": now_iso(),
            "action": action, "description": description,
            "by": (user or {}).get("email"), "by_user_id": (user or {}).get("id"),
            "by_name": (user or {}).get("name"),
            "meta": meta or {},
        })
    except Exception as e:
        logger.warning(f"activity_log skrivefeil: {e}")








# ===================== Database reset (per seksjon) =====================











# ---------------- Clubs ----------------










# ---------------- Teams ----------------












# ---------------- People ----------------











# -------- Varenummer-hjelpefunksjoner (brukt av items.py + QR labels her) --------
def _normalize_size_for_number(s: Optional[str]) -> str:
    if not s:
        return ""
    s = str(s).strip()
    if not s:
        return ""
    if not any(c.isdigit() for c in s):
        return s.upper()
    return s


def _normalize_jersey_for_number(j: Optional[str]) -> str:
    if j is None:
        return ""
    j = str(j).strip()
    if j == "" or j.upper() == "X":
        return ""
    if j.isdigit() and len(j) == 1:
        return "0" + j
    return j


def _compute_full_number(main: Optional[str], size: Optional[str] = None, jersey: Optional[str] = None) -> str:
    main = (str(main or "").strip())
    if not main:
        return ""
    parts = [main]
    sz = _normalize_size_for_number(size)
    if sz:
        parts.append(sz)
    jn = _normalize_jersey_for_number(jersey)
    if jn:
        parts.append(jn)
    return "-".join(parts)


def _prep_item_doc(doc: dict) -> dict:
    main = str(doc.get("main_item_number") or "").strip()
    if not main:
        main = str(doc.get("item_number") or "").strip()
    doc["main_item_number"] = main
    if doc.get("is_clothing") or doc.get("is_ball"):
        for s in doc["sizes"]:
            if doc.get("is_clothing") and not s.get("jersey_number"):
                s["jersey_number"] = "X"
            if doc.get("is_ball"):
                s["jersey_number"] = ""
            s["full_number"] = _compute_full_number(main, s.get("size"), s.get("jersey_number"))
        doc["total_stock"] = sum(s.get("quantity", 0) for s in doc["sizes"])
        doc["full_number"] = main
    else:
        doc["full_number"] = main
    return doc


# -------- QR logo + Excel helper (brukt av flere seksjoner) --------
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


def _xlsx_response(wb: Workbook, filename: str):
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# Items flyttet til routers/items.py
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

# Loans + Invoices + Notifications flyttet til routers/loans.py
# ---------------- QR Labels ----------------
# ---------------- Hjelpesenter / brukermanual (PDF) ----------------
HELP_MANUAL_SECTIONS = [
    ("Kom i gang", [
        "Velkommen til UTSTYRSROMMET – klubbens komplette system for utstyr, lager og lagstyring.",
        "Første gang du logger inn blir du bedt om å fullføre klubbinformasjonen under «Klubbinnstillinger → Klubb (logo/info)». Last opp klubblogo, kontaktinformasjon og signaturdetaljer slik at e-poster og PDF-er får riktig avsender.",
        "Legg deretter til lag under «Klubbinnstillinger → Lag», opprett varer under «Utstyr», og registrer støtteapparat (trenere, lagledere, foreldrekontakter) direkte på hvert lag.",
        "Sidepanelet grupperer funksjoner i tre bolker: driftsmoduler (Dashboard, Utstyr, Utlån osv.), Klubbinnstillinger (Lag, Personer, Klubb-info) og admin (Brukere, Abonnement).",
    ]),
    ("Utstyr og lagerstyring", [
        "Alle varer forvaltes under «Utstyr». Hver vare har et hovedvarenummer (f.eks. HJEM100) og auto-genererte varianter som får varenummer sammensatt av hovednummer + størrelse + eventuelt draktnummer (f.eks. HJEM100-M-10).",
        "Taksonomien er tre-delt: Kategori → Hovedgruppe → Undergruppe. Treffer du «Vis alle varer» får du et foldet hierarkisk tre; klikk på en kategoriknapp for å få en flat produktliste for den kategorien.",
        "For klær og baller legges hver størrelse som egen varelinje med egen lokasjon og eget lager. Draktnummer kan knyttes per linje for sporing på enkeltspiller.",
        "Lav-lager-advarsel vises automatisk når antall faller til 3 eller lavere.",
    ]),
    ("Lån ut og returner", [
        "Trykk «Nytt utlån» (fra lag-detalj eller fra «Utlån & Retur») for å registrere utlevering. Velg lag, person (fra lagets støtteapparat eller egne personer), vare og størrelse.",
        "Størrelsesvelgeren er søkbar: skriv f.eks. «M 10» for å finne M-størrelse med draktnummer 10. Lokasjon vises også i hver rad.",
        "Modus kan være «Lån» (med skyldig beløp hvis ikke returnert) eller «Utlevering» (forbruksvare uten returkrav).",
        "Ved retur: Åpne utlånet og trykk «Returner». Angi antall returnert, eventuell skade og om det skal faktureres eller avskrives.",
        "Lag-utstyrs-PDF kan sendes til lagleder/hovedtrener med ett klikk fra lag-detaljer – inkluderer varenummer, størrelse, pris og frist.",
    ]),
    ("Lag", [
        "Opprett lag under «Klubbinnstillinger → Lag». Bruk «Nytt lag»-knappen og velg lagsnavn + aldersklasse fra forhåndsdefinerte alternativer.",
        "Legg til støtteapparat med knappen «+ Legg til støtteapparat». Velg rolle (Hovedtrener, Lagleder, Trener, Dugnadsansvarlig, Foreldrekontakt, Kasserer, Annet), fyll ut navn, kontaktinformasjon og eventuelle notater.",
        "Postnummer gir automatisk oppslag av stedsnavn via Kartverket.",
        "En person kan tilhøre flere lag med ulik rolle i hvert lag. I personinformasjons-dialogen kan du trykke «+ Legg til i annet lag» for å knytte samme kontaktinformasjon til et nytt lag med egen rolle.",
        "På lag-detaljvisning vises hver person med rolle (øverst i mindre font), navn og telefon på neste linje, og fire kompakte knapper: Vis info, Rediger, Send e-post og Slett (eller Fjern fra lag dersom personen er på flere lag).",
    ]),
    ("QR-koder", [
        "QR-koder genereres per varenummer / varelinje – aldri én QR per enhet. Dette gjelder uavhengig av beholdningen.",
        "«Generer QR» på rad-nivå aktiverer QR-kode for den varelinjen. «Generer QR for alle» aktiverer alle manglende QR-koder i hele lageret.",
        "«Vis QR» på en varelinje åpner QR-dialogen med nøyaktig én QR-kode. Her kan du velge: 1 kopi, antall = beholdning, eller antall = beholdning + 2 hyllemerker. Deretter kan du skrive ut, laste ned PDF med flere kopier, eller laste ned enkelt PNG.",
        "Utskriftsstørrelsen kan være Liten (2 cm), Medium (6 cm) eller Stor (10 cm). Varenummer står i fete typer under hver QR, med varenavn/størrelse som sekundærlinje.",
        "Slett QR-kode per linje med «Slett QR»-knappen, eller nullstill alle QR-koder i klubben med «Slett alle QR» (admin). Alle sletteoperasjoner bekreftes med popup.",
    ]),
    ("Varemottak", [
        "Når bestilte varer kommer inn registreres de under «Varemottak». Skann QR-koden fra pakkseddelen (hvis tilgjengelig) eller velg vare + størrelse manuelt.",
        "Oppgi antall mottatt, eventuell bestillingsreferanse (PO-nummer) og kommentar. Lageret oppdateres umiddelbart.",
        "«Åpne bestillinger»-tabellen viser hva som er bestilt men ikke mottatt ennå, med varenummer som første kolonne.",
        "«Siste varemottak» viser en logg over alle registrerte mottak. Du kan filtrere på dato og laste ned en Varemottak-PDF (med varenummer som første kolonne) direkte fra UI-et.",
    ]),
    ("Excel import/eksport", [
        "Last ned mal under «Utstyr → Last ned mal». Malen har varenummer som første kolonne, og egne rader per varelinje (størrelse + draktnummer).",
        "Fyll ut malen i Excel / LibreOffice, og last opp igjen under «Importer Excel». Du får en forhåndsvisning som viser hva som vil bli opprettet, oppdatert eller hoppet over – ingen endringer før du bekrefter.",
        "«Eksporter Excel» laster ned hele dagens lager som en ferdig fil – nyttig for backup, revisjon eller å dele med regnskap.",
        "Både import og eksport bruker samme kolonnerekkefølge: Varenummer, Varenavn, Kategori, Hovedgruppe, Undergruppe, Type, Størrelse, Draktnr, Antall, Pris, Lokasjon, m.m.",
    ]),
    ("Abonnement", [
        "UTSTYRSROMMET tilbys i tre nivåer: Basis, Pro og Premium. Alle planer har 14 dagers gratis prøveperiode der du får Premium-funksjoner.",
        "Du finner din gjeldende plan under «Abonnement» i sidepanelet – kun admin og klubb-eier ser denne.",
        "Oppgradering og nedgradering gjøres via Stripe. Faktura, betalingsinformasjon og historikk administreres i Stripe-kundeportalen – klikk «Administrer abonnement» for å åpne denne.",
        "QR-koder og Varetelling er inkludert kun i Premium-planen. Alle andre moduler (Lag, Utstyr, Utlån, Varemottak, Behov, Bestillinger, Leverandører) er tilgjengelige på alle planer.",
        "Spørsmål om fakturering eller plan? Kontakt support via «Hjelpesenter → Kontakt» eller send e-post til support-adressen i klubbinformasjonen.",
    ]),
]






# ---------------- QR Labels ----------------




# ---------------- Dashboard ----------------


# ---------------- Stock Audit ----------------






















# ---------------- Exports ----------------




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
    full_numbers = await _lookup_full_numbers_for_loans(tid, loans)
    pdf_bytes = _build_team_equipment_pdf(team, loans, people, club, cust, effective_user, club_name, full_numbers)
    return pdf_bytes, team, club_name, loans






async def _lookup_full_numbers_for_loans(tid: str, loans: list) -> dict:
    """Henter varenummer for et sett utlån. Returnerer dict med (item_id, size, jersey) -> full_number,
    i tillegg til (item_id, None, None) -> hovedvarenummer for sizeless-fallback."""
    item_ids = list({l.get("item_id") for l in loans if l.get("item_id")})
    if not item_ids:
        return {}
    items = await db.items.find(
        {"id": {"$in": item_ids}, "tenant_id": tid},
        {"_id": 0, "id": 1, "main_item_number": 1, "full_number": 1,
         "sizes": 1, "is_clothing": 1, "is_ball": 1},
    ).to_list(5000)
    out: Dict[tuple, str] = {}
    for it in items:
        iid = it["id"]
        main = it.get("main_item_number") or it.get("full_number") or ""
        out[(iid, None, None)] = main
        for s in it.get("sizes") or []:
            fn = s.get("full_number") or _compute_full_number(main, s.get("size"), s.get("jersey_number"))
            out[(iid, s.get("size"), s.get("jersey_number"))] = fn
            # Fallback uten jersey (gamle utlån kan mangle jersey_number)
            out.setdefault((iid, s.get("size"), None), fn)
    return out


def _resolve_loan_full_number(loan: dict, lookup: dict) -> str:
    iid = loan.get("item_id")
    size = loan.get("size")
    jn = loan.get("jersey_number")
    if (iid, size, jn) in lookup: return lookup[(iid, size, jn)]
    if (iid, size, None) in lookup: return lookup[(iid, size, None)]
    return lookup.get((iid, None, None), "") or ""


def _build_team_equipment_pdf(team: dict, loans: list, people: dict, club: dict,
                               cust: dict, user: dict, club_name: str,
                               full_numbers: Optional[dict] = None) -> bytes:
    full_numbers = full_numbers or {}
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
    # Kolonner (fra RIGHT bakover) – Varenr først, så Vare, Str/Nr, Antall, Pris, Linjebeløp, Frist.
    col_varenr = LEFT
    col_vare = LEFT + 28 * mm
    col_str = LEFT + 78 * mm   # "Str/Nr" start (venstre-justert)
    col_ant_r = RIGHT - 68 * mm   # høyre kant av "Antall"
    col_pris_r = RIGHT - 48 * mm  # høyre kant av "Pris/stk"
    col_sum_r = RIGHT - 25 * mm   # høyre kant av "Linjebeløp"
    col_frist_r = RIGHT           # høyre kant av "Frist"
    def _header():
        c.setFont("Helvetica-Bold", 9)
        c.drawString(col_varenr, y, "Varenr")
        c.drawString(col_vare, y, "Vare")
        c.drawString(col_str, y, "Str/Nr")
        c.drawRightString(col_ant_r, y, "Antall")
        c.drawRightString(col_pris_r, y, "Pris/stk")
        c.drawRightString(col_sum_r, y, "Linjebeløp")
        c.drawRightString(col_frist_r, y, "Frist")
    _header()
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
            name_full = (l.get("item_name") or "")
            # Trunker varenavn hvis for langt
            name = name_full if len(name_full) <= 28 else (name_full[:25] + "...")
            fn = _resolve_loan_full_number(l, full_numbers)
            size_bits = []
            if l.get("size"): size_bits.append(l["size"])
            if l.get("jersey_number") and l["jersey_number"] not in ("X", ""): size_bits.append(f"#{l['jersey_number']}")
            size_str = " ".join(size_bits) or "-"
            qty = int(l.get("quantity") or 0)
            unit = float(l.get("unit_price") or 0)
            amt = float(l.get("amount_owed") or 0)
            due = _fmt_date(l.get("due_date"))
            c.drawString(col_varenr, y, (fn or "-")[:14])
            c.drawString(col_vare, y, name)
            c.drawString(col_str, y, size_str[:10])
            c.drawRightString(col_ant_r, y, str(qty))
            c.drawRightString(col_pris_r, y, nok(unit))
            c.drawRightString(col_sum_r, y, nok(amt))
            c.drawRightString(col_frist_r, y, due)
            y -= 5 * mm
            total_amt += amt; total_qty += qty; lines_count += 1
        y -= 1 * mm
        c.line(LEFT, y, RIGHT, y); y -= 5 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawString(LEFT, y, f"Sum ({lines_count} linjer, {total_qty} varer)")
        c.drawRightString(col_sum_r, y, nok(total_amt))
        y -= 10 * mm

    # --- Visuell separator mellom seksjoner ---
    c.setStrokeColorRGB(0.75, 0.75, 0.75)
    c.setDash(2, 2)
    c.line(LEFT, y, RIGHT, y)
    c.setDash()
    c.setStrokeColorRGB(0, 0, 0)
    y -= 8 * mm

    # --- Section 2: Utleverte forbruksvarer (handout uten skyld) ---
    _ensure_space(30 * mm)
    handouts = [l for l in loans if (l.get("mode") == "handout" and float(l.get("amount_owed") or 0) == 0)]
    handouts.sort(key=lambda l: l.get("loan_date") or "")

    c.setFont("Helvetica-Bold", 12)
    c.drawString(LEFT, y, "Utleverte forbruksvarer (uten skyldig beløp)")
    y -= 6 * mm
    # Kolonner: Dato | Varenr | Vare | Str/Nr | Antall | Utlevert til
    col2_dato = LEFT
    col2_varenr = LEFT + 22 * mm
    col2_vare = LEFT + 48 * mm
    col2_str_r = RIGHT - 68 * mm   # høyre kant av Str/Nr
    col2_ant_r = RIGHT - 48 * mm   # høyre kant av Antall
    col2_hent = RIGHT - 42 * mm    # venstre kant av "Utlevert til" (brer seg til RIGHT)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(col2_dato, y, "Dato")
    c.drawString(col2_varenr, y, "Varenr")
    c.drawString(col2_vare, y, "Vare")
    c.drawRightString(col2_str_r, y, "Str/Nr")
    c.drawRightString(col2_ant_r, y, "Antall")
    c.drawString(col2_hent, y, "Utlevert til")
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
            name_full = (l.get("item_name") or "")
            name = name_full if len(name_full) <= 22 else (name_full[:19] + "...")
            fn = _resolve_loan_full_number(l, full_numbers)
            size_bits = []
            if l.get("size"): size_bits.append(l["size"])
            if l.get("jersey_number") and l["jersey_number"] not in ("X", ""): size_bits.append(f"#{l['jersey_number']}")
            size_str = " ".join(size_bits) or "-"
            qty = int(l.get("quantity") or 0)
            dato = _fmt_date(l.get("loan_date"))
            pid = l.get("picked_up_by") or l.get("person_id")
            picked = (people.get(pid) or {}).get("name") or "-"
            c.drawString(col2_dato, y, dato)
            c.drawString(col2_varenr, y, (fn or "-")[:12])
            c.drawString(col2_vare, y, name)
            c.drawRightString(col2_str_r, y, size_str[:10])
            c.drawRightString(col2_ant_r, y, str(qty))
            c.drawString(col2_hent, y, picked[:22])
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




















# ============== LEVERANDØRER ==============




















# ============== UNIQUE PO NUMBER ==============


# ============== BEHOVSSKJEMA ==============




















# ============== PURCHASE ORDERS (LEVERANDØRBESTILLINGER) ==============
class OrderLineIn(BaseModel):
    item_id: Optional[str] = None
    item_name: str
    size: Optional[str] = None
    jersey_number: Optional[str] = None
    quantity: int
    unit_price: float = 0.0










class OrderReceiveLine(BaseModel):
    line_id: str
    quantity: int
    comment: str = ""
    confirm_over: bool = False












# ============== ORDER PDF ==============




# ============== UDEKKET BEHOV + RESERVATIONS ==============






# ============== NOTIFY LAGLEDER (SMS + email) ==============






# =============== TENANT EMAIL SETTINGS (per-klubb avsender) ===============
def _redact_email_cfg(cfg: dict) -> dict:
    """Return safe-to-ship representation (never password/API-key)."""
    if not cfg: cfg = {}
    return {
        "method": cfg.get("method") or "default",
        "from_name": cfg.get("from_name") or "",
        "from_email": cfg.get("from_email") or "",
        "reply_to": cfg.get("reply_to") or "",
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










# =========== Send purchase order PDF to supplier/anyone ===========






# Import router modules (de monterer sine endepunkter på `api`-router).
# Må være etter at `api` er definert, før `app.include_router(api)`.
from routers import taxonomy_admin  # noqa: F401 (import for side effect: registers routes)

app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"], expose_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============== STARTUP MIGRATIONS ==============
@app.on_event("startup")
async def migrate_full_numbers_on_startup():
    """Idempotent migrering: backfill main_item_number + full_number på alle items.
    Kjøres ved hver backend-oppstart. Trygg å kjøre flere ganger – oppdaterer kun manglende felter."""
    try:
        updated = 0
        async for it in db.items.find({"$or": [
            {"main_item_number": {"$in": [None, ""]}},
            {"main_item_number": {"$exists": False}},
            {"full_number": {"$exists": False}},
        ]}):
            doc = dict(it)
            if not doc.get("main_item_number"):
                # Legacy: bruk item_number eller lag ny fra navn
                legacy = str(doc.get("item_number") or "").strip()
                if not legacy:
                    # Fallback: slugify navnet (f.eks. "Hjemmedrakt" → "HJEMMEDRAKT")
                    import re as _re
                    legacy = _re.sub(r"[^A-Za-z0-9]+", "", (doc.get("name") or "")).upper()[:12] or "VARE"
                doc["main_item_number"] = legacy
            prepped = _prep_item_doc(doc)
            await db.items.update_one(
                {"_id": it["_id"]},
                {"$set": {
                    "main_item_number": prepped.get("main_item_number"),
                    "full_number": prepped.get("full_number"),
                    "sizes": prepped.get("sizes", []),
                }}
            )
            updated += 1
        if updated:
            logger.info(f"Backfilled main_item_number + full_number på {updated} varer")
    except Exception as e:
        logger.exception(f"Full-number migrering feilet: {e}")

# =====================================================================
# LAGSPORTAL (TEAM PORTAL) - utstyrsrommet.no/portal
# =====================================================================
# Koden er flyttet til routers/portal.py. Importeres for side effects.
from routers import portal  # noqa: F401 (import for side effect: registers routes)
from routers import loans  # noqa: F401 (import for side effect: registers routes)
from routers import items  # noqa: F401 (import for side effect: registers routes)
from routers import teams  # noqa: F401 (import for side effect: registers routes)
from routers import stock_audit  # noqa: F401 (import for side effect: registers routes)
from routers import orders  # noqa: F401 (import for side effect: registers routes)
from routers import admin  # noqa: F401 (import for side effect: registers routes)
from routers import subscription  # noqa: F401 (import for side effect: registers routes)
from routers import owner  # noqa: F401 (import for side effect: registers routes)


# IMPORTANT: `app.include_router(api)` MUST be the last line in this file.
# FastAPI registrerer kun ruter som er dekoretert PÅ api-routeren FØR include_router kalles.
# Hvis denne flyttes opp, blir alle endepunkter definert under den (som Lagsportal) 404.
app.include_router(api)
