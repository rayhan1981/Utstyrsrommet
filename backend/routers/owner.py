"""
Router for plattformeier (Owner) – UTSTYRSROMMET

Inneholder:
- Kunde-søk, opprett, oppdater, patch, slett, restore
- Impersonering (start/stop)
- Velkomst-e-post til kundens admin-bruker
- Felt-overstyring (field-level override) for impersonert kunde
- Rå dokument-uthenting
- Hard delete av kunde + alle tenant-scopede dokumenter

Hjelpefunksjoner/klasser som kun brukes her: _assert_impersonating,
OWNER_OVERRIDE_COLLECTIONS, OWNER_OVERRIDE_FORBIDDEN_FIELDS,
OwnerFieldOverrideIn, OwnerHardDeleteIn.
Felles hjelpefunksjoner importeres via _shared.
"""
import re
import secrets as pysecrets
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

import stripe
import httpx
from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel

from ._shared import (
    api, db, require_platform_owner,
    now_iso, new_id, _clean, _cookie, hash_password,
    _generate_customer_number, admin_perms,
    FRONTEND_URL, EMAIL_FROM_NAME, EMAIL_KEY, EMAIL_BASE_URL,
    OwnerCreateCustomerIn, UpdatePlanIn, OwnerCustomerUpdateIn,
    logger, PLANS,
)


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


@api.post("/owner/customers", status_code=201)
async def owner_create_customer(data: OwnerCreateCustomerIn, user=Depends(require_platform_owner)):
    """Plattformeier oppretter kunde manuelt. Status settes 'active' direkte (ingen trial)."""
    email = data.owner_email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-post finnes allerede")
    if data.plan not in PLANS:
        raise HTTPException(400, "Ugyldig pakke")
    if data.billing_mode not in ("manual", "stripe"):
        raise HTTPException(400, "Ugyldig faktureringsvalg (manual|stripe)")

    # Passord: enten gitt eller auto-generert
    generated_password: Optional[str] = None
    if data.password and data.password.strip():
        if len(data.password.strip()) < 6:
            raise HTTPException(400, "Passord må være minst 6 tegn")
        password_plain = data.password.strip()
    else:
        password_plain = pysecrets.token_urlsafe(10)
        generated_password = password_plain

    customer_number = await _generate_customer_number()
    tenant_id = new_id()
    now = datetime.now(timezone.utc)

    stripe_customer_id = None
    if data.billing_mode == "stripe":
        try:
            s = stripe.Customer.create(
                email=email,
                name=data.club_name,
                phone=data.owner_phone or None,
                metadata={"customer_number": customer_number, "manually_created_by_owner": user.get("id") or ""},
            )
            stripe_customer_id = s.id
        except Exception as e:
            logger.error(f"Stripe customer create feilet: {e}")
            raise HTTPException(400, f"Kunne ikke opprette Stripe-kunde: {str(e)[:200]}")

    customer_doc = {
        "id": tenant_id,
        "customer_number": customer_number,
        "club_name": data.club_name,
        "owner_name": data.owner_name,
        "owner_email": email,
        "owner_phone": data.owner_phone or "",
        "postal_code": (data.postal_code or "").strip(),
        "city": (data.city or "").strip(),
        "plan": data.plan,
        "status": "active",
        "subscription_status": "manual" if data.billing_mode == "manual" else "active",
        "selected_plan": data.plan,
        "subscription_start_date": now.isoformat(),
        "trial_start_date": None,
        "trial_end_date": None,
        "trial_ends_at": None,
        "stripe_customer_id": stripe_customer_id,
        "stripe_subscription_id": None,
        "extra_user_seats": 0,
        "accept_terms": True,
        "terms_accepted_at": now_iso(),
        "created_by_owner": user.get("id"),
        "billing_mode": data.billing_mode,
        "created_at": now_iso(),
    }
    await db.customers.insert_one(customer_doc)

    user_id = new_id()
    await db.users.insert_one({
        "id": user_id,
        "email": email,
        "name": data.owner_name,
        "phone": data.owner_phone or "",
        "address": "",
        "role": "admin",
        "role_title": "",
        "permissions": admin_perms(),
        "active": True,
        "tenant_id": tenant_id,
        "is_super_admin": False,
        "password_hash": hash_password(password_plain),
        "created_at": now_iso(),
    })

    # Logg i activity_log for sporing
    await db.activity_log.insert_one({
        "id": new_id(),
        "tenant_id": tenant_id,
        "action": "owner_create_customer",
        "by_user_id": user.get("id"),
        "by_name": f"[Plattformeier] {user.get('name', '')}",
        "is_owner_action": True,
        "at": now_iso(),
        "meta": {
            "customer_number": customer_number,
            "club_name": data.club_name,
            "plan": data.plan,
            "billing_mode": data.billing_mode,
            "stripe_customer_id": stripe_customer_id,
        },
    })

    return {
        "customer": _clean(customer_doc),
        "user_id": user_id,
        "generated_password": generated_password,  # None hvis admin satte passord selv
    }


