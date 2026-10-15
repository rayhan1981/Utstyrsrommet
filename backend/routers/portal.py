"""
Router for Lagsportalen (Team Portal) – utstyrsrommet.no/portal

Inneholder:
- Admin-opprettelse/redigering/sletting av lagspålogginger
- Portal auth (login, logout, set-password, me, branding)
- Portal dashboard-data (lån, utleveringer, forfalte, skyldig, behov)
- Portal varesøk (uten lagerdata)
- Portal behovsmeldinger (opprett, list, detalj, trekk tilbake)
- Klubbside: innmeldte behov (list, detalj, start behandling, oppdater linje, lukk, gjenåpne)
- Klubbside: team-portal status

Deluxe-gating serverside på alle portal-endepunkter.
Egen JWT-token-type (claim: typ=portal).
"""
import os
import re
import secrets as pysecrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

import jwt
from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from ._shared import (
    api, db, require_tenant, require_perm, require_feature,
    get_current_user, resolve_tenant_id, get_tenant_plan,
    _log_activity, now_iso, new_id, hash_password, verify_password,
    _compute_full_number, send_tenant_email,
    JWT_SECRET, JWT_ALGORITHM, logger,
)

# =====================================================================
# LAGSPORTAL (TEAM PORTAL) - utstyrsrommet.no/portal
# =====================================================================

PORTAL_JWT_TYP = "portal"
PORTAL_TOKEN_TTL_HOURS = 12


def _create_portal_token(account_id: str, tenant_id: str, team_id: str) -> str:
    payload = {
        "sub": account_id,
        "typ": PORTAL_JWT_TYP,
        "tid": tenant_id,
        "team": team_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=PORTAL_TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def _tenant_has_team_portal(tenant_id: str) -> bool:
    """Serverside Deluxe-gate for lagsportalen. True hvis klubbens plan (inkl. aktiv prøveperiode) har team_portal."""
    if not tenant_id:
        return False
    try:
        plan = await get_tenant_plan(tenant_id)
        return bool(plan.get("team_portal"))
    except Exception:
        return False


async def _require_tenant_deluxe_portal(tenant_id: str):
    """Kaster 402 hvis klubbens aktive plan ikke inkluderer lagsportalen."""
    if not await _tenant_has_team_portal(tenant_id):
        raise HTTPException(status_code=402, detail="Lagsportalen krever et aktivt Premium-abonnement.")


async def get_portal_account(request: Request) -> dict:
    """Dependency – autentiser lagsportal-konto via egen JWT. Verifiserer Deluxe hver forespørsel."""
    token = request.cookies.get("portal_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Ikke innlogget til lagsportalen")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Lagsportal-token utløpt")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ugyldig lagsportal-token")
    if payload.get("typ") != PORTAL_JWT_TYP:
        raise HTTPException(status_code=401, detail="Ikke en lagsportal-sesjon")
    acc = await db.team_portal_accounts.find_one(
        {"id": payload["sub"], "tenant_id": payload["tid"], "team_id": payload["team"]},
        {"_id": 0, "password_hash": 0, "reset_token": 0, "reset_token_expires": 0},
    )
    if not acc:
        raise HTTPException(status_code=401, detail="Konto ikke funnet")
    if not acc.get("active"):
        raise HTTPException(status_code=403, detail="Kontoen er deaktivert av klubben")
    # Håndhev Deluxe hver gang: hvis klubbens plan er nedgradert, blokker umiddelbart.
    if not await _tenant_has_team_portal(acc["tenant_id"]):
        raise HTTPException(status_code=402, detail="Klubbens portaltilgang er ikke aktiv. Kontakt klubbens administrator.")
    # Verifiser kundens overordnede status
    cust = await db.customers.find_one({"id": acc["tenant_id"]}, {"status": 1, "deleted_at": 1})
    if not cust or cust.get("deleted_at") or cust.get("status") == "inactive":
        raise HTTPException(status_code=403, detail="Klubbens konto er ikke aktiv")
    # Verifiser laget eksisterer
    team = await db.teams.find_one({"id": acc["team_id"], "tenant_id": acc["tenant_id"]}, {"_id": 0, "id": 1, "team_name": 1, "age_class": 1})
    if not team:
        raise HTTPException(status_code=403, detail="Laget er fjernet")
    acc["_team"] = team
    return acc


# -------------- Admin-opprettelse av lagspålogginger --------------
class TeamPortalAccountIn(BaseModel):
    team_id: str
    email: EmailStr
    display_name: Optional[str] = ""
    phone: Optional[str] = ""


class TeamPortalAccountUpdateIn(BaseModel):
    active: Optional[bool] = None
    display_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    team_id: Optional[str] = None


class TeamPortalAdminSetPasswordIn(BaseModel):
    password: str


def _redact_portal_account(acc: dict) -> dict:
    return {
        "id": acc["id"],
        "tenant_id": acc["tenant_id"],
        "team_id": acc["team_id"],
        "email": acc["email"],
        "display_name": acc.get("display_name") or "",
        "phone": acc.get("phone") or "",
        "active": bool(acc.get("active", True)),
        "created_at": acc.get("created_at"),
        "last_login_at": acc.get("last_login_at"),
        "has_set_password": bool(acc.get("password_hash")),
        "pending_invite": bool(acc.get("reset_token") and not acc.get("password_hash")),
    }


