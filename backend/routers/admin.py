"""
Router for admin-funksjoner – UTSTYRSROMMET

Inneholder:
- Auth-ruter (login, logout, me, profile)
- Notification settings (per tenant) + cron due-date reminders
- Invitations / set-password
- Users CRUD + login-history + resend-invitation
- Activity-log (per tenant + cross-tenant for plattformeier)
- Database reset (per seksjon)
- Clubs CRUD + logo upload
- Help manual PDF
- QR labels + QR filters
- Dashboard stats
- Exports (inventory + team)
- Email settings (get/put/test)

Hjelpefunksjoner som kun brukes her: _get_notification_settings,
_run_due_date_reminders, _can_reset_section, _build_help_manual_pdf,
HELP_MANUAL_SECTIONS, DEFAULT_REMINDER_BEFORE/AFTER, VALID_RESET_SECTIONS,
MyProfileIn, NotificationSettingsIn.
Felles hjelpefunksjoner importeres via _shared.
"""
import io
import re
import asyncio
import base64 as _b64mod
import secrets as pysecrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openpyxl import Workbook

from ._shared import (
    api, db, require_tenant, require_perm, require_feature,
    require_admin, require_platform_owner, get_current_user,
    resolve_tenant_id, get_tenant_plan, now_iso, new_id,
    _clean, _cookie, hash_password, verify_password, create_access_token,
    _compute_full_number, _load_club_logo, _xlsx_response,
    send_tenant_email, send_invitation_email,
    _enc, _get_tenant_email_cfg, _redact_email_cfg,
    _generate_team_equipment_pdf_for_tenant, _lookup_full_numbers_for_loans,
    _build_team_equipment_pdf, _sync_subscription_status, _trial_days_left,
    default_perms, admin_perms,
    JWT_SECRET, JWT_ALGORITHM, logger, PLANS,
    WEBHOOK_CRON_SECRET, FRONTEND_URL, EMAIL_FROM_NAME,
    # Pydantic models
    LoginIn, SetPasswordIn, UserCreateIn, UserUpdateIn, ResetSectionIn,
    ClubIn, TenantEmailSettingsIn, EmailTestIn,
)


# ==================== Auth ====================

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
    # Platform-eier pålogginger skal IKKE registreres i noen logger
    if user.get("role") == "platform_owner":
        return {"user": _clean(dict(user)), "token": token}
    # Track login
    now = now_iso()
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
    import jwt
    token = request.cookies.get("access_token") or (request.headers.get("Authorization", "")[7:] if request.headers.get("Authorization", "").startswith("Bearer ") else None)
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": False})
            uid = payload.get("sub")
            if uid:
                u = await db.users.find_one({"id": uid}, {"_id": 0, "role": 1})
                if u and u.get("role") != "platform_owner":
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
    # Sikre at role_title alltid returneres (default-tom for eldre brukere) – brukes i sidepanel-signaturen.
    if "role_title" not in user:
        user["role_title"] = ""
    # Hent klubbnavnet brukeren faktisk har lagt inn (clubs-collection) – vises i sidepanelet.
    club = None
    if tid:
        club = await db.clubs.find_one({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1})
    return {
        "user": user,
        "tenant_id": tid,
        "customer": customer,
        "club": club,
        "plan": plan,
        "trial_days_left": trial_days_left,
        "impersonating": impersonating,
    }


class MyProfileIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    # Merk: `role_title` kan IKKE endres av bruker selv – kun av admin via PUT /users/{id}


@api.put("/auth/me/profile")
async def update_my_profile(data: MyProfileIn, request: Request, user=Depends(get_current_user)):
    """Oppdater egen profil (navn, telefon, adresse). Brukes bl.a. for å få telefon på utstyrs-PDFen.
    role_title er admin-styrt og kan ikke endres her."""
    update = {}
    if data.name is not None: update["name"] = data.name.strip()
    if data.phone is not None: update["phone"] = data.phone.strip()
    if data.address is not None: update["address"] = data.address.strip()
    if not update:
        return {"ok": True}
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})


# ==================== Notification settings (per tenant) ====================
DEFAULT_REMINDER_BEFORE = [14, 7]
DEFAULT_REMINDER_AFTER = [1]


class NotificationSettingsIn(BaseModel):
    reminder_before_days: Optional[List[int]] = None  # dager før frist
    reminder_after_days: Optional[List[int]] = None   # dager etter frist
    enabled: Optional[bool] = True


