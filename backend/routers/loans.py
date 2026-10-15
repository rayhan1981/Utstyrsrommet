"""
Router for utlån, retur, fakturaer og varsler.

Inneholder:
- Lån: opprett, returner (full/delvis), angre retur, forleng frist
- Varsler: overtid-utlån, avvis
- Fakturaer: list, opprett (med PDF), last ned PDF, send per e-post
"""
import io
import base64
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

from fastapi import Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ._shared import (
    api, db, require_tenant, require_perm,
    get_current_user, resolve_tenant_id,
    _log_activity, now_iso, new_id, _clean,
    _adjust_stock, _send_email_with_attachment,
    LoanIn, ReturnIn, ExtendDueDateIn,
    InvoiceIn, InvoiceLineIn, InvoiceSendIn,
    logger,
)


# ---------------- Loans ----------------
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
        "due_date": (data.due_date if data.due_date else (datetime.now(timezone.utc) + timedelta(days=int(data.due_in_days))).isoformat()),
        "overdue_dismissed_at": None,
        "return_date": None, "received_by_person_id": None, "notes": data.notes,
    }
    await db.loans.insert_one(loan_doc)
    await _adjust_stock(tid, data.item_id, -data.quantity, data.size)

    if charge > 0:
        target = loan_doc["loan_target"]
        if target == "team" and data.team_id:
            await db.teams.update_one({"id": data.team_id, "tenant_id": tid}, {"$inc": {"debt": charge}})
        elif target == "person" and data.person_id:
            await db.people.update_one({"id": data.person_id, "tenant_id": tid}, {"$inc": {"debt": charge}})
    if user.get("role") != "platform_owner":
        verb = "Utlevert" if data.mode == "handout" else "Utlånt"
        await _log_activity(tid, user, "create_loan",
                             f"{verb} {data.quantity}× {item.get('name')}" + (f" ({data.size})" if data.size else ""),
                             {"loan_id": loan_doc["id"], "item_id": data.item_id, "team_id": data.team_id, "person_id": data.person_id})
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
            "returned_qty": qty, "returned_amount": owed_reduce,
            "source_loan_id": None, "from_split": False,
        }})
        if user.get("role") != "platform_owner":
            await _log_activity(tid, user, "return_loan", f"Returnerte {qty}× {loan.get('item_name')}", {"loan_id": loan_id, "qty": qty})
        return {"ok": True, "status": "returned", "amount_owed": 0}
    else:
        remaining = loan["quantity"] - qty
        new_owed = loan.get("amount_owed", 0) - owed_reduce
        await db.loans.update_one({"id": loan_id, "tenant_id": tid}, {"$set": {
            "quantity": remaining, "amount_owed": new_owed,
        }})
        returned_doc = {**loan}
        returned_doc.pop("_id", None)
        new_ret_id = new_id()
        returned_doc.update({"id": new_ret_id, "quantity": qty, "status": "returned",
                             "return_date": now_iso(),
                             "received_by_person_id": data.received_by_person_id, "amount_owed": 0,
                             "returned_qty": qty, "returned_amount": owed_reduce,
                             "source_loan_id": loan_id, "from_split": True})
        await db.loans.insert_one(returned_doc)
        if user.get("role") != "platform_owner":
            await _log_activity(tid, user, "return_loan", f"Delvis retur {qty}× {loan.get('item_name')}", {"loan_id": loan_id, "qty": qty})
        return {"ok": True, "status": "partial", "amount_owed": new_owed, "returned_loan_id": new_ret_id}


class UndoReturnIn(BaseModel):
    reason: str