@api.post("/owner/customers/{customer_id}/send-welcome")
async def owner_send_welcome(customer_id: str, user=Depends(require_platform_owner)):
    """Send velkomst-e-post med Sett-passord-lenke til kundens admin-bruker."""
    cust = await db.customers.find_one({"id": customer_id})
    if not cust:
        raise HTTPException(404, "Kunde ikke funnet")
    if cust.get("is_owner_workspace"):
        raise HTTPException(400, "Kan ikke sende velkomst til plattformeiers arbeidsområde")

    admin_user = await db.users.find_one({"tenant_id": customer_id, "email": (cust.get("owner_email") or "").lower()})
    if not admin_user:
        # Fallback: første admin-bruker på tenant
        admin_user = await db.users.find_one({"tenant_id": customer_id, "role": "admin"})
    if not admin_user:
        raise HTTPException(404, "Fant ingen admin-bruker å sende velkomst til")

    inv_token = pysecrets.token_urlsafe(32)
    await db.invitations.insert_one({"token": inv_token, "user_id": admin_user["id"], "created_at": now_iso(), "used": False})

    link = f"{FRONTEND_URL}/sett-passord?token={inv_token}"
    login_link = f"{FRONTEND_URL}/innlogging"
    club_name = cust.get("club_name", "")
    customer_number = cust.get("customer_number", "")
    recipient_name = admin_user.get("name") or club_name

    html = (
        f'<table width="100%" style="background:#f8fafc;padding:24px;font-family:Arial,sans-serif">'
        f'<tr><td align="center"><table width="560" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">'
        f'<tr><td><h1 style="color:#991b1b;margin:0 0 16px 0">Velkommen til {EMAIL_FROM_NAME}!</h1>'
        f'<p>Hei {recipient_name},</p>'
        f'<p>Du har fått en klubbkonto hos <strong>{EMAIL_FROM_NAME}</strong> klar til bruk.</p>'
        f'<table width="100%" style="background:#f1f5f9;border-radius:6px;padding:16px;margin:16px 0">'
        f'<tr><td><p style="margin:4px 0"><strong>Klubb:</strong> {club_name}</p>'
        f'<p style="margin:4px 0"><strong>Kundenummer:</strong> {customer_number}</p>'
        f'<p style="margin:4px 0"><strong>E-post:</strong> {admin_user.get("email")}</p>'
        f'</td></tr></table>'
        f'<p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#991b1b;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">Sett passord og logg inn</a></p>'
        f'<p style="color:#475569;font-size:13px">Lenken er gyldig i 7 dager. Har du allerede passord? <a href="{login_link}" style="color:#991b1b">Logg inn her</a>.</p>'
        f'<p style="color:#94a3b8;font-size:12px;margin-top:24px">Sendt av {EMAIL_FROM_NAME}. Spørsmål? Svar på denne e-posten.</p>'
        f'</td></tr></table></td></tr></table>'
    )

    sent_id = None
    if EMAIL_KEY:
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                 headers={"X-Email-Key": EMAIL_KEY},
                                 json={"to": [admin_user["email"]], "subject": f"Velkommen til {EMAIL_FROM_NAME} – {club_name}", "html": html, "from_name": EMAIL_FROM_NAME})
            r.raise_for_status()
            sent_id = r.json().get("id")
        except Exception as e:
            logger.error(f"Welcome email feilet: {e}")
            raise HTTPException(502, f"Kunne ikke sende e-post: {str(e)[:200]}")

    await db.activity_log.insert_one({
        "id": new_id(),
        "tenant_id": customer_id,
        "action": "owner_send_welcome",
        "by_user_id": user.get("id"),
        "by_name": f"[Plattformeier] {user.get('name', '')}",
        "is_owner_action": True,
        "at": now_iso(),
        "meta": {"to": admin_user["email"], "email_id": sent_id},
    })

    return {"ok": True, "email_id": sent_id, "invitation_link": link, "sent_to": admin_user["email"]}


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
    if data.postal_code is not None:
        update["postal_code"] = (data.postal_code or "").strip()
    if data.city is not None:
        update["city"] = (data.city or "").strip()
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