async def _get_notification_settings(tid: str) -> dict:
    cfg = await db.notification_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    return {
        "enabled": bool(cfg.get("enabled", True)),
        "reminder_before_days": cfg.get("reminder_before_days") or DEFAULT_REMINDER_BEFORE,
        "reminder_after_days": cfg.get("reminder_after_days") or DEFAULT_REMINDER_AFTER,
    }


@api.get("/notification-settings")
async def get_notification_settings(request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    return await _get_notification_settings(tid)


@api.put("/notification-settings")
async def put_notification_settings(data: NotificationSettingsIn, request: Request,
                                      user=Depends(require_perm("inventory", "admin"))):
    tid = await require_tenant(request, user)
    # Valider: positive heltall, maks 30 per felt
    def _clean(xs, name):
        if xs is None: return None
        out = []
        for x in xs:
            try:
                v = int(x)
                if 0 <= v <= 180:
                    out.append(v)
            except Exception:
                continue
        if len(out) > 10:
            raise HTTPException(400, f"Maks 10 verdier for {name}")
        return sorted(set(out), reverse=True)
    update = {"tenant_id": tid, "updated_at": now_iso(), "updated_by": user.get("email")}
    if data.enabled is not None: update["enabled"] = bool(data.enabled)
    rb = _clean(data.reminder_before_days, "reminder_before_days")
    ra = _clean(data.reminder_after_days, "reminder_after_days")
    if rb is not None: update["reminder_before_days"] = rb
    if ra is not None: update["reminder_after_days"] = ra
    await db.notification_settings.update_one({"tenant_id": tid}, {"$set": update}, upsert=True)
    return await _get_notification_settings(tid)


# ==================== Cron: Due-date reminders for team loans ====================
async def _run_due_date_reminders():
    """Send e-postvarsel for utlån med nærme/forfalt frist.
    Dagene (før/etter) er konfigurerbare pr tenant via `notification_settings`.
    Default: [14, 7] før, [1] etter (overdue → kopi til alle aktive brukere).
    Idempotent via `reminder_sent_{N}d_{before|after}`-flagg pr lån.
    """
    now = datetime.now(timezone.utc)
    today = now.date()
    sent = 0
    # Build per-tenant config cache
    settings_cache: Dict[str, dict] = {}

    async def _get_cached(tid: str):
        if tid not in settings_cache:
            settings_cache[tid] = await _get_notification_settings(tid)
        return settings_cache[tid]

    # Finn lån med team_id, status=borrowed og due_date satt
    cursor = db.loans.find({"team_id": {"$ne": None}, "status": "borrowed", "due_date": {"$ne": None}})
    # Grupper (tenant_id, team_id, milepel-nøkkel) → set av loan_ids
    buckets: Dict[tuple, Dict[str, Any]] = {}
    async for ln in cursor:
        due_iso = ln.get("due_date")
        if not due_iso: continue
        try:
            due_dt = datetime.fromisoformat(due_iso.replace("Z", "+00:00"))
        except Exception:
            continue
        tid = ln["tenant_id"]
        cfg = await _get_cached(tid)
        if not cfg.get("enabled", True):
            continue
        days_until = (due_dt.date() - today).days
        milestone = None; flag = None; direction = None
        if days_until > 0 and days_until in (cfg.get("reminder_before_days") or []):
            direction = "before"; milestone = f"{days_until}d_before"
            flag = f"reminder_sent_{days_until}d_before"
        elif days_until < 0:
            days_after = -days_until
            if days_after in (cfg.get("reminder_after_days") or []):
                direction = "after"; milestone = f"{days_after}d_after"
                flag = f"reminder_sent_{days_after}d_after"
        if not milestone or ln.get(flag):
            continue
        key = (tid, ln["team_id"], milestone)
        b = buckets.setdefault(key, {"loan_ids": [], "flag": flag,
                                        "direction": direction,
                                        "days": days_until if direction == "before" else -days_until})
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
            days = b["days"]
            if b["direction"] == "before":
                subject = f"Påminnelse: Utstyr for {team.get('team_name')} skal returneres om {days} dager"
                lead_html = f"<p>Hei {leader_name},</p><p>Dette er en vennlig påminnelse om at utstyr lånt til <strong>{team.get('team_name')}</strong> har frist for retur om <strong>{days} dager</strong>. Vedlagt oversikt over hva som er utestående.</p>"
            else:
                subject = f"VIKTIG: Utstyr for {team.get('team_name')} er {days} dag(er) over frist"
                lead_html = f"<p>Hei {leader_name},</p><p>Utstyr lånt til <strong>{team.get('team_name')}</strong> er nå <strong>{days} dag(er) over frist</strong>. Vennligst returner snarest. Vedlagt oversikt.</p>"
            html = lead_html + f"<p>Mvh<br/>{club_name}</p>"
            pdf_b64 = _b64mod.b64encode(pdf_bytes).decode()
            safe = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name", "lag"))
            attachments = [{"filename": f"utstyr_{safe}.pdf", "content": pdf_b64, "type": "application/pdf"}]
            cc_list = []
            if b["direction"] == "after":
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


# ==================== Invitations / Set password ====================

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


# ==================== Users (per tenant) ====================

@api.get("/users")
async def list_users(request: Request, user=Depends(require_admin)):
    tid = await require_tenant(request, user)
    users = await db.users.find({"tenant_id": tid}, {"_id": 0, "password_hash": 0}).to_list(200)
    # Online = last_seen innen 5 min
    threshold = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    for u in users:
        last_seen = u.get("last_seen")
        u["online"] = bool(last_seen and last_seen >= threshold)
        # Sikre at role_title alltid er med i responsen (default-tom for eldre brukere)
        if "role_title" not in u:
            u["role_title"] = ""
    return users


@api.get("/users/{user_id}/login-history")
async def user_login_history(user_id: str, request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    target = await db.users.find_one({"id": user_id, "tenant_id": tid})
    if not target:
        raise HTTPException(404, "Bruker ikke funnet")
    # Tilgangskontroll: admin + platform_owner ser alt. Vanlige brukere trenger `can_view_login_history`.
    # En bruker kan alltid se sin EGEN historikk.
    is_admin = user.get("role") in ("admin", "platform_owner")
    is_self = user.get("id") == user_id
    can_view = bool(user.get("can_view_login_history"))
    if not (is_admin or is_self or can_view):
        raise HTTPException(403, "Du har ikke tilgang til å se påloggingshistorikk")
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
        "role": data.role, "role_title": (data.role_title or "").strip(),
        "permissions": perms, "active": True, "is_super_admin": False,
        "reset_permissions": list(data.reset_permissions or []) if data.role != "admin" else [],
        "can_view_login_history": bool(data.can_view_login_history) if data.role != "admin" else True,
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


# ==================== Activity log ====================

@api.get("/activity-log")
async def get_activity_log(request: Request, limit: int = 10, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    limit = max(1, min(int(limit or 10), 500))
    rows = await db.activity_log.find({"tenant_id": tid}, {"_id": 0}).sort("at", -1).to_list(limit)
    # Mix in last 50 loans and returns if activity_log er tomt (migration helper)
    if not rows:
        loans = await db.loans.find({"tenant_id": tid}, {"_id": 0}).sort("loan_date", -1).to_list(50)
        for l in loans[:limit]:
            action = "return_loan" if l.get("status") == "returned" else "create_loan"
            desc = f"{'Returnert' if action == 'return_loan' else 'Utlånt'} {l.get('quantity')}× {l.get('item_name')}"
            rows.append({
                "id": l["id"], "tenant_id": tid,
                "at": l.get("return_date") or l.get("loan_date"),
                "action": action, "description": desc,
                "by": None, "by_name": None, "meta": {"loan_id": l["id"]},
            })
    return rows


@api.get("/activity-log/search")
async def search_activity_log(
    request: Request,
    q: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 100,
    skip: int = 0,
    user=Depends(require_admin),
):
    """Avansert aktivitetslogg for klubbadmin. Krever admin eller platform_owner."""
    tid = await require_tenant(request, user)
    limit = max(1, min(int(limit or 100), 500))
    skip = max(0, int(skip or 0))
    filt: Dict[str, Any] = {"tenant_id": tid}
    if action: filt["action"] = action
    if user_id: filt["by_user_id"] = user_id
    if from_date or to_date:
        rng: Dict[str, Any] = {}
        if from_date: rng["$gte"] = from_date
        if to_date: rng["$lte"] = to_date
        filt["at"] = rng
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        filt["$or"] = [{"description": rx}, {"action": rx}, {"by": rx}, {"by_name": rx}]
    total = await db.activity_log.count_documents(filt)
    rows = await db.activity_log.find(filt, {"_id": 0}).sort("at", -1).skip(skip).limit(limit).to_list(limit)
    distinct_actions = await db.activity_log.distinct("action", {"tenant_id": tid})
    distinct_users = await db.activity_log.aggregate([
        {"$match": {"tenant_id": tid, "by_user_id": {"$ne": None}}},
        {"$group": {"_id": "$by_user_id", "name": {"$first": "$by_name"}, "email": {"$first": "$by"}}},
        {"$limit": 200},
    ]).to_list(200)
    return {
        "total": total, "items": rows,
        "distinct_actions": sorted([a for a in distinct_actions if a]),
        "distinct_users": [{"id": u["_id"], "name": u.get("name"), "email": u.get("email")} for u in distinct_users],
    }


@api.get("/owner/activity-log/all")
async def owner_cross_tenant_activity_log(
    q: Optional[str] = None,
    action: Optional[str] = None,
    tenant_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 200,
    skip: int = 0,
    user=Depends(require_platform_owner),
):
    """Kryss-tenant aktivitetslogg KUN for plattformeier."""
    limit = max(1, min(int(limit or 200), 1000))
    skip = max(0, int(skip or 0))
    filt: Dict[str, Any] = {}
    if tenant_id: filt["tenant_id"] = tenant_id
    if action: filt["action"] = action
    if from_date or to_date:
        rng: Dict[str, Any] = {}
        if from_date: rng["$gte"] = from_date
        if to_date: rng["$lte"] = to_date
        filt["at"] = rng
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        filt["$or"] = [{"description": rx}, {"action": rx}, {"by": rx}, {"by_name": rx}]
    total = await db.activity_log.count_documents(filt)
    rows = await db.activity_log.find(filt, {"_id": 0}).sort("at", -1).skip(skip).limit(limit).to_list(limit)
    tenant_ids = list({r.get("tenant_id") for r in rows if r.get("tenant_id")})
    customers = await db.customers.find({"id": {"$in": tenant_ids}}, {"_id": 0, "id": 1, "club_name": 1, "customer_number": 1}).to_list(len(tenant_ids))
    cust_by_id = {c["id"]: c for c in customers}
    for r in rows:
        c = cust_by_id.get(r.get("tenant_id"))
        r["club_name"] = c.get("club_name") if c else None
        r["customer_number"] = c.get("customer_number") if c else None
    distinct_actions = await db.activity_log.distinct("action")
    return {
        "total": total, "items": rows,
        "distinct_actions": sorted([a for a in distinct_actions if a]),
    }


# ==================== Database reset (per seksjon) ====================
VALID_RESET_SECTIONS = ("inventory", "suppliers", "teams", "people", "users", "all")


def _can_reset_section(user: dict, section: str) -> bool:
    if user.get("role") in ("admin", "platform_owner"):
        return True
    perms = user.get("reset_permissions") or []
    return section in perms


@api.get("/reset/preview/{section}")
async def reset_preview(section: str, request: Request, user=Depends(get_current_user)):
    tid = await require_tenant(request, user)
    if section not in VALID_RESET_SECTIONS:
        raise HTTPException(400, "Ugyldig seksjon")
    if not _can_reset_section(user, section):
        raise HTTPException(403, "Du har ikke tilgang til å nullstille denne seksjonen")
    counts: Dict[str, int] = {}
    if section in ("inventory", "all"):
        counts["items"] = await db.items.count_documents({"tenant_id": tid})
        counts["loans"] = await db.loans.count_documents({"tenant_id": tid})
    if section in ("suppliers", "all"):
        counts["suppliers"] = await db.suppliers.count_documents({"tenant_id": tid})
        counts["purchase_orders"] = await db.purchase_orders.count_documents({"tenant_id": tid})
        counts["behovsskjema"] = await db.behovsskjema.count_documents({"tenant_id": tid})
    if section in ("teams", "all"):
        counts["teams"] = await db.teams.count_documents({"tenant_id": tid})
    if section in ("people", "all"):
        counts["people"] = await db.people.count_documents({"tenant_id": tid})
    if section == "users":
        counts["users_non_admin"] = await db.users.count_documents({"tenant_id": tid, "role": {"$ne": "admin"}})
    return {"section": section, "counts": counts}


@api.post("/reset/{section}")
async def reset_section(section: str, data: ResetSectionIn, request: Request, user=Depends(get_current_user)):
    """Sletter alle data for valgt seksjon innen tenanten. Krever passord-bekreftelse."""
    tid = await require_tenant(request, user)
    if section not in VALID_RESET_SECTIONS:
        raise HTTPException(400, "Ugyldig seksjon")
    if not _can_reset_section(user, section):
        raise HTTPException(403, "Du har ikke tilgang til å nullstille denne seksjonen")
    if not data.confirm:
        raise HTTPException(400, "Mangler bekreftelse")
    full_user = await db.users.find_one({"id": user["id"]})
    if not full_user or not verify_password(data.password, full_user.get("password_hash", "")):
        raise HTTPException(401, "Feil passord")

    # Reset-kvoter: app-eier (platform_owner) + hovedadmin (super_admin) ingen begrensning.
    # Admin: maks 1 reset / 7 dager. Vanlig bruker: maks 1 reset / 30 dager.
    role = user.get("role")
    if role != "platform_owner" and not full_user.get("is_super_admin"):
        window_days = 7 if role == "admin" else 30
        label = "uke" if window_days == 7 else "måned"
        since = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()
        recent = await db.audit_log.find_one({
            "tenant_id": tid, "action": "database_reset",
            "by_user_id": user["id"], "at": {"$gte": since},
        }, sort=[("at", -1)])
        if recent:
            try:
                last_dt = datetime.fromisoformat(recent["at"].replace("Z", "+00:00"))
                next_dt = last_dt + timedelta(days=window_days)
                next_str = next_dt.strftime("%d.%m.%Y %H:%M")
            except Exception:
                next_str = "senere"
            raise HTTPException(429,
                f"Reset-kvote: maks 1 nullstilling pr {label}. Neste nullstilling kan utføres etter {next_str}.")

    deleted: Dict[str, int] = {}

    async def _del(coll_name: str, filt: dict):
        r = await db[coll_name].delete_many(filt)
        deleted[coll_name] = r.deleted_count

    tf = {"tenant_id": tid}
    if section in ("inventory", "all"):
        await _del("loans", tf)
        await _del("items", tf)
        await db.teams.update_many(tf, {"$set": {"debt": 0}})
        await db.people.update_many(tf, {"$set": {"debt": 0}})
    if section in ("suppliers", "all"):
        await _del("suppliers", tf)
        await _del("purchase_orders", tf)
        await _del("behovsskjema", tf)
    if section in ("teams", "all"):
        if section == "teams":
            await db.loans.update_many({**tf, "team_id": {"$ne": None}},
                                        {"$set": {"team_id": None}})
        await _del("teams", tf)
    if section in ("people", "all"):
        if section == "people":
            await db.loans.update_many({**tf, "person_id": {"$ne": None}},
                                        {"$set": {"person_id": None, "picked_up_by": None}})
        await _del("people", tf)
    if section in ("users",):
        r = await db.users.delete_many({"tenant_id": tid, "role": {"$ne": "admin"},
                                          "id": {"$ne": user["id"]}})
        deleted["users"] = r.deleted_count

    # Platform-eier skal ikke logges i audit_log (unngår fotavtrykk hos klubben)
    if role != "platform_owner":
        await db.audit_log.insert_one({
            "id": new_id(), "tenant_id": tid, "action": "database_reset",
            "section": section, "by": user.get("email"), "by_user_id": user.get("id"),
            "deleted": deleted, "at": now_iso(),
        })
    return {"ok": True, "section": section, "deleted": deleted}


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


# ==================== Clubs ====================

@api.get("/clubs")
async def list_clubs(request: Request, user=Depends(get_current_user)):
    tid = await resolve_tenant_id(request, user)
    if not tid:
        return []  # Platform-eier uten impersonering har ingen klubb
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


# ==================== Help manual PDF ====================
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


def _build_help_manual_pdf(club_name: str) -> bytes:
    """Genererer bruker-manualen som PDF via ReportLab (frisk hver gang, ingen caching)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.pdfbase.pdfmetrics import stringWidth

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    LEFT = 20 * mm; RIGHT = w - 20 * mm
    USABLE_W = RIGHT - LEFT
    y = h - 20 * mm

    def _ensure_space(needed_mm: float):
        nonlocal y
        if y - needed_mm < 20 * mm:
            c.showPage()
            y = h - 20 * mm

    def _wrap(text: str, max_w: float, font: str, font_size: float) -> List[str]:
        """Bryter en tekst i linjer slik at ingen linje er bredere enn max_w (i user units)."""
        words = text.split()
        lines: List[str] = []
        cur = ""
        for word in words:
            trial = (cur + " " + word).strip()
            if stringWidth(trial, font, font_size) <= max_w:
                cur = trial
            else:
                if cur: lines.append(cur)
                cur = word
        if cur: lines.append(cur)
        return lines

    # ---- Forside / tittel ----
    c.setFillColorRGB(0.52, 0.09, 0.11)  # red-900
    c.setFont("Helvetica-Bold", 24)
    c.drawString(LEFT, y, "HJELPESENTER")
    c.setFillColorRGB(0, 0, 0)
    y -= 8 * mm
    c.setFont("Helvetica", 11)
    c.drawString(LEFT, y, f"Brukermanual for {club_name}")
    y -= 5 * mm
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(LEFT, y, f"Generert {datetime.now(timezone.utc).strftime('%d.%m.%Y %H:%M')} – UTSTYRSROMMET")
    c.setFillColorRGB(0, 0, 0)
    y -= 8 * mm
    c.line(LEFT, y, RIGHT, y)
    y -= 10 * mm

    # ---- Innholdsfortegnelse ----
    c.setFont("Helvetica-Bold", 13)
    c.drawString(LEFT, y, "Innhold")
    y -= 7 * mm
    c.setFont("Helvetica", 10)
    for i, (title, _) in enumerate(HELP_MANUAL_SECTIONS, 1):
        _ensure_space(6 * mm)
        c.drawString(LEFT + 4 * mm, y, f"{i}. {title}")
        y -= 5 * mm
    y -= 5 * mm

    # ---- Seksjoner ----
    for i, (title, paragraphs) in enumerate(HELP_MANUAL_SECTIONS, 1):
        _ensure_space(18 * mm)
        c.setFont("Helvetica-Bold", 15)
        c.setFillColorRGB(0.52, 0.09, 0.11)
        c.drawString(LEFT, y, f"{i}. {title}")
        c.setFillColorRGB(0, 0, 0)
        y -= 3 * mm
        c.setStrokeColorRGB(0.85, 0.85, 0.85)
        c.line(LEFT, y, RIGHT, y)
        c.setStrokeColorRGB(0, 0, 0)
        y -= 6 * mm

        c.setFont("Helvetica", 10)
        for para in paragraphs:
            lines = _wrap(para, USABLE_W - 4 * mm, "Helvetica", 10)
            # Beregn høyde og bytt side om nødvendig
            needed = (len(lines) * 5 + 3) * mm
            _ensure_space(needed)
            # Punkt-bullet
            c.setFillColorRGB(0.52, 0.09, 0.11)
            c.drawString(LEFT, y, "\u2022")
            c.setFillColorRGB(0, 0, 0)
            for ln in lines:
                c.drawString(LEFT + 4 * mm, y, ln)
                y -= 5 * mm
            y -= 2 * mm  # avstand mellom punkter

        y -= 4 * mm  # avstand før neste seksjon

    # ---- Bunntekst ----
    _ensure_space(16 * mm)
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.line(LEFT, y, RIGHT, y)
    y -= 5 * mm
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(LEFT, y, "Trenger du hjelp? Kontakt administrator i klubben eller send en e-post til support.")
    c.drawRightString(RIGHT, y, f"© {datetime.now(timezone.utc).year} UTSTYRSROMMET")

    c.save()
    return buf.getvalue()


@api.get("/help/manual-pdf")
async def download_help_manual_pdf(request: Request, user=Depends(get_current_user)):
    """Generer hjelpemanualen som PDF – ingen caching, bygges fra scratch hver gang."""
    tid = await resolve_tenant_id(request, user)
    club_name = "Klubben"
    if tid:
        club = await db.clubs.find_one({"tenant_id": tid}, {"_id": 0, "name": 1})
        cust = await db.customers.find_one({"id": tid}, {"_id": 0, "club_name": 1})
        club_name = (club or {}).get("name") or (cust or {}).get("club_name") or "Klubben"
    pdf_bytes = await asyncio.to_thread(_build_help_manual_pdf, club_name)
    date_tag = datetime.now(timezone.utc).strftime("%Y%m%d")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="hjelpesenter_{date_tag}.pdf"'},
    )


# ==================== QR Labels ====================

@api.get("/inventory/qr-labels")
async def inventory_qr_labels(
    request: Request,
    scope: str = "all",      # 'all' | 'item' | 'variant' | 'main_group' | 'sub_group'
    value: str = "",         # when scope != 'all' (item_id, group name)
    variant_size: str = "",  # fylles ut når scope='variant' – spesifikk varelinje
    size: str = "medium",    # label-størrelse: 'small' (2cm) | 'medium' (6cm) | 'large' (10cm)
    copies: int = 1,         # antall kopier per varelinje
    user=Depends(require_perm("inventory", "read"))
):
    tid = await require_feature(request, user, "qr_codes")
    # Build filter: only items that have QR enabled
    q: Dict[str, Any] = {"tenant_id": tid, "has_qr": True}
    if scope in ("item", "variant") and value:
        q["id"] = value
    elif scope == "main_group" and value:
        q["main_group"] = value
    elif scope == "sub_group" and value:
        q["sub_group"] = value
    items = await db.items.find(q, {"_id": 0}).sort([("main_group", 1), ("sub_group", 1), ("name", 1)]).to_list(5000)
    # Expand: ett label pr aktiv størrelse (sized), eller én label (sizeless)
    labels: List[Dict[str, Any]] = []
    for it in items:
        main_num = it.get("main_item_number") or it.get("full_number") or ""
        if it.get("is_clothing") or it.get("is_ball"):
            for s in it.get("sizes", []):
                if not s.get("has_qr"): continue
                if scope == "variant" and variant_size and s.get("size") != variant_size: continue
                fn = s.get("full_number") or _compute_full_number(main_num, s.get("size"), s.get("jersey_number"))
                labels.append({"payload": f"{it['id']}#{s['size']}",
                               "full_number": fn,
                               "name": f"{it['name']} ({s['size']})"})
        elif it.get("has_qr"):
            labels.append({"payload": it["id"],
                           "full_number": main_num,
                           "name": it["name"]})
    if not labels:
        raise HTTPException(404, "Ingen varer med QR-kode funnet for valgt filter")

    # Repliker antall kopier – gir N identiske etiketter per varelinje
    copies = max(1, min(copies or 1, 500))
    if copies > 1:
        labels = [lab for lab in labels for _ in range(copies)]

    logo_img = await _load_club_logo(tid)

    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader

    # Grid config per size.
    # label_mm = høyde på tekstområdet under QR. Må være høy nok for Varenr (bold) + navn/str.
    size_cfg = {
        "small":  {"qr_mm": 20, "label_mm": 6,  "font_num": 7,  "font_name": 0},   # kun varenr
        "medium": {"qr_mm": 60, "label_mm": 14, "font_num": 11, "font_name": 8},   # varenr + navn
        "large":  {"qr_mm": 100,"label_mm": 20, "font_num": 14, "font_name": 10},  # varenr + navn
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

        # Tekst: varenummer (fete typer) + navn/str (slankere, mindre). Hvis small => kun varenummer.
        center_x_mm = x_mm + qr_mm / 2
        varenr = (lab.get("full_number") or lab.get("name") or "")[:30]
        if size == "small":
            c.setFont("Helvetica-Bold", cfg["font_num"])
            c.drawCentredString(center_x_mm * mm, (y_mm + label_mm / 2 - 1) * mm, varenr[:18])
        else:
            # To linjer: varenr (øvre), navn (nedre)
            c.setFont("Helvetica-Bold", cfg["font_num"])
            c.drawCentredString(center_x_mm * mm, (y_mm + label_mm - cfg["font_num"] / 2.6) * mm, varenr)
            name_text = (lab.get("name") or "")[:40]
            if cfg["font_name"] > 0 and name_text:
                c.setFont("Helvetica", cfg["font_name"])
                c.drawCentredString(center_x_mm * mm, (y_mm + 1.5) * mm, name_text)

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


# ==================== Dashboard ====================

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
    # Lån med frist denne uka (0-7 dager fra nå, status borrowed)
    now_dt = datetime.now(timezone.utc)
    week_cutoff = (now_dt + timedelta(days=7)).isoformat()
    due_soon_raw = await db.loans.find({
        "tenant_id": tid, "status": "borrowed",
        "due_date": {"$ne": None, "$lte": week_cutoff}
    }, {"_id": 0}).sort("due_date", 1).to_list(100)
    team_ids = list({l.get("team_id") for l in due_soon_raw if l.get("team_id")})
    teams_map = {t["id"]: t for t in await db.teams.find({"id": {"$in": team_ids}, "tenant_id": tid},
                                                            {"_id": 0, "id": 1, "team_name": 1}).to_list(500)}
    due_soon = []
    for l in due_soon_raw:
        try:
            dd = datetime.fromisoformat(l["due_date"].replace("Z", "+00:00"))
            days = (dd.date() - now_dt.date()).days
        except Exception:
            days = None
        due_soon.append({
            "id": l["id"], "item_name": l.get("item_name"),
            "quantity": l.get("quantity"), "size": l.get("size"),
            "team_name": teams_map.get(l.get("team_id"), {}).get("team_name"),
            "team_id": l.get("team_id"),
            "due_date": l.get("due_date"), "days_until_due": days,
            "amount_owed": l.get("amount_owed") or 0,
            "is_overdue": days is not None and days < 0,
        })
    return {"total_items": total_items, "active_loans": active_loans, "teams": teams, "people": people,
            "team_debt": team_debt, "person_debt": person_debt, "stock_value": stock_value,
            "low_stock_count": len(low_stock), "low_stock_items": low_stock[:10], "recent_loans": recent,
            "due_soon": due_soon}


# ==================== Exports ====================

@api.get("/export/inventory")
async def export_inventory(request: Request, user=Depends(require_perm("inventory", "read"))):
    tid = await require_feature(request, user, "excel_export")
    items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(10000)
    wb = Workbook(); ws = wb.active; ws.title = "Beholdning"
    ws.append(["Varenummer", "Varenavn", "Størrelse", "Draktnr", "Antall",
               "Kategori", "Hovedgruppe", "Undergruppe", "Pris", "Lokasjon",
               "Type", "Lokasjon pr str", "Hovedvarenummer"])
    for it in items:
        type_str = "klær" if it.get("is_clothing") else ("ball" if it.get("is_ball") else "vare")
        main_num = it.get("main_item_number") or ""
        if (it.get("is_clothing") or it.get("is_ball")) and it.get("sizes"):
            for s in it["sizes"]:
                full = s.get("full_number") or _compute_full_number(main_num, s.get("size"), s.get("jersey_number"))
                ws.append([full, it.get("name"), s.get("size"), s.get("jersey_number"),
                           s.get("quantity"),
                           it.get("category"), it.get("main_group"), it.get("sub_group"),
                           it.get("price"), it.get("location"), type_str,
                           s.get("location", ""), main_num])
        else:
            ws.append([main_num, it.get("name"), "", "",
                       it.get("total_stock"),
                       it.get("category"), it.get("main_group"), it.get("sub_group"),
                       it.get("price"), it.get("location"), type_str, "", main_num])
    # Tving tekst-format på Varenummer-kolonnen (A) så bokstaver og innledende nuller bevares
    for row_cells in ws.iter_rows(min_row=2, min_col=1, max_col=1):
        for cell in row_cells:
            cell.number_format = "@"
    for i, w in enumerate([22, 26, 10, 10, 10, 14, 16, 18, 10, 14, 10, 18, 16], start=1):
        ws.column_dimensions[chr(64+i)].width = w
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
    full_numbers = await _lookup_full_numbers_for_loans(tid, loans)
    pdf_bytes = _build_team_equipment_pdf(team, loans, people, club, cust, user, club_name, full_numbers)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", team.get("team_name", "lag"))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="utstyr_{safe}.pdf"'})


# ==================== Email settings ====================

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
        "reply_to": (data.reply_to or "").strip(),
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
    res = await send_tenant_email(tid, to, "Test-epost fra Utstyrsrommet", html, sender_user=user)
    await db.tenant_email_settings.update_one({"tenant_id": tid}, {"$set": {
        "last_test_at": now_iso(),
        "last_test_ok": bool(res.get("ok")),
        "last_test_error": res.get("error") if not res.get("ok") else None,
        "verified_at": now_iso() if res.get("ok") and method != "default" else cfg.get("verified_at"),
    }}, upsert=True)
    if not res.get("ok"):
        raise HTTPException(502, f"Test-epost feilet: {res.get('error')}")
    return {"ok": True, "to": to, "method": res.get("method"), "provider_id": res.get("provider_id")}
