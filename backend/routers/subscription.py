"""
Router for signup, subscription, Stripe webhook og trial-påminnelser.

Inneholder:
- Cron: trial reminder e-poster + `/cron/trial-reminders`
- Trial admin (`/owner/customers/{id}/extend-trial`)
- Trial: velg pakke under prøveperiode (`/subscription/select-plan`)
- Signup (`/signup`)
- Abonnement: checkout, cancel, resume, seats/cancel, invoices, seats/checkout, status
- Stripe webhook (`/stripe/webhook`)

Lokale hjelpefunksjoner/klasser: _run_trial_reminders, SelectPlanIn.
Felles hjelpefunksjoner importeres via _shared.
"""
import asyncio
import secrets as pysecrets
from datetime import datetime, timezone, timedelta

import stripe
from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel

from ._shared import (
    api, db,
    require_tenant, require_admin, require_platform_owner,
    resolve_tenant_id,
    _clean, _cookie,
    _log_activity, now_iso, new_id,
    hash_password, create_access_token,
    send_trial_reminder_email, send_payment_receipt_email,
    _generate_customer_number, admin_perms,
    logger, PLANS,
    STRIPE_WEBHOOK_SECRET, WEBHOOK_CRON_SECRET,
    ExtendTrialIn, SignupIn, CheckoutIn, CancelIn, SeatCheckoutIn,
)


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
        "postal_code": (data.postal_code or "").strip(),
        "city": (data.city or "").strip(),
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

    YEARLY_FIRST_COUPONS = {
        "basic": "UTR_YEARLY_20_FIRST",
        "pro": "UTR_YEARLY_35_FIRST",
        "deluxe": "UTR_YEARLY_50_FIRST",
    }
    discounts = []
    if cycle == "yearly":
        coupon_id = YEARLY_FIRST_COUPONS.get(data.plan)
        if coupon_id:
            discounts = [{"coupon": coupon_id}]
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
        raise HTTPException(403, "Pakken støtter ikke kjøp av ekstra brukere. Oppgrader til Premium.")

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