# ---------------- Platform Owner: Field-Level Override (impersonering kreves) ----------------
# Allow-list of collections platform-eier kan overstyre felter i. Innenfor hver samling kan
# alle felter overstyres UNNTATT de i FORBIDDEN_FIELDS (sikkerhet) OG tenant_id-feltet
# (ville kunne lekke dokumentet til feil klubb).
OWNER_OVERRIDE_COLLECTIONS = {
    "customers",
    "users", "people", "items", "loans", "teams",
    "orders", "invoices", "needs_requests", "varemottak",
    "suppliers", "clubs", "team_portal_accounts",
    "stock_counts", "notifications", "activity_log",
}
OWNER_OVERRIDE_FORBIDDEN_FIELDS = {"_id", "password_hash", "tenant_id"}


class OwnerFieldOverrideIn(BaseModel):
    collection: str
    document_id: str
    field: str
    # Verdi kan være null, string, number, bool. Nøstede objekter støttes IKKE for sikkerhets skyld.
    value: Any = None


class OwnerHardDeleteIn(BaseModel):
    confirm_name: str


async def _assert_impersonating(request: Request, user: dict) -> str:
    """Krever at platform-eier impersonerer en kunde. Returnerer den impersonerte tenant_id-en."""
    if user.get("role") != "platform_owner":
        raise HTTPException(403, "Kun plattformeier")
    imp = request.cookies.get("imp_cid")
    if not imp:
        raise HTTPException(400, "Felt-overstyring krever at du har 'logget inn som' en kunde først.")
    cust = await db.customers.find_one({"id": imp}, {"_id": 0, "id": 1, "is_owner_workspace": 1})
    if not cust:
        raise HTTPException(404, "Impersonert kunde finnes ikke")
    return imp


@api.post("/owner/field-override")
async def owner_field_override(data: OwnerFieldOverrideIn, request: Request, user=Depends(require_platform_owner)):
    """Universell felt-editor: lar plattformeier overstyre ethvert felt på ethvert dokument
    i den impersonerte kundens tenant. KAN KUN brukes mens impersonering er aktiv.
    Alle endringer logges i activity_log for sporing."""
    tid = await _assert_impersonating(request, user)
    coll = data.collection.strip().lower()
    if coll not in OWNER_OVERRIDE_COLLECTIONS:
        raise HTTPException(400, f"Samlingen '{coll}' er ikke tillatt for overstyring.")
    field = (data.field or "").strip()
    if not field:
        raise HTTPException(400, "Felt må være satt")
    if field in OWNER_OVERRIDE_FORBIDDEN_FIELDS or field.startswith("$") or field.startswith("_"):
        raise HTTPException(400, f"Feltet '{field}' kan ikke overstyres (reservert).")
    # Finn eksisterende dokument. For 'customers'-samlingen er document_id == tenant_id.
    if coll == "customers":
        if data.document_id != tid:
            raise HTTPException(403, "Du kan kun endre den impersonerte kundens egen record.")
        existing = await db.customers.find_one({"id": data.document_id}, {"_id": 0})
        if not existing:
            raise HTTPException(404, "Kunden finnes ikke")
        if existing.get("is_owner_workspace"):
            raise HTTPException(400, "Kan ikke overstyre felter på plattformeiers eget arbeidsområde.")
    else:
        existing = await db[coll].find_one({"id": data.document_id, "tenant_id": tid}, {"_id": 0})
        if not existing:
            raise HTTPException(404, f"Dokument finnes ikke i den impersonerte kundens '{coll}'.")
    old_val = existing.get(field)
    # Spesialbehandling: tomme strenger → None for datoer, dette unngår feil fra ISO-parsing videre
    new_val = data.value
    if isinstance(new_val, str) and new_val.strip() == "":
        new_val = None
    # Oppdater
    match = {"id": data.document_id} if coll == "customers" else {"id": data.document_id, "tenant_id": tid}
    if new_val is None:
        await db[coll].update_one(match, {"$unset": {field: ""}})
    else:
        await db[coll].update_one(match, {"$set": {field: new_val}})
    # Logg (plattformeier-handling – alltid i audit-sporet, bypasser owner-skip i _log_activity)
    try:
        await db.activity_log.insert_one({
            "id": new_id(), "tenant_id": tid, "at": now_iso(),
            "action": "owner_field_override",
            "description": f"Overstyrte felt '{field}' i {coll}/{data.document_id}",
            "by": user.get("email"), "by_user_id": user.get("id"),
            "by_name": f"[Plattformeier] {user.get('name') or ''}".strip(),
            "is_owner_action": True,
            "meta": {"collection": coll, "document_id": data.document_id, "field": field,
                     "old_value": old_val, "new_value": new_val},
        })
    except Exception as e:
        logger.warning(f"activity_log owner-override feilet: {e}")
    updated = await db[coll].find_one(match, {"_id": 0, "password_hash": 0})
    return {"ok": True, "document": updated, "field": field, "old_value": old_val, "new_value": new_val}