@api.post("/loans/{loan_id}/undo-return")
async def undo_return(loan_id: str, data: UndoReturnIn, request: Request, user=Depends(require_perm("loans", "write"))):
    tid = await require_tenant(request, user)
    loan = await db.loans.find_one({"id": loan_id, "tenant_id": tid})
    if not loan:
        raise HTTPException(404, "Retur ikke funnet")
    if loan.get("status") != "returned":
        raise HTTPException(400, "Dette utlånet er ikke registrert som returnert")
    if loan.get("undo_return_reversed_at"):
        raise HTTPException(409, "Denne returen er allerede reversert")
    if not (data.reason or "").strip():
        raise HTTPException(400, "Begrunnelse må oppgis")
    qty = int(loan.get("returned_qty") or loan.get("quantity") or 0)
    amt = float(loan.get("returned_amount") or loan.get("unit_price", 0) * qty or 0)
    item = await db.items.find_one({"id": loan["item_id"], "tenant_id": tid})
    if not item:
        raise HTTPException(409, "Varen finnes ikke lenger – kan ikke reversere på lager")
    if loan.get("size") and (item.get("is_clothing") or item.get("is_ball")):
        avail = next((s.get("quantity", 0) for s in item.get("sizes", []) if s["size"] == loan["size"]), 0)
        if qty > avail:
            raise HTTPException(409, f"Lagerkonflikt: størrelse {loan['size']} har kun {avail} på lager, kan ikke reversere {qty}. Juster lager eller returner varer først.")
    else:
        if qty > item.get("total_stock", 0):
            raise HTTPException(409, f"Lagerkonflikt: kun {item.get('total_stock',0)} på lager, kan ikke reversere {qty}.")
    await _adjust_stock(tid, loan["item_id"], -qty, loan.get("size"))
    if amt > 0:
        target = loan.get("loan_target") or ("team" if loan.get("team_id") else "person" if loan.get("person_id") else None)
        if target == "team" and loan.get("team_id"):
            await db.teams.update_one({"id": loan["team_id"], "tenant_id": tid}, {"$inc": {"debt": amt}})
        elif target == "person" and loan.get("person_id"):
            await db.people.update_one({"id": loan["person_id"], "tenant_id": tid}, {"$inc": {"debt": amt}})
    if loan.get("from_split") and loan.get("source_loan_id"):
        source = await db.loans.find_one({"id": loan["source_loan_id"], "tenant_id": tid})
        if source:
            await db.loans.update_one({"id": source["id"], "tenant_id": tid}, {"$set": {
                "quantity": source["quantity"] + qty,
                "amount_owed": source.get("amount_owed", 0) + amt,
            }})
        await db.loans.delete_one({"id": loan_id, "tenant_id": tid})
    else:
        await db.loans.update_one({"id": loan_id, "tenant_id": tid}, {"$set": {
            "status": "borrowed", "return_date": None, "received_by_person_id": None,
            "amount_owed": amt, "undo_return_reversed_at": now_iso(),
            "undo_return_by": user.get("email"), "undo_return_reason": data.reason.strip(),
        }})
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "undo_return", f"Reverserte retur av {qty}× {loan.get('item_name')}",
                             {"loan_id": loan_id, "qty": qty, "reason": data.reason.strip()})
    return {"ok": True, "restored_quantity": qty, "restored_amount": amt}


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


# ---------------- Notifications ----------------
@api.get("/notifications")
async def list_notifications(request: Request, user=Depends(get_current_user)):
    tid = await resolve_tenant_id(request, user)
    if not tid:
        return {"overdue": [], "unseen_count": 0}
    now_dt = datetime.now(timezone.utc).isoformat()
    overdue = await db.loans.find({
        "tenant_id": tid, "status": "borrowed", "due_date": {"$lt": now_dt},
    }, {"_id": 0}).sort("due_date", 1).to_list(500)
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

    y -= 15 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Til:")
    c.setFont("Helvetica", 10)
    y -= 5 * mm
    c.drawString(20 * mm, y, recipient.get("name", ""))
    if recipient.get("email"):
        y -= 4 * mm
        c.drawString(20 * mm, y, recipient["email"])

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
    pdf_b64 = inv["pdf_data"]
    try:
        await _send_email_with_attachment(
            to_email,
            f"Faktura {inv['invoice_number']} - NOK {inv['total']:.2f}",
            f"Hei {inv.get('recipient_name', '')},\n\nVedlagt følger faktura nr {inv['invoice_number']} på NOK {inv['total']:.2f}.\nForfall: {datetime.fromisoformat(inv['due_date']).strftime('%d.%m.%Y')}\nKID: {inv.get('kid', '')}\n\nMvh,\nUTSTYRSROMMET",
            f"faktura-{inv['invoice_number']}.pdf", pdf_b64,
            sender_user=user,
        )
    except Exception as e:
        logger.error(f"Faktura-sending feilet: {e}")
        raise HTTPException(500, f"Kunne ikke sende faktura: {e}")
    await db.invoices.update_one({"id": invoice_id, "tenant_id": tid}, {"$set": {"sent_at": now_iso(), "status": "sent"}})
    return {"ok": True}
