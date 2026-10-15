"""
Router for varetelling (Stock Audit) – UTSTYRSROMMET

Inneholder:
- Varetelling CRUD (list, start, update/delete/add line, delete count)
- Anvend varetelling (apply)
- Eksport/import av telledokument (Excel)
- Manuell beholdningsjustering med årsak
- Liste over beholdningsjusteringer

Felles hjelpefunksjoner importeres via _shared.
"""
import io
import re
from datetime import datetime

from fastapi import Depends, HTTPException, Request, UploadFile, File
from openpyxl import Workbook, load_workbook

from ._shared import (
    api, db, require_tenant, require_perm, require_feature,
    _log_activity, now_iso, new_id, _clean, _xlsx_response,
    StockCountIn, StockCountLineIn, StockManualAdjustIn,
)


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
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "apply_stock_count",
                             f"Anvendte varetelling «{sc.get('name')}»",
                             {"count_id": count_id})
    return {"ok": True}


@api.get("/stock-counts/{count_id}/export")
async def export_stock_count(count_id: str, request: Request, user=Depends(require_perm("stock_audit", "read"))):
    """Eksporter varetelling som Excel-telledokument. Åpen varetelling → tomt talt-felt.
    Anvendt varetelling → ferdig utfylt. Inkluderer system-tall og lokasjon."""
    tid = await require_feature(request, user, "stock_audit")
    sc = await db.stock_counts.find_one({"id": count_id, "tenant_id": tid}, {"_id": 0})
    if not sc:
        raise HTTPException(404, "Varetelling ikke funnet")
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook(); ws = wb.active; ws.title = "Telledokument"
    ws["A1"] = "UTSTYRSROMMET – Telledokument"
    ws["A1"].font = Font(bold=True, size=14, color="7F1D1D")
    ws["A2"] = f"Varetelling: {sc.get('name') or ''}"
    ws["A3"] = f"Opprettet: {sc.get('created_at','')[:10]} · Status: {sc.get('status','')}"
    ws["A4"] = "Fyll ut «Talt antall» og importer tilbake."
    ws["A4"].font = Font(italic=True, size=10, color="555555")
    headers = ["Linje-ID", "Varenummer", "Varenavn", "Størrelse", "Draktnr", "Lokasjon", "System", "Talt antall", "Diff", "Notat"]
    for ci, h in enumerate(headers, start=1):
        c = ws.cell(row=6, column=ci, value=h)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill(start_color="7F1D1D", end_color="7F1D1D", fill_type="solid")
        c.alignment = Alignment(horizontal="center")
    for ri, ln in enumerate(sc.get("lines", []), start=7):
        ws.cell(row=ri, column=1, value=ln.get("line_id"))
        ws.cell(row=ri, column=2, value=ln.get("full_number") or ln.get("item_number") or "")
        ws.cell(row=ri, column=3, value=ln.get("item_name") or "")
        ws.cell(row=ri, column=4, value=ln.get("size") or "")
        ws.cell(row=ri, column=5, value=ln.get("jersey_number") or "")
        ws.cell(row=ri, column=6, value=ln.get("location") or "")
        ws.cell(row=ri, column=7, value=int(ln.get("system_quantity") or 0))
        ws.cell(row=ri, column=8, value=ln.get("counted_quantity"))
        diff = (ln.get("counted_quantity") - (ln.get("system_quantity") or 0)) if ln.get("counted_quantity") is not None else None
        ws.cell(row=ri, column=9, value=diff)
    # Varenummer-kolonnen (B) må være tekst
    for row_cells in ws.iter_rows(min_row=7, min_col=2, max_col=2):
        for cell in row_cells:
            cell.number_format = "@"
    widths = [36, 20, 32, 12, 10, 20, 10, 12, 10, 24]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64+i)].width = w
    ws.column_dimensions["A"].hidden = True  # Linje-ID vises skjult; brukes ved import
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", sc.get("name") or "varetelling")
    return _xlsx_response(wb, f"telledokument_{safe}.xlsx")