@api.get("/team-portal/accounts")
async def list_team_portal_accounts(request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    await _require_tenant_deluxe_portal(tid)
    accs = await db.team_portal_accounts.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_redact_portal_account(a) for a in accs]


@api.post("/team-portal/accounts")
async def create_team_portal_account(data: TeamPortalAccountIn, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    await _require_tenant_deluxe_portal(tid)
    team = await db.teams.find_one({"id": data.team_id, "tenant_id": tid}, {"_id": 0, "id": 1, "team_name": 1})
    if not team:
        raise HTTPException(404, "Laget finnes ikke i din klubb")
    email = data.email.strip().lower()
    existing = await db.team_portal_accounts.find_one({"tenant_id": tid, "email": email})
    if existing:
        raise HTTPException(400, "En lagspålogging med denne e-postadressen finnes allerede i klubben")
    reset_token = pysecrets.token_urlsafe(32)
    doc = {
        "id": new_id(),
        "tenant_id": tid,
        "team_id": data.team_id,
        "team_name": team.get("team_name"),
        "email": email,
        "display_name": (data.display_name or "").strip(),
        "phone": (data.phone or "").strip(),
        "password_hash": None,
        "active": True,
        "reset_token": reset_token,
        "reset_token_expires": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": now_iso(),
        "created_by": user.get("id"),
        "last_login_at": None,
    }
    await db.team_portal_accounts.insert_one(doc)
    await _log_activity(tid, user, "team_portal_account_created",
                         f"Opprettet lagspålogging for {team.get('team_name')} ({email})",
                         {"account_id": doc["id"], "team_id": data.team_id})
    portal_url = os.environ.get("APP_URL", "https://utstyrsrommet.no").rstrip("/") + "/portal"
    invite_link = f"{portal_url}/sett-passord?token={reset_token}"
    club = await db.customers.find_one({"id": tid}, {"_id": 0, "club_name": 1}) or {}
    club_name = club.get("club_name") or "klubben"
    html = (
        f"<p>Hei {doc['display_name'] or email},</p>"
        f"<p>Du er invitert til lagsportalen for <strong>{club_name}</strong> som kontakt for laget <strong>{team.get('team_name')}</strong>.</p>"
        f"<p>Klikk under for å sette et passord og logge inn (lenken er gyldig i 7 dager):</p>"
        f"<p><a href=\"{invite_link}\">{invite_link}</a></p>"
        f"<p>Mvh<br/>{club_name}</p>"
    )
    try:
        await send_tenant_email(tid, email, f"Velkommen til lagsportalen – {club_name}", html, sender_user=user)
    except Exception:
        logger.exception("Kunne ikke sende lagsportal-invitasjon")
    return _redact_portal_account(doc) | {"invite_link": invite_link}


@api.put("/team-portal/accounts/{aid}")
async def update_team_portal_account(aid: str, data: TeamPortalAccountUpdateIn, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    await _require_tenant_deluxe_portal(tid)
    acc = await db.team_portal_accounts.find_one({"id": aid, "tenant_id": tid}, {"_id": 0})
    if not acc:
        raise HTTPException(404, "Kontoen finnes ikke")
    patch: Dict[str, Any] = {}
    if data.active is not None: patch["active"] = bool(data.active)
    if data.display_name is not None: patch["display_name"] = data.display_name.strip()
    if data.phone is not None: patch["phone"] = data.phone.strip()
    if data.email is not None:
        new_email = data.email.strip().lower()
        if new_email != acc["email"]:
            dupe = await db.team_portal_accounts.find_one(
                {"tenant_id": tid, "email": new_email, "id": {"$ne": aid}}
            )
            if dupe:
                raise HTTPException(400, "En annen lagspålogging bruker allerede denne e-postadressen i klubben")
            patch["email"] = new_email
    if data.team_id is not None and data.team_id != acc["team_id"]:
        team = await db.teams.find_one({"id": data.team_id, "tenant_id": tid}, {"_id": 0, "id": 1, "team_name": 1})
        if not team:
            raise HTTPException(404, "Laget finnes ikke i din klubb")
        patch["team_id"] = data.team_id
        patch["team_name"] = team.get("team_name")
    if patch:
        await db.team_portal_accounts.update_one({"id": aid, "tenant_id": tid}, {"$set": patch})
    updated = await db.team_portal_accounts.find_one({"id": aid, "tenant_id": tid}, {"_id": 0})
    await _log_activity(tid, user, "team_portal_account_updated",
                         f"Oppdaterte lagspålogging {updated.get('email')}", {"account_id": aid, "patch": patch})
    return _redact_portal_account(updated)


@api.delete("/team-portal/accounts/{aid}")
async def delete_team_portal_account(aid: str, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    await _require_tenant_deluxe_portal(tid)
    acc = await db.team_portal_accounts.find_one({"id": aid, "tenant_id": tid}, {"_id": 0})
    if not acc:
        raise HTTPException(404, "Kontoen finnes ikke")
    await db.team_portal_accounts.delete_one({"id": aid, "tenant_id": tid})
    await _log_activity(tid, user, "team_portal_account_deleted",
                         f"Slettet lagspålogging {acc.get('email')}",
                         {"account_id": aid, "team_id": acc.get("team_id"), "email": acc.get("email")})
    return {"ok": True}


@api.post("/team-portal/accounts/{aid}/set-password")
async def admin_set_portal_password(aid: str, data: TeamPortalAdminSetPasswordIn, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    await _require_tenant_deluxe_portal(tid)
    acc = await db.team_portal_accounts.find_one({"id": aid, "tenant_id": tid}, {"_id": 0})
    if not acc:
        raise HTTPException(404, "Kontoen finnes ikke")
    if len(data.password) < 8:
        raise HTTPException(400, "Passord må være minst 8 tegn")
    await db.team_portal_accounts.update_one(
        {"id": aid, "tenant_id": tid},
        {"$set": {"password_hash": hash_password(data.password), "reset_token": None, "reset_token_expires": None}},
    )
    await _log_activity(tid, user, "team_portal_account_password_set",
                         f"Satte nytt passord manuelt for {acc.get('email')}",
                         {"account_id": aid})
    return {"ok": True}


@api.post("/team-portal/accounts/{aid}/resend-invite")
async def resend_portal_invite(aid: str, request: Request, user=Depends(require_perm("teams", "admin"))):
    tid = await require_tenant(request, user)
    await _require_tenant_deluxe_portal(tid)
    acc = await db.team_portal_accounts.find_one({"id": aid, "tenant_id": tid}, {"_id": 0})
    if not acc:
        raise HTTPException(404, "Kontoen finnes ikke")
    reset_token = pysecrets.token_urlsafe(32)
    await db.team_portal_accounts.update_one(
        {"id": aid, "tenant_id": tid},
        {"$set": {"reset_token": reset_token, "reset_token_expires": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(), "password_hash": None}},
    )
    portal_url = os.environ.get("APP_URL", "https://utstyrsrommet.no").rstrip("/") + "/portal"
    invite_link = f"{portal_url}/sett-passord?token={reset_token}"
    club = await db.customers.find_one({"id": tid}, {"_id": 0, "club_name": 1}) or {}
    club_name = club.get("club_name") or "klubben"
    html = (
        f"<p>Hei {acc.get('display_name') or acc.get('email')},</p>"
        f"<p>Her er en ny invitasjon til lagsportalen for <strong>{club_name}</strong>.</p>"
        f"<p>Klikk under for å sette et passord og logge inn (gyldig i 7 dager):</p>"
        f"<p><a href=\"{invite_link}\">{invite_link}</a></p>"
    )
    try:
        await send_tenant_email(tid, acc["email"], f"Lagsportal – ny invitasjon ({club_name})", html, sender_user=user)
    except Exception:
        logger.exception("Kunne ikke sende ny invitasjon")
    return {"ok": True, "invite_link": invite_link}


# -------------- Portal auth --------------
class PortalLoginIn(BaseModel):
    email: EmailStr
    password: str


class PortalSetPasswordIn(BaseModel):
    token: str
    password: str


@api.post("/portal/auth/set-password")
async def portal_set_password(data: PortalSetPasswordIn, response: Response):
    if len(data.password) < 8:
        raise HTTPException(400, "Passord må være minst 8 tegn")
    acc = await db.team_portal_accounts.find_one({"reset_token": data.token}, {"_id": 0})
    if not acc:
        raise HTTPException(400, "Ugyldig eller brukt invitasjon")
    exp = acc.get("reset_token_expires")
    if not exp or datetime.fromisoformat(exp) < datetime.now(timezone.utc):
        raise HTTPException(400, "Invitasjonen er utløpt. Be klubben om en ny.")
    if not acc.get("active"):
        raise HTTPException(403, "Kontoen er deaktivert")
    await _require_tenant_deluxe_portal(acc["tenant_id"])
    await db.team_portal_accounts.update_one(
        {"id": acc["id"]},
        {"$set": {"password_hash": hash_password(data.password), "reset_token": None, "reset_token_expires": None}},
    )
    token = _create_portal_token(acc["id"], acc["tenant_id"], acc["team_id"])
    response.set_cookie("portal_token", token, httponly=True, samesite="lax", secure=True,
                        max_age=PORTAL_TOKEN_TTL_HOURS * 3600, path="/")
    return {"ok": True, "token": token}


@api.post("/portal/auth/login")
async def portal_login(data: PortalLoginIn, response: Response):
    email = data.email.strip().lower()
    acc = await db.team_portal_accounts.find_one({"email": email}, {"_id": 0})
    if not acc or not acc.get("password_hash") or not verify_password(data.password, acc["password_hash"]):
        raise HTTPException(401, "Feil e-post eller passord")
    if not acc.get("active"):
        raise HTTPException(403, "Kontoen er deaktivert av klubben. Kontakt klubbens administrator.")
    await _require_tenant_deluxe_portal(acc["tenant_id"])
    await db.team_portal_accounts.update_one({"id": acc["id"]}, {"$set": {"last_login_at": now_iso()}})
    token = _create_portal_token(acc["id"], acc["tenant_id"], acc["team_id"])
    response.set_cookie("portal_token", token, httponly=True, samesite="lax", secure=True,
                        max_age=PORTAL_TOKEN_TTL_HOURS * 3600, path="/")
    return {"ok": True, "token": token}


@api.post("/portal/auth/logout")
async def portal_logout(response: Response):
    response.delete_cookie("portal_token", path="/")
    return {"ok": True}


async def _portal_club_branding(tenant_id: str) -> dict:
    cust = await db.customers.find_one({"id": tenant_id}, {"_id": 0, "club_name": 1}) or {}
    club_doc = await db.clubs.find_one({"tenant_id": tenant_id}, {"_id": 0, "name": 1, "logo_url": 1}) or {}
    return {
        "name": club_doc.get("name") or cust.get("club_name") or "Klubben",
        "logo_url": club_doc.get("logo_url") or "",
    }


@api.get("/portal/auth/me")
async def portal_me(acc=Depends(get_portal_account)):
    team = acc["_team"]
    return {
        "account": _redact_portal_account(acc),
        "team": {"id": team["id"], "name": team.get("team_name"), "age_class": team.get("age_class")},
        "club": await _portal_club_branding(acc["tenant_id"]),
    }


@api.get("/portal/branding")
async def portal_branding_by_token(token: str):
    acc = await db.team_portal_accounts.find_one({"reset_token": token}, {"_id": 0, "tenant_id": 1}) or {}
    if not acc:
        raise HTTPException(404, "Ugyldig invitasjon")
    return await _portal_club_branding(acc["tenant_id"])


# -------------- Portal: dashboard-data --------------
@api.get("/portal/dashboard")
async def portal_dashboard(acc=Depends(get_portal_account)):
    tid = acc["tenant_id"]
    team_id = acc["team_id"]
    loans = await db.loans.find({"tenant_id": tid, "team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    now = datetime.now(timezone.utc)
    today_iso = now.date().isoformat()
    debt = 0.0
    overdue_lines = []
    active_loans = []
    handouts = []
    for l in loans:
        mode = (l.get("mode") or "loan").lower()
        qty = int(l.get("quantity") or 0)
        returned = int(l.get("returned_quantity") or 0)
        outstanding = max(0, qty - returned)
        if mode == "loan":
            if outstanding > 0:
                active_loans.append(l)
                debt += float(l.get("amount_owed") or 0)
                due = l.get("due_date") or ""
                if due and due[:10] < today_iso:
                    overdue_lines.append({"loan_id": l["id"], "item_name": l.get("item_name"), "size": l.get("size"),
                                           "quantity": outstanding, "due_date": due})
        else:
            handouts.append(l)
    needs = await db.needs_requests.find({"tenant_id": tid, "team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {
        "team": {"id": team_id, "name": acc["_team"].get("team_name"), "age_class": acc["_team"].get("age_class")},
        "active_loans": [
            {"id": l["id"], "item_name": l.get("item_name"), "size": l.get("size"),
             "jersey_number": l.get("jersey_number"), "full_number": l.get("full_number"),
             "quantity": int(l.get("quantity") or 0) - int(l.get("returned_quantity") or 0),
             "unit_price": l.get("unit_price"), "amount_owed": l.get("amount_owed"),
             "due_date": l.get("due_date"), "loan_date": l.get("loan_date") or l.get("created_at")}
            for l in active_loans
        ],
        "handouts": [
            {"id": l["id"], "item_name": l.get("item_name"), "size": l.get("size"),
             "full_number": l.get("full_number"),
             "quantity": int(l.get("quantity") or 0),
             "handout_date": l.get("loan_date") or l.get("created_at")}
            for l in handouts
        ],
        "overdue": overdue_lines,
        "debt": round(debt, 2),
        "needs": [_portal_needs_summary(n) for n in needs],
    }


def _portal_needs_summary(n: dict) -> dict:
    return {
        "id": n["id"],
        "number": n.get("number"),
        "status": n.get("status"),
        "status_label": _needs_status_label(n.get("status")),
        "wanted_date": n.get("wanted_date"),
        "contact_name": n.get("contact_name"),
        "created_at": n.get("created_at"),
        "last_update_at": n.get("last_update_at") or n.get("created_at"),
        "lines_count": len(n.get("lines") or []),
    }


def _needs_status_label(status: str) -> str:
    return {
        "sendt": "Sendt",
        "under_behandling": "Under behandling",
        "behandlet_ma_bestilles": "Behandlet – må bestilles",
        "behandlet_dellevering": "Behandlet – Dellevering",
        "kan_leveres_omgaende": "Kan leveres omgående",
        "avsluttet": "Avsluttet",
        "trukket_tilbake": "Trukket tilbake",
    }.get(status or "", "Ukjent")


# -------------- Portal: varesøk uten lagerdata --------------
@api.get("/portal/items")
async def portal_items(acc=Depends(get_portal_account), q: Optional[str] = None):
    tid = acc["tenant_id"]
    filt: Dict[str, Any] = {"tenant_id": tid}
    if q:
        filt["$or"] = [
            {"name": {"$regex": re.escape(q), "$options": "i"}},
            {"main_item_number": {"$regex": re.escape(q), "$options": "i"}},
            {"category": {"$regex": re.escape(q), "$options": "i"}},
            {"main_group": {"$regex": re.escape(q), "$options": "i"}},
            {"sub_group": {"$regex": re.escape(q), "$options": "i"}},
        ]
    items = await db.items.find(filt, {
        "_id": 0, "id": 1, "name": 1, "main_item_number": 1,
        "category": 1, "main_group": 1, "sub_group": 1,
        "is_clothing": 1, "is_ball": 1,
        "sizes": 1,
    }).sort([("category", 1), ("main_group", 1), ("sub_group", 1), ("name", 1)]).to_list(2000)
    for it in items:
        safe_sizes = []
        for s in (it.get("sizes") or []):
            safe_sizes.append({
                "size": s.get("size"),
                "jersey_number": s.get("jersey_number"),
                "full_number": s.get("full_number"),
            })
        it["sizes"] = safe_sizes
    return items


# -------------- Portal: behovsmeldinger --------------
class PortalNeedLineIn(BaseModel):
    item_id: str
    size: Optional[str] = ""
    jersey_number: Optional[str] = ""
    quantity_requested: int
    note: Optional[str] = ""


class PortalNeedCreateIn(BaseModel):
    contact_name: str
    contact_phone: str
    contact_email: EmailStr
    wanted_date: str
    lines: List[PortalNeedLineIn]
    comment: Optional[str] = ""


async def _next_needs_request_number(tid: str) -> str:
    yr = datetime.now(timezone.utc).strftime("%y")
    key = f"needs_{tid}_{yr}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = doc.get("seq", 1) if doc else 1
    return f"BM{seq:05d}-{yr}"


@api.get("/portal/needs")
async def portal_list_needs(acc=Depends(get_portal_account)):
    needs = await db.needs_requests.find(
        {"tenant_id": acc["tenant_id"], "team_id": acc["team_id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(300)
    return [_portal_needs_summary(n) for n in needs]


@api.get("/portal/needs/{nid}")
async def portal_get_need(nid: str, acc=Depends(get_portal_account)):
    n = await db.needs_requests.find_one(
        {"id": nid, "tenant_id": acc["tenant_id"], "team_id": acc["team_id"]},
        {"_id": 0, "internal_notes": 0, "assigned_to": 0, "assigned_to_name": 0},
    )
    if not n:
        raise HTTPException(404, "Behovsmelding finnes ikke")
    n["status_label"] = _needs_status_label(n.get("status"))
    return n


@api.post("/portal/needs")
async def portal_create_need(data: PortalNeedCreateIn, request: Request, acc=Depends(get_portal_account)):
    tid = acc["tenant_id"]; team_id = acc["team_id"]
    try:
        wanted = datetime.strptime(data.wanted_date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "Ugyldig ønsket dato. Bruk formatet ÅÅÅÅ-MM-DD.")
    try:
        import zoneinfo
        oslo = zoneinfo.ZoneInfo("Europe/Oslo")
        today_oslo = datetime.now(oslo).date()
    except Exception:
        today_oslo = datetime.now(timezone.utc).date()
    min_date = today_oslo + timedelta(days=3)
    if wanted < min_date:
        raise HTTPException(400, f"Ønsket dato må være minst {min_date.isoformat()} (tre kalenderdager etter innsending).")
    if not data.lines or len(data.lines) == 0:
        raise HTTPException(400, "Legg til minst én varelinje.")
    item_ids = list({ln.item_id for ln in data.lines if ln.item_id})
    items = await db.items.find({"tenant_id": tid, "id": {"$in": item_ids}}, {"_id": 0}).to_list(500)
    by_id = {it["id"]: it for it in items}
    lines = []
    for ln in data.lines:
        it = by_id.get(ln.item_id)
        if not it:
            raise HTTPException(400, f"Ukjent vare ({ln.item_id})")
        if not isinstance(ln.quantity_requested, int) or ln.quantity_requested <= 0:
            raise HTTPException(400, f"Antall må være et positivt heltall for {it.get('name')}")
        full_number = it.get("main_item_number") or it.get("full_number") or ""
        if ln.size:
            s_entry = next((s for s in (it.get("sizes") or []) if s.get("size") == ln.size), None)
            if s_entry:
                full_number = s_entry.get("full_number") or _compute_full_number(full_number, ln.size, s_entry.get("jersey_number"))
        lines.append({
            "id": new_id(),
            "item_id": ln.item_id,
            "item_name": it.get("name"),
            "size": ln.size or "",
            "jersey_number": ln.jersey_number or "",
            "full_number": full_number,
            "category": it.get("category") or "",
            "main_group": it.get("main_group") or "",
            "sub_group": it.get("sub_group") or "",
            "note": (ln.note or "").strip(),
            "quantity_requested": int(ln.quantity_requested),
            "quantity_approved": 0,
            "quantity_immediate": 0,
            "quantity_to_order": 0,
            "quantity_handed_out": 0,
            "quantity_loaned": 0,
            "quantity_rejected": 0,
            "quantity_discontinued": 0,
            "line_status": "sendt",
            "line_status_history": [],
        })
    number = await _next_needs_request_number(tid)
    team_doc = await db.teams.find_one({"id": team_id, "tenant_id": tid}, {"_id": 0, "team_name": 1, "age_class": 1}) or {}
    now_s = now_iso()
    doc = {
        "id": new_id(),
        "number": number,
        "tenant_id": tid,
        "team_id": team_id,
        "team_name": team_doc.get("team_name") or acc["_team"].get("team_name"),
        "age_class": team_doc.get("age_class") or acc["_team"].get("age_class"),
        "contact_name": data.contact_name.strip(),
        "contact_phone": data.contact_phone.strip(),
        "contact_email": data.contact_email.strip().lower(),
        "wanted_date": data.wanted_date,
        "comment": (data.comment or "").strip(),
        "lines": lines,
        "status": "sendt",
        "source": "portal",
        "submitted_by_account_id": acc["id"],
        "created_at": now_s,
        "last_update_at": now_s,
        "started_processing_at": None,
        "started_processing_by": None,
        "started_processing_by_name": None,
        "closed_at": None,
        "closed_by": None,
        "status_history": [{"status": "sendt", "at": now_s, "by": acc.get("email"), "by_type": "portal"}],
        "notifications": {"new_need_email_sent": False, "new_need_email_error": None},
    }
    await db.needs_requests.insert_one(doc)
    try:
        club_users = await db.users.find({"tenant_id": tid, "active": True}, {"_id": 0, "id": 1}).to_list(100)
        for u in club_users:
            await db.notifications.insert_one({
                "id": new_id(),
                "tenant_id": tid,
                "user_id": u["id"],
                "kind": "needs_request_new",
                "title": f"Ny behovsmelding fra {doc['team_name']}",
                "message": f"{data.contact_name} meldte inn {len(lines)} varelinjer med ønsket dato {data.wanted_date} ({number}).",
                "link": f"/app/innmeldte-behov/{doc['id']}",
                "read": False,
                "created_at": now_s,
            })
    except Exception:
        logger.exception("Kunne ikke opprette in-app varsler for ny behovsmelding")
    try:
        await _send_new_need_email_to_club(tid, doc)
    except Exception:
        logger.exception("E-postvarsel om ny behovsmelding feilet")
    doc.pop("_id", None)
    doc["status_label"] = _needs_status_label(doc["status"])
    return doc


@api.post("/portal/needs/{nid}/withdraw")
async def portal_withdraw_need(nid: str, acc=Depends(get_portal_account)):
    n = await db.needs_requests.find_one({"id": nid, "tenant_id": acc["tenant_id"], "team_id": acc["team_id"]}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Behovsmelding finnes ikke")
    if n.get("status") != "sendt":
        raise HTTPException(400, "Behovsmeldingen kan ikke trekkes tilbake etter at klubben har startet behandlingen. Kontakt klubben.")
    now_s = now_iso()
    await db.needs_requests.update_one(
        {"id": nid, "tenant_id": acc["tenant_id"]},
        {
            "$set": {"status": "trukket_tilbake", "last_update_at": now_s, "withdrawn_at": now_s},
            "$push": {"status_history": {"status": "trukket_tilbake", "at": now_s, "by": acc.get("email"), "by_type": "portal"}},
        },
    )
    return {"ok": True}


# -------------- Klubbside: innmeldte behov (ren liste + start behandling) --------------
async def _send_new_need_email_to_club(tid: str, doc: dict):
    users = await db.users.find({"tenant_id": tid, "active": True}, {"_id": 0, "email": 1}).to_list(100)
    emails = [u["email"] for u in users if u.get("email")]
    if not emails:
        return
    club = await db.customers.find_one({"id": tid}, {"_id": 0, "club_name": 1}) or {}
    club_name = club.get("club_name") or "klubben"
    lines_html = "".join(
        f"<li>{(l.get('item_name') or '').strip()}"
        + (f" <em>({l.get('size')})</em>" if l.get('size') else "")
        + (f" #{l.get('jersey_number')}" if l.get('jersey_number') and l.get('jersey_number') != 'X' else "")
        + f" — <strong>{int(l.get('quantity_requested') or 0)} stk</strong>"
        + (f" <span style='color:#64748b'>(«{l.get('note')}»)</span>" if l.get('note') else "")
        + "</li>"
        for l in (doc.get("lines") or [])
    )
    app_base = os.environ.get("APP_URL", "https://utstyrsrommet.no")
    link = f"{app_base}/app/innmeldte-behov/{doc['id']}"
    html = (
        f"<p>Hei,</p>"
        f"<p>Det har kommet en ny behovsmelding i <strong>Lagsportalen</strong>:</p>"
        f"<table cellpadding='4' style='font-family:system-ui,sans-serif;border-collapse:collapse;'>"
        f"<tr><td>Meldingsnr</td><td><strong>{doc.get('number')}</strong></td></tr>"
        f"<tr><td>Lag</td><td><strong>{doc.get('team_name')}</strong>{(' · ' + doc.get('age_class')) if doc.get('age_class') else ''}</td></tr>"
        f"<tr><td>Kontakt</td><td>{doc.get('contact_name')} ({doc.get('contact_email')} / {doc.get('contact_phone')})</td></tr>"
        f"<tr><td>Ønsket dato</td><td><strong>{doc.get('wanted_date')}</strong></td></tr>"
        f"<tr><td>Antall linjer</td><td>{len(doc.get('lines') or [])}</td></tr>"
        f"</table>"
        f"<p><strong>Varelinjer:</strong></p><ul>{lines_html}</ul>"
        + (f"<p><strong>Kommentar fra laget:</strong> {doc.get('comment')}</p>" if doc.get("comment") else "")
        + f"<p><a href=\"{link}\" style=\"background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;display:inline-block;\">Åpne behandling i klubbappen</a></p>"
        f"<p style='font-size:11px;color:#94a3b8;margin-top:16px'>Dette er et automatisk varsel fra Utstyrsrommet · Lagsportal ({club_name}).</p>"
    )
    res = await send_tenant_email(tid, emails, f"Ny behovsmelding fra {doc.get('team_name')} ({doc.get('number')})", html)
    await db.needs_requests.update_one(
        {"id": doc["id"], "tenant_id": tid},
        {"$set": {
            "notifications.new_need_email_sent": bool(res.get("ok")),
            "notifications.new_need_email_error": None if res.get("ok") else (res.get("error") or "ukjent feil"),
            "notifications.new_need_email_at": now_iso(),
            "notifications.new_need_email_recipients": emails,
        }},
    )


def _compute_line_status(totals: dict, qr: int) -> str:
    s = sum(totals.values())
    if s == 0:
        return "pending"
    if s < qr:
        return "pending"
    nonzero = [k for k, v in totals.items() if v > 0]
    if len(nonzero) == 1:
        return nonzero[0]
    return "mixed"


def _compute_overall_needs_status(doc: dict) -> str:
    lines = doc.get("lines") or []
    if not lines:
        return doc.get("status") or "under_behandling"
    def _n(l, k): return int(l.get(k) or 0)
    all_full = all(
        (_n(l, "quantity_immediate") + _n(l, "quantity_to_order") + _n(l, "quantity_loaned")
         + _n(l, "quantity_rejected") + _n(l, "quantity_discontinued")) >= _n(l, "quantity_requested")
        for l in lines
    )
    has_immediate = any(_n(l, "quantity_immediate") > 0 for l in lines)
    has_to_order = any(_n(l, "quantity_to_order") > 0 for l in lines)
    has_loaned = any(_n(l, "quantity_loaned") > 0 for l in lines)
    if not all_full:
        return "under_behandling"
    if has_to_order and (has_immediate or has_loaned):
        return "behandlet_dellevering"
    if has_to_order:
        return "behandlet_ma_bestilles"
    if has_immediate or has_loaned:
        return "kan_leveres_omgaende"
    return "kan_leveres_omgaende"


class NeedsLineUpdateIn(BaseModel):
    quantity_immediate: Optional[int] = 0
    quantity_to_order: Optional[int] = 0
    quantity_loaned: Optional[int] = 0
    quantity_rejected: Optional[int] = 0
    quantity_discontinued: Optional[int] = 0
    admin_note: Optional[str] = None


@api.get("/needs-requests")
async def list_needs_requests(request: Request, user=Depends(require_perm("teams", "read")), team_id: Optional[str] = None, status: Optional[str] = None):
    tid = await require_tenant(request, user)
    q: Dict[str, Any] = {"tenant_id": tid}
    if team_id: q["team_id"] = team_id
    if status: q["status"] = status
    rows = await db.needs_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for r in rows:
        r["status_label"] = _needs_status_label(r.get("status"))
    return rows


@api.get("/needs-requests/{nid}")
async def get_needs_request(nid: str, request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    n = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Behovsmelding finnes ikke")
    n["status_label"] = _needs_status_label(n.get("status"))
    return n


@api.post("/needs-requests/{nid}/start-processing")
async def start_processing_need(nid: str, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    n = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Behovsmelding finnes ikke")
    if n.get("status") != "sendt":
        raise HTTPException(400, f"Behandlingen er allerede startet av {n.get('started_processing_by_name') or 'en annen bruker'} ({_needs_status_label(n.get('status'))}).")
    now_s = now_iso()
    await db.needs_requests.update_one(
        {"id": nid, "tenant_id": tid, "status": "sendt"},
        {
            "$set": {
                "status": "under_behandling",
                "started_processing_at": now_s,
                "started_processing_by": user.get("id"),
                "started_processing_by_name": user.get("name") or user.get("email"),
                "last_update_at": now_s,
            },
            "$push": {"status_history": {"status": "under_behandling", "at": now_s, "by": user.get("email"), "by_type": "club"}},
        },
    )
    await _log_activity(tid, user, "needs_start_processing", f"Startet behandling av {n.get('number')}", {"needs_id": nid})
    updated = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    updated["status_label"] = _needs_status_label(updated.get("status"))
    return updated


@api.put("/needs-requests/{nid}/lines/{lid}")
async def update_needs_line(nid: str, lid: str, data: NeedsLineUpdateIn, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    n = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Behovsmelding finnes ikke")
    if n.get("status") in ("sendt", "trukket_tilbake", "avsluttet"):
        raise HTTPException(400, f"Linjebehandling kan ikke endres når meldingen har status «{_needs_status_label(n.get('status'))}». Trykk «Start Behandling» først.")
    line = next((l for l in (n.get("lines") or []) if l.get("id") == lid), None)
    if not line:
        raise HTTPException(404, "Linje finnes ikke")
    qr = int(line.get("quantity_requested") or 0)
    totals = {
        "immediate": max(0, int(data.quantity_immediate or 0)),
        "to_order": max(0, int(data.quantity_to_order or 0)),
        "loaned": max(0, int(data.quantity_loaned or 0)),
        "rejected": max(0, int(data.quantity_rejected or 0)),
        "discontinued": max(0, int(data.quantity_discontinued or 0)),
    }
    s = sum(totals.values())
    if s > qr:
        raise HTTPException(400, f"Summen av behandlingen ({s}) kan ikke overstige bestilt antall ({qr}).")
    approved = totals["immediate"] + totals["to_order"] + totals["loaned"]
    line_status = _compute_line_status(totals, qr)
    now_s = now_iso()
    set_doc = {
        "lines.$.quantity_immediate": totals["immediate"],
        "lines.$.quantity_to_order": totals["to_order"],
        "lines.$.quantity_loaned": totals["loaned"],
        "lines.$.quantity_rejected": totals["rejected"],
        "lines.$.quantity_discontinued": totals["discontinued"],
        "lines.$.quantity_approved": approved,
        "lines.$.line_status": line_status,
        "lines.$.line_updated_at": now_s,
        "lines.$.line_updated_by": user.get("name") or user.get("email"),
        "last_update_at": now_s,
    }
    if data.admin_note is not None:
        set_doc["lines.$.admin_note"] = data.admin_note.strip()
    await db.needs_requests.update_one(
        {"id": nid, "tenant_id": tid, "lines.id": lid},
        {"$set": set_doc},
    )
    refreshed = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    new_status = _compute_overall_needs_status(refreshed)
    if new_status != refreshed.get("status"):
        await db.needs_requests.update_one(
            {"id": nid, "tenant_id": tid},
            {
                "$set": {"status": new_status, "last_update_at": now_s},
                "$push": {"status_history": {"status": new_status, "at": now_s, "by": user.get("email"), "by_type": "club", "auto": True}},
            },
        )
    await _log_activity(tid, user, "needs_line_updated",
                         f"Oppdaterte linje i {refreshed.get('number')}", {"needs_id": nid, "line_id": lid, "totals": totals})
    out = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    out["status_label"] = _needs_status_label(out.get("status"))
    return out


@api.post("/needs-requests/{nid}/close")
async def close_needs_request(nid: str, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    n = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Behovsmelding finnes ikke")
    if n.get("status") == "avsluttet":
        raise HTTPException(400, "Behovsmeldingen er allerede avsluttet.")
    if n.get("status") in ("sendt", "trukket_tilbake"):
        raise HTTPException(400, "Kan ikke avslutte en melding som ikke er under behandling.")
    now_s = now_iso()
    await db.needs_requests.update_one(
        {"id": nid, "tenant_id": tid},
        {
            "$set": {"status": "avsluttet", "closed_at": now_s, "closed_by": user.get("id"), "closed_by_name": user.get("name") or user.get("email"), "last_update_at": now_s},
            "$push": {"status_history": {"status": "avsluttet", "at": now_s, "by": user.get("email"), "by_type": "club"}},
        },
    )
    await _log_activity(tid, user, "needs_closed", f"Avsluttet {n.get('number')}", {"needs_id": nid})
    out = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    out["status_label"] = _needs_status_label(out.get("status"))
    return out


@api.post("/needs-requests/{nid}/reopen")
async def reopen_needs_request(nid: str, request: Request, user=Depends(require_perm("teams", "write"))):
    tid = await require_tenant(request, user)
    n = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Behovsmelding finnes ikke")
    if n.get("status") != "avsluttet":
        raise HTTPException(400, "Kun avsluttede meldinger kan åpnes igjen.")
    now_s = now_iso()
    new_status = _compute_overall_needs_status(n)
    if new_status == "avsluttet":
        new_status = "under_behandling"
    await db.needs_requests.update_one(
        {"id": nid, "tenant_id": tid},
        {
            "$set": {"status": new_status, "closed_at": None, "closed_by": None, "closed_by_name": None, "last_update_at": now_s},
            "$push": {"status_history": {"status": new_status, "at": now_s, "by": user.get("email"), "by_type": "club", "reopened": True}},
        },
    )
    await _log_activity(tid, user, "needs_reopened", f"Åpnet {n.get('number')} igjen", {"needs_id": nid})
    out = await db.needs_requests.find_one({"id": nid, "tenant_id": tid}, {"_id": 0})
    out["status_label"] = _needs_status_label(out.get("status"))
    return out


# -------------- Klubbside: er lagsportalen aktiv (brukes av UI) --------------
@api.get("/team-portal/status")
async def team_portal_status(request: Request, user=Depends(get_current_user)):
    tid = await resolve_tenant_id(request, user)
    if not tid:
        return {"active": False, "plan": None}
    plan = await get_tenant_plan(tid)
    return {"active": bool(plan.get("team_portal")), "plan": plan.get("key")}