@api.get("/owner/raw/{collection}/{document_id}")
async def owner_raw_doc(collection: str, document_id: str, request: Request, user=Depends(require_platform_owner)):
    """Henter rått dokument fra impersonert kundes tenant. Brukes av Avansert-fanen for å
    vise ALLE felter (også de som normalt er skjult i UI)."""
    tid = await _assert_impersonating(request, user)
    coll = collection.strip().lower()
    if coll not in OWNER_OVERRIDE_COLLECTIONS:
        raise HTTPException(400, f"Samlingen '{coll}' er ikke tillatt.")
    if coll == "customers":
        if document_id != tid:
            raise HTTPException(403, "Du kan kun lese den impersonerte kundens egen record.")
        doc = await db.customers.find_one({"id": document_id}, {"_id": 0})
    else:
        doc = await db[coll].find_one({"id": document_id, "tenant_id": tid}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(404, "Dokument finnes ikke")
    return doc


@api.delete("/owner/customers/{customer_id}/hard-delete")
async def owner_hard_delete_customer(customer_id: str, data: OwnerHardDeleteIn, user=Depends(require_platform_owner)):
    """IRREVERSIBEL sletting av kunde + alle tenant-scopede dokumenter.
    Krever at `confirm_name` matcher kundens club_name eksakt.
    Blokkeres på plattformeiers eget arbeidsområde."""
    cust = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not cust:
        raise HTTPException(404, "Kunde finnes ikke")
    if cust.get("is_owner_workspace"):
        raise HTTPException(400, "Kan ikke permanent-slette plattformeiers eget arbeidsområde.")
    expected = (cust.get("club_name") or "").strip()
    if (data.confirm_name or "").strip() != expected:
        raise HTTPException(400, f"Bekreftelsesnavn stemmer ikke. Skriv eksakt: '{expected}'.")
    # Samle alle collections å slette i. Alt som har tenant_id-indeks i startup pluss et par til.
    tenant_scoped_collections = [
        "users", "teams", "people", "items", "loans", "clubs", "stock_counts",
        "orders", "invoices", "needs_requests", "varemottak", "suppliers",
        "team_portal_accounts", "notifications", "activity_log", "invitations",
        "login_history", "subscription_events", "stock_count_lines",
    ]
    report: Dict[str, int] = {}
    for coll in tenant_scoped_collections:
        try:
            res = await db[coll].delete_many({"tenant_id": customer_id})
            if res.deleted_count:
                report[coll] = res.deleted_count
        except Exception:
            logger.exception(f"Hard delete {coll} feilet for tenant {customer_id}")
    # Til slutt kundens egen record
    await db.customers.delete_one({"id": customer_id})
    report["customers"] = 1
    # Audit log entry (klubbens egen logg) – plattformeier handling
    try:
        await db.activity_log.insert_one({
            "id": new_id(), "tenant_id": customer_id, "at": now_iso(),
            "action": "hard_delete_customer",
            "description": f"PERMANENT slettet kunde «{expected}» ({cust.get('customer_number')}) – {sum(report.values())} dokumenter",
            "by": user.get("email"), "by_user_id": user.get("id"),
            "by_name": f"[Plattformeier] {user.get('name') or ''}".strip(),
            "is_owner_action": True,
            "meta": {"deleted": report, "club_name": expected, "customer_number": cust.get("customer_number")},
        })
    except Exception:
        pass  # Vi har allerede slettet, loggsvikt skal ikke føre til API-feil
    logger.warning(f"HARD DELETE av kunde {customer_id} ({expected}) av {user.get('email')}: {report}")
    return {"ok": True, "club_name": expected, "deleted": report}