@api.post("/stock-counts/{count_id}/import")
async def import_stock_count(count_id: str, file: UploadFile = File(...),
                              request: Request = None, user=Depends(require_perm("stock_audit", "write"))):
    """Importer utfylt telledokument. Oppdaterer counted_quantity for linjer basert på line_id."""
    tid = await require_feature(request, user, "stock_audit")
    sc = await db.stock_counts.find_one({"id": count_id, "tenant_id": tid})
    if not sc:
        raise HTTPException(404, "Varetelling ikke funnet")
    if sc.get("status") == "applied":
        raise HTTPException(409, "Varetellingen er allerede anvendt – kan ikke importere på nytt.")
    content = await file.read()
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(400, "Kunne ikke lese Excel-fil")
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 7:
        raise HTTPException(400, "Fil mangler data – fylte linjer starter på rad 7")
    # Build line-id lookup
    by_id = {ln.get("line_id"): ln for ln in sc.get("lines", [])}
    updated = 0; errors = []
    for ri, row in enumerate(rows[6:], start=7):
        if not row or not row[0]:
            continue
        line_id = str(row[0]).strip()
        ln = by_id.get(line_id)
        if not ln:
            errors.append({"row": ri, "error": f"Linje-ID {line_id} finnes ikke i tellingen"})
            continue
        counted = row[7] if len(row) > 7 else None
        if counted is None or str(counted).strip() == "":
            continue
        try:
            cq = int(counted)
        except Exception:
            errors.append({"row": ri, "error": f"Ugyldig talt antall «{counted}»"})
            continue
        if cq < 0:
            errors.append({"row": ri, "error": "Talt antall må være 0 eller mer"})
            continue
        ln["counted_quantity"] = cq
        ln["diff"] = cq - int(ln.get("system_quantity") or 0)
        ln["counted_at"] = now_iso()
        updated += 1
    await db.stock_counts.update_one({"id": count_id, "tenant_id": tid}, {"$set": {"lines": sc["lines"]}})
    return {"ok": True, "updated": updated, "errors": errors}


@api.post("/stock/manual-adjust")
async def stock_manual_adjust(data: StockManualAdjustIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    """Manuell justering av beholdning med påkrevd årsak. Logges i audit_log og stock_adjustments."""
    tid = await require_tenant(request, user)
    reason = (data.reason or "").strip()
    if not reason or len(reason) < 3:
        raise HTTPException(400, "Begrunnelse er påkrevd (minst 3 tegn)")
    if int(data.new_quantity) < 0:
        raise HTTPException(400, "Nytt antall må være 0 eller mer")
    item = await db.items.find_one({"id": data.item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    is_variant_item = bool(item.get("is_clothing") or item.get("is_ball"))
    if is_variant_item and not data.size:
        raise HTTPException(400, "Størrelse er påkrevd for klær/ball – velg hvilken variant som skal justeres")
    before = 0
    if is_variant_item and data.size:
        sizes = item.get("sizes", []); updated = False
        for s in sizes:
            if s.get("size") == data.size:
                before = int(s.get("quantity") or 0)
                s["quantity"] = int(data.new_quantity); updated = True
        if not updated:
            raise HTTPException(404, f"Variant {data.size} finnes ikke")
        total = sum(int(s.get("quantity") or 0) for s in sizes)
        await db.items.update_one({"id": item["id"], "tenant_id": tid},
                                   {"$set": {"sizes": sizes, "total_stock": total}})
    else:
        before = int(item.get("total_stock") or 0)
        await db.items.update_one({"id": item["id"], "tenant_id": tid},
                                   {"$set": {"total_stock": int(data.new_quantity)}})
    # Record audit log
    adjustment_id = new_id()
    await db.stock_adjustments.insert_one({
        "id": adjustment_id, "tenant_id": tid,
        "item_id": data.item_id, "item_name": item.get("name"),
        "size": data.size, "before": before, "after": int(data.new_quantity),
        "diff": int(data.new_quantity) - before, "reason": reason,
        "user_email": user.get("email"), "user_name": user.get("name"),
        "created_at": now_iso(),
    })
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "stock_manual_adjust",
                             f"Justerte {item.get('name')}{(' (' + data.size + ')') if data.size else ''}: {before} → {data.new_quantity} ({reason[:40]})",
                             {"item_id": data.item_id, "before": before, "after": int(data.new_quantity)})
    return {"ok": True, "adjustment_id": adjustment_id, "before": before, "after": int(data.new_quantity)}


@api.get("/stock/adjustments")
async def list_stock_adjustments(request: Request, user=Depends(require_perm("inventory", "read")), limit: int = 100):
    tid = await require_tenant(request, user)
    return await db.stock_adjustments.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 500))
