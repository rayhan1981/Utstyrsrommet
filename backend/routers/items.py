"""
Router for varer (Items) – UTSTYRSROMMET

Inneholder:
- Vare CRUD (list, create, get, update, delete)
- QR-kode generering/sletting/bulk/visning
- Varevariant-sletting
- Taksonomi-endepunkt
- Excel import/preview/template
- Åpne bestillinger per vare

Hjelpefunksjoner som kun brukes her: _normalize_size_for_number,
_normalize_jersey_for_number, _validate_full_number_uniqueness,
_build_qr_png_b64, _parse_import_rows.
Felles hjelpefunksjoner importeres via _shared.
"""
import io
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openpyxl import Workbook, load_workbook

from ._shared import (
    api, db, require_tenant, require_perm, require_feature,
    get_tenant_plan, _log_activity, now_iso, new_id, _clean,
    _compute_full_number, _prep_item_doc, ItemIn, GenerateQrIn,
    _load_club_logo, _xlsx_response, logger,
)


# -------- Hovedvarenummer og full_number-helpere --------
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


async def _validate_full_number_uniqueness(tid: str, doc: dict, exclude_id: Optional[str] = None):
    collected = []
    if doc.get("is_clothing") or doc.get("is_ball"):
        for s in doc.get("sizes", []):
            fn = s.get("full_number")
            if fn:
                collected.append(fn)
    else:
        fn = doc.get("full_number")
        if fn:
            collected.append(fn)
    seen = set()
    for fn in collected:
        if fn in seen:
            raise HTTPException(400, f"Duplikat varenummer «{fn}» innenfor samme vare – rediger størrelse eller draktnummer")
        seen.add(fn)
    for fn in seen:
        q = {"tenant_id": tid, "$or": [{"full_number": fn}, {"sizes.full_number": fn}]}
        if exclude_id:
            q["id"] = {"$ne": exclude_id}
        other = await db.items.find_one(q, {"id": 1, "name": 1, "main_item_number": 1})
        if other:
            raise HTTPException(400, f"Varenummer «{fn}» finnes allerede på vare «{other.get('name')}» (hovedvarenummer «{other.get('main_item_number','')}»)")


def _build_qr_png_b64(payload: str, logo_img=None) -> str:
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


class DeleteVariantIn(BaseModel):
    size: str
    jersey_number: Optional[str] = None


BALL_SIZES = ["00 Mykball", "Street håndball", "00", "0", "1", "2", "3"]
IMPORT_COLUMNS = ["Hovedvarenummer", "Varenavn", "Kategori", "Hovedgruppe", "Undergruppe", "Pris", "Lokasjon", "Type", "Størrelse", "Draktnr", "Antall", "Lokasjon pr str", "Leverandørnr"]
IMPORT_COLUMNS_LEGACY = ["Varenavn", "Kategori", "Hovedgruppe", "Undergruppe", "Pris", "Lokasjon", "Type", "Størrelse", "Draktnr", "Antall", "Lokasjon pr str", "Leverandørnr"]
VALID_TYPES = {"vare", "klær", "klar", "clothing", "ball", "baller"}


DEFAULT_TAXONOMY_SEEDS = [
    {"name": "Klær", "main_groups": [
        {"name": "Spillertrøye", "sub_groups": ["Hjemmedrakter", "Bortedrakter", "Tredjedrakt"]},
        {"name": "Trening", "sub_groups": ["Overdel", "Shorts", "Treningsjakke"]},
        {"name": "Målvakt", "sub_groups": ["Drakt", "Hansker"]},
    ]},
    {"name": "Baller", "main_groups": [
        {"name": "Trening", "sub_groups": ["Håndball", "Fotball"]},
        {"name": "Kamp", "sub_groups": ["Håndball", "Fotball"]},
    ]},
    {"name": "Utstyr", "main_groups": [
        {"name": "Trening", "sub_groups": ["Markering", "Kjegler", "Vester"]},
        {"name": "Førstehjelp", "sub_groups": ["Førstehjelpsskrin", "Tape"]},
    ]},
]


async def _parse_import_rows(tid: str, content: bytes):
    """Felles parser for /items/import og /items/import/preview."""
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(400, "Kunne ikke lese Excel-fil – må være .xlsx")
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "Tom fil")
    header = [str(h or "").strip().lower() for h in rows[0]]
    legacy_mode = False
    if header and header[0] == "varenavn":
        legacy_mode = True
        expected = [h.lower() for h in IMPORT_COLUMNS_LEGACY]
        if len(header) < 10 or header[:10] != expected[:10]:
            raise HTTPException(400, f"Feil kolonner (legacy-mal). Første 10 må være: {', '.join(IMPORT_COLUMNS_LEGACY[:10])}")
    else:
        expected = [h.lower() for h in IMPORT_COLUMNS]
        if len(header) < 11 or header[:11] != expected[:11]:
            raise HTTPException(400, f"Feil kolonner. Første 11 må være: {', '.join(IMPORT_COLUMNS[:11])}. Last ned ny mal via «Importmal».")

    suppliers = {s.get("supplier_number"): s for s in await db.suppliers.find({"tenant_id": tid}, {"_id": 0}).to_list(1000)}
    existing_items = await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(2000)
    existing_by_main = {str(i.get("main_item_number") or "").strip().lower(): i for i in existing_items if i.get("main_item_number")}
    existing_by_name = {(i.get("name", "").strip().lower()): i for i in existing_items}

    grouped: Dict[str, Dict[str, Any]] = {}
    errors: List[Dict[str, Any]] = []
    for idx, row in enumerate(rows[1:], start=2):
        if row is None or all(v is None or (isinstance(v, str) and not v.strip()) for v in row):
            continue
        row = list(row) + [None] * max(0, len(IMPORT_COLUMNS) - len(row))
        if legacy_mode:
            main_num = ""
            name = (str(row[0]) if row[0] is not None else "").strip()
            cat = (str(row[1]) if row[1] else "").strip()
            mg = (str(row[2]) if row[2] else "").strip()
            sg = (str(row[3]) if row[3] else "").strip()
            price_cell = row[4]; loc_cell = row[5]; type_cell = row[6]
            size_cell = row[7]; jersey_cell = row[8]; qty_cell = row[9]
            size_loc_cell = row[10] if len(row) > 10 else None
            sup_cell = row[11] if len(row) > 11 else None
        else:
            main_num = (str(row[0]) if row[0] is not None else "").strip()
            name = (str(row[1]) if row[1] is not None else "").strip()
            cat = (str(row[2]) if row[2] else "").strip()
            mg = (str(row[3]) if row[3] else "").strip()
            sg = (str(row[4]) if row[4] else "").strip()
            price_cell = row[5]; loc_cell = row[6]; type_cell = row[7]
            size_cell = row[8]; jersey_cell = row[9]; qty_cell = row[10]
            size_loc_cell = row[11] if len(row) > 11 else None
            sup_cell = row[12] if len(row) > 12 else None
        if not name:
            errors.append({"row": idx, "field": "Varenavn", "error": "Varenavn er påkrevd"}); continue
        if not cat:
            errors.append({"row": idx, "field": "Kategori", "error": "Kategori er påkrevd"}); continue
        try:
            price = float(price_cell) if price_cell not in (None, "") else 0.0
        except Exception:
            errors.append({"row": idx, "field": "Pris", "error": f"Ugyldig pris «{price_cell}»"}); continue
        if price < 0:
            errors.append({"row": idx, "field": "Pris", "error": "Pris må være 0 eller mer"}); continue
        loc = (str(loc_cell) if loc_cell else "").strip()
        type_raw = (str(type_cell) if type_cell else "").strip().lower()
        if type_raw not in VALID_TYPES:
            errors.append({"row": idx, "field": "Type", "error": f"Type må være 'vare', 'klær' eller 'ball' (fikk «{type_raw}»)"}); continue
        is_cloth = type_raw in ("klær", "klar", "clothing")
        is_ball = type_raw in ("ball", "baller")
        size = (str(size_cell) if size_cell else "").strip()
        jersey = (str(jersey_cell) if jersey_cell else "").strip() or "X"
        try:
            qty = int(qty_cell) if qty_cell not in (None, "") else 0
        except Exception:
            errors.append({"row": idx, "field": "Antall", "error": f"Ugyldig antall «{qty_cell}»"}); continue
        if qty < 0:
            errors.append({"row": idx, "field": "Antall", "error": "Antall må være 0 eller mer"}); continue
        size_loc = (str(size_loc_cell) if size_loc_cell else "").strip()
        sup_num = (str(sup_cell) if sup_cell else "").strip()
        if (is_cloth or is_ball) and not size:
            errors.append({"row": idx, "field": "Størrelse", "error": "Størrelse er påkrevd for klær og ball"}); continue
        if is_ball and size and size not in BALL_SIZES:
            errors.append({"row": idx, "field": "Størrelse", "error": f"Ugyldig ballstørrelse «{size}». Gyldige: {', '.join(BALL_SIZES[:5])}…"}); continue
        supplier_match = None
        if sup_num:
            supplier_match = suppliers.get(sup_num)
            if not supplier_match:
                errors.append({"row": idx, "field": "Leverandørnr", "error": f"Leverandørnr «{sup_num}» finnes ikke – opprett leverandøren først"}); continue

        if main_num:
            k = main_num.lower()
            existing = existing_by_main.get(k)
        else:
            k = f"{name.lower()}||{cat.lower()}||{mg.lower()}||{sg.lower()}"
            existing = existing_by_name.get(name.lower())
        if k not in grouped:
            doc = {"id": new_id(), "tenant_id": tid, "name": name,
                   "main_item_number": main_num, "category": cat, "main_group": mg,
                   "sub_group": sg, "price": price, "location": loc, "is_clothing": is_cloth,
                   "is_ball": is_ball, "sizes": [], "total_stock": 0,
                   "_will_update": existing is not None,
                   "_existing_id": existing.get("id") if existing else None,
                   "created_at": now_iso()}
            if supplier_match:
                doc["supplier_id"] = supplier_match["id"]
                doc["supplier_number"] = supplier_match.get("supplier_number")
                doc["supplier_name"] = supplier_match.get("name")
            grouped[k] = doc
        doc = grouped[k]
        if is_cloth or is_ball:
            doc["is_clothing"] = is_cloth or doc.get("is_clothing", False)
            doc["is_ball"] = is_ball or doc.get("is_ball", False)
            jk = "" if is_ball else jersey
            existing_variant = next((s for s in doc["sizes"] if s.get("size") == size and str(s.get("jersey_number") or "") == str(jk)), None)
            if existing_variant:
                existing_variant["quantity"] = int(existing_variant.get("quantity") or 0) + qty
            else:
                doc["sizes"].append({"size": size, "jersey_number": jk,
                                     "quantity": qty, "location": size_loc})
        else:
            doc["total_stock"] = (doc.get("total_stock") or 0) + qty
    for d in grouped.values():
        if d.get("is_clothing") or d.get("is_ball"):
            d["total_stock"] = sum(s.get("quantity", 0) for s in d["sizes"])
    return grouped, errors


# ---------------- Items routes ----------------
@api.get("/items")
async def list_items(request: Request, user=Depends(require_perm("inventory", "read"))):
    tid = await require_tenant(request, user)
    return await db.items.find({"tenant_id": tid}, {"_id": 0}).to_list(5000)


@api.post("/items")
async def create_item(data: ItemIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_tenant(request, user)
    doc = _prep_item_doc(data.dict())
    if not doc.get("main_item_number"):
        raise HTTPException(400, "Hovedvarenummer er påkrevd")
    await _validate_full_number_uniqueness(tid, doc)
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


@api.post("/items/qr-reset-all")
async def reset_all_qr(request: Request, user=Depends(require_perm("inventory", "admin"))):
    """Deaktiver ALLE QR-koder for tenanten (per vare + per størrelse). Krever admin."""
    tid = await require_feature(request, user, "qr_codes")
    items = await db.items.find({"tenant_id": tid, "$or": [{"has_qr": True}, {"sizes.has_qr": True}]}, {"_id": 0}).to_list(10000)
    items_cleared = 0
    sizes_cleared = 0
    for it in items:
        new_sizes = list(it.get("sizes") or [])
        for s in new_sizes:
            if s.get("has_qr"):
                s["has_qr"] = False
                sizes_cleared += 1
        await db.items.update_one(
            {"id": it["id"], "tenant_id": tid},
            {"$set": {"sizes": new_sizes, "has_qr": False}},
        )
        items_cleared += 1
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "qr_reset_all",
                             f"Nullstilte alle QR-koder ({items_cleared} varer, {sizes_cleared} varelinjer)",
                             {"items_cleared": items_cleared, "sizes_cleared": sizes_cleared})
    return {"ok": True, "items_cleared": items_cleared, "sizes_cleared": sizes_cleared}


@api.delete("/items/{item_id}/qr")
async def delete_item_qr(item_id: str, request: Request, size: Optional[str] = None,
                           user=Depends(require_perm("inventory", "write"))):
    """Fjern QR-kode for en vare eller én spesifikk varelinje (?size=M)."""
    tid = await require_feature(request, user, "qr_codes")
    item = await db.items.find_one({"id": item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    if size:
        sizes = item.get("sizes") or []
        hit = next((s for s in sizes if s.get("size") == size and s.get("has_qr")), None)
        if not hit:
            raise HTTPException(404, f"QR-kode finnes ikke for størrelse {size}")
        hit["has_qr"] = False
        await db.items.update_one({"id": item_id, "tenant_id": tid},
                                  {"$set": {"sizes": sizes, "has_qr": any(s.get("has_qr") for s in sizes)}})
        return {"ok": True, "cleared": "variant", "size": size}
    sizes = item.get("sizes") or []
    for s in sizes: s["has_qr"] = False
    await db.items.update_one({"id": item_id, "tenant_id": tid},
                              {"$set": {"sizes": sizes, "has_qr": False}})
    return {"ok": True, "cleared": "all"}


@api.post("/items/{item_id}/generate-qr")
async def generate_item_qr(item_id: str, data: GenerateQrIn, request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_feature(request, user, "qr_codes")
    item = await db.items.find_one({"id": item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    if item.get("is_clothing") or item.get("is_ball"):
        sizes = item.get("sizes", [])
        chosen = set(data.sizes) if data.sizes is not None else {s["size"] for s in sizes}
        already_locked = [s["size"] for s in sizes if s["size"] in chosen and s.get("has_qr")]
        if already_locked:
            raise HTTPException(409, f"QR-kode finnes allerede for størrelse(r) {', '.join(already_locked)}. Hver varelinje kan kun ha én QR-kode.")
        for s in sizes:
            if s["size"] in chosen:
                s["has_qr"] = True
        item["sizes"] = sizes
        item["has_qr"] = any(s.get("has_qr") for s in sizes)
        await db.items.update_one({"id": item_id, "tenant_id": tid}, {"$set": {"sizes": sizes, "has_qr": item["has_qr"]}})
    else:
        if item.get("has_qr"):
            raise HTTPException(409, "QR-kode finnes allerede for denne varen. Hver vare kan kun ha én QR-kode.")
        await db.items.update_one({"id": item_id, "tenant_id": tid}, {"$set": {"has_qr": True}})
        item["has_qr"] = True
    return _clean(item)


@api.post("/items/{item_id}/delete-variant")
async def delete_item_variant(item_id: str, data: DeleteVariantIn, request: Request, user=Depends(require_perm("inventory", "admin"))):
    """Slett én varelinje/variant (størrelse+draktnr) fra en vare. Beholder historikk."""
    tid = await require_tenant(request, user)
    item = await db.items.find_one({"id": item_id, "tenant_id": tid})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    if not (item.get("is_clothing") or item.get("is_ball")):
        raise HTTPException(400, "Denne varen har ikke varianter – bruk Slett vare istedenfor")
    active = await db.loans.count_documents({
        "tenant_id": tid, "item_id": item_id, "size": data.size, "status": "borrowed",
    })
    if active > 0:
        raise HTTPException(409, f"Kan ikke slette: {active} aktive utlån bruker variant {data.size}. Returner dem først.")
    sizes = item.get("sizes", [])
    before = len(sizes)
    sizes = [s for s in sizes if not (s.get("size") == data.size and (data.jersey_number is None or str(s.get("jersey_number") or "") == str(data.jersey_number)))]
    if len(sizes) == before:
        raise HTTPException(404, f"Variant {data.size} ikke funnet")
    total_stock = sum(s.get("quantity", 0) for s in sizes)
    await db.items.update_one({"id": item_id, "tenant_id": tid},
                                {"$set": {"sizes": sizes, "total_stock": total_stock,
                                           "has_qr": any(s.get("has_qr") for s in sizes)}})
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "delete_variant",
                             f"Slettet variant {data.size} av {item.get('name')}",
                             {"item_id": item_id, "size": data.size})
    return {"ok": True, "remaining_sizes": len(sizes)}


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
    if not doc.get("main_item_number"):
        raise HTTPException(400, "Hovedvarenummer er påkrevd")
    await _validate_full_number_uniqueness(tid, doc, exclude_id=item_id)
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
    item = await db.items.find_one({"id": item_id, "tenant_id": tid}, {"_id": 0})
    if not item:
        raise HTTPException(404, "Vare ikke funnet")
    active_loans = await db.loans.count_documents({
        "tenant_id": tid, "item_id": item_id, "status": "borrowed",
    })
    if active_loans > 0:
        raise HTTPException(409, f"Kan ikke slette «{item.get('name')}»: {active_loans} aktive utlån bruker denne varen. Returner dem først.")
    pending_orders = await db.purchase_orders.count_documents({
        "tenant_id": tid, "lines.item_id": item_id,
        "status": {"$nin": ["levert", "arkivert", "annullert"]},
    })
    if pending_orders > 0:
        raise HTTPException(409, f"Kan ikke slette «{item.get('name')}»: {pending_orders} åpne bestillinger inneholder denne varen. Fullfør eller arkiver bestillingene først.")
    await db.items.delete_one({"id": item_id, "tenant_id": tid})
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "delete_item", f"Slettet vare {item.get('name')}", {"item_id": item_id})
    return {"ok": True}


@api.get("/items/taxonomy")
async def get_items_taxonomy(request: Request, user=Depends(require_perm("inventory", "read"))):
    """Returnerer hierarki Kategori → Hovedgruppe → Undergruppe basert på eksisterende varer."""
    tid = await require_tenant(request, user)
    items = await db.items.find({"tenant_id": tid}, {"category": 1, "main_group": 1, "sub_group": 1, "_id": 0}).to_list(5000)
    tree: Dict[str, Dict[str, set]] = {}
    for i in items:
        cat = (i.get("category") or "").strip()
        if not cat:
            continue
        mg = (i.get("main_group") or "").strip()
        sg = (i.get("sub_group") or "").strip()
        if cat not in tree:
            tree[cat] = {}
        if mg and mg not in tree[cat]:
            tree[cat][mg] = set()
        if mg and sg:
            tree[cat][mg].add(sg)
    categories = []
    for cat in sorted(tree.keys()):
        main_groups = []
        for mg in sorted(tree[cat].keys()):
            main_groups.append({"name": mg, "sub_groups": sorted(tree[cat][mg])})
        categories.append({"name": cat, "main_groups": main_groups})
    if not categories:
        return {"categories": DEFAULT_TAXONOMY_SEEDS, "is_seed": True}
    return {"categories": categories, "is_seed": False}


@api.post("/items/import/preview")
async def items_import_preview(request: Request, file: UploadFile = File(...), user=Depends(require_perm("inventory", "write"))):
    """Parser Excel-filen og returnerer validerings-rapport uten å lagre noe."""
    tid = await require_feature(request, user, "excel_import")
    content = await file.read()
    grouped, errors = await _parse_import_rows(tid, content)
    preview = []
    for d in grouped.values():
        main_num = d.get("main_item_number") or ""
        variant_numbers = []
        if d.get("is_clothing") or d.get("is_ball"):
            for s in d.get("sizes", []):
                variant_numbers.append(_compute_full_number(main_num, s.get("size"), s.get("jersey_number")))
        preview.append({
            "name": d["name"], "main_item_number": main_num,
            "category": d["category"], "main_group": d.get("main_group"),
            "sub_group": d.get("sub_group"), "price": d.get("price"),
            "type": "klær" if d.get("is_clothing") else ("ball" if d.get("is_ball") else "vare"),
            "variant_count": len(d.get("sizes", [])),
            "variant_numbers": variant_numbers,
            "full_number": _compute_full_number(main_num) if not variant_numbers else None,
            "total_stock": d.get("total_stock", 0),
            "supplier_name": d.get("supplier_name"),
            "supplier_number": d.get("supplier_number"),
            "will_update": d.get("_will_update", False),
        })
    return {
        "ok": len(errors) == 0,
        "items": preview,
        "errors": errors,
        "total_items": len(preview),
        "total_variants": sum(p["variant_count"] for p in preview),
    }


@api.get("/items/import/template")
async def items_import_template(request: Request, user=Depends(require_perm("inventory", "write"))):
    tid = await require_feature(request, user, "excel_import")
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.worksheet.datavalidation import DataValidation
    wb = Workbook()
    ws = wb.active; ws.title = "Varer"
    for ci, h in enumerate(IMPORT_COLUMNS, start=1):
        c = ws.cell(row=1, column=ci, value=h)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill(start_color="7F1D1D", end_color="7F1D1D", fill_type="solid")
        c.alignment = Alignment(horizontal="center", wrap_text=True)
    ws.append(["Kjegler", "Trening", "Trening", "Markering", 29, "Hylle A1", "vare", "", "", 50, "", ""])
    ws.append(["Hjemmedrakt", "Klær", "Drakt", "Hjemme", 450, "Skap B2", "klær", "S", "X", 5, "Skap B2 - øverst", ""])
    ws.append(["Hjemmedrakt", "Klær", "Drakt", "Hjemme", 450, "Skap B2", "klær", "M", "10", 8, "Skap B2 - midten", ""])
    ws.append(["Håndball Select", "Baller", "Trening", "Håndball", 299, "Ballbur", "ball", "00 Mykball", "", 10, "Ballbur hylle 1", "00001"])
    ws.append(["Håndball Select", "Baller", "Trening", "Håndball", 299, "Ballbur", "ball", "1", "", 15, "Ballbur hylle 2", "00001"])
    widths = [26, 16, 16, 18, 10, 16, 10, 14, 10, 10, 20, 14]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64+i)].width = w
    dv_type = DataValidation(type="list", formula1='"vare,klær,ball"', allow_blank=True)
    dv_type.error = "Type må være 'vare', 'klær' eller 'ball'"
    dv_type.errorTitle = "Ugyldig type"
    ws.add_data_validation(dv_type)
    dv_type.add("H2:H1000")
    ws.append([])
    ws.append(["Gyldige ballstørrelser:", ", ".join(BALL_SIZES)])
    ws.append(["Hovedvarenummer:", "Fritekst (f.eks. HJEM100). Komplett varenummer bygges automatisk: Hovedvarenummer-Størrelse-Draktnummer (ensifret draktnr nullpaddes til 2 siffer)."])
    ws.append(["Eksempel:", "HJEM100 + str M + draktnr 8 → HJEM100-M-08"])

    info = wb.create_sheet("Instruksjoner")
    info["A1"] = "UTSTYRSROMMET – Import-mal for lagerbeholdning"
    info["A1"].font = Font(bold=True, size=14, color="7F1D1D")
    info["A2"] = "Fyll inn på arket «Varer» (rad 2 og nedover). Første 5 rader er eksempler – slett dem før import."
    info["A3"] = "Første 11 kolonner er påkrevd (Hovedvarenummer → Antall). Lokasjon pr str og Leverandørnr er valgfrie."
    info["A4"] = ""
    info["A5"] = "Felt-beskrivelser:"
    info["A5"].font = Font(bold=True)
    descs = [
        ("Hovedvarenummer", "Påkrevd. Fritekst (bokstaver+tall). F.eks. HJEM100. Komplett varenummer bygges automatisk: Hovedvarenummer-Størrelse-Draktnummer."),
        ("Varenavn", "Påkrevd. Varer med samme hovedvarenummer slås sammen til varianter."),
        ("Kategori", "Påkrevd. F.eks. Klær, Baller, Trening."),
        ("Hovedgruppe", "Valgfri. F.eks. Spillertrøye, Trening, Målvakt."),
        ("Undergruppe", "Valgfri. F.eks. Hjemmedrakter, Bortedrakter."),
        ("Pris", "Valgfri. Salgspris i NOK. Må være 0 eller mer."),
        ("Lokasjon", "Valgfri. F.eks. Hylle A1, Skap B2."),
        ("Type", "Påkrevd. Må være 'vare' (uten størrelse), 'klær' (med str + draktnr), eller 'ball' (med ballstørrelse)."),
        ("Størrelse", "Påkrevd for 'klær' og 'ball'. For ball: må være én av gyldige ballstørrelser."),
        ("Draktnr", "For 'klær': draktnummer. Bruk 'X' hvis flere drakter deler størrelse. Ensifret nullpaddes automatisk i varenummeret."),
        ("Antall", "Påkrevd. Antall per variant (eller total for 'vare')."),
        ("Lokasjon pr str", "Valgfri. Spesifikk hylleplass for akkurat denne størrelsen."),
        ("Leverandørnr", "Valgfri. Må være et eksisterende 5-sifret leverandørnr (f.eks. 00001). Opprett leverandøren FØR import.")
    ]
    row = 6
    for name, d in descs:
        info.cell(row=row, column=1, value=name).font = Font(bold=True)
        info.cell(row=row, column=2, value=d); row += 1
    info.column_dimensions["A"].width = 22; info.column_dimensions["B"].width = 90
    row += 1
    info.cell(row=row, column=1, value="Gyldige ballstørrelser:").font = Font(bold=True); row += 1
    for b in BALL_SIZES:
        info.cell(row=row, column=1, value=f"• {b}"); row += 1
    row += 1
    suppliers = await db.suppliers.find({"tenant_id": tid, "active": {"$ne": False}}, {"_id": 0}).sort("supplier_number", 1).to_list(500)
    if suppliers:
        info.cell(row=row, column=1, value="Dine leverandører (nummer | navn):").font = Font(bold=True); row += 1
        for s in suppliers:
            info.cell(row=row, column=1, value=s.get("supplier_number"))
            info.cell(row=row, column=2, value=s.get("name")); row += 1
    return _xlsx_response(wb, "utstyrsrommet_import_mal.xlsx")


@api.post("/items/import")
async def items_import(request: Request, file: UploadFile = File(...), strict: bool = False,
                        mode: str = "upsert", user=Depends(require_perm("inventory", "write"))):
    """Importer Excel. mode='upsert' (default): oppdaterer eksisterende varer m/samme navn+kategori.
    mode='insert': feiler hvis vare med samme navn finnes. strict=True returnerer 400 ved valideringsfeil."""
    tid = await require_feature(request, user, "excel_import")
    content = await file.read()
    grouped, errors = await _parse_import_rows(tid, content)
    if strict and errors:
        raise HTTPException(400, {"message": f"{len(errors)} valideringsfeil – rett opp og prøv igjen", "errors": errors})
    created = 0; updated = 0
    for doc in grouped.values():
        will_update = doc.pop("_will_update", False)
        existing_id = doc.pop("_existing_id", None)
        if will_update and existing_id:
            if mode == "insert":
                errors.append({"row": 0, "field": "Varenavn", "error": f"«{doc['name']}» finnes allerede – bruk mode=upsert eller endre navn"})
                continue
            existing = await db.items.find_one({"id": existing_id, "tenant_id": tid}, {"_id": 0}) or {}
            if (doc.get("is_clothing") or doc.get("is_ball")):
                exist_sizes = existing.get("sizes", [])
                exist_by_key = {(s.get("size"), str(s.get("jersey_number") or "")): s for s in exist_sizes}
                for new_s in doc.get("sizes", []):
                    key = (new_s.get("size"), str(new_s.get("jersey_number") or ""))
                    if key in exist_by_key:
                        exist_by_key[key]["quantity"] = int(exist_by_key[key].get("quantity") or 0) + int(new_s.get("quantity") or 0)
                        if new_s.get("location"):
                            exist_by_key[key]["location"] = new_s["location"]
                    else:
                        exist_sizes.append(new_s)
                        exist_by_key[key] = new_s
                doc["sizes"] = exist_sizes
                doc["total_stock"] = sum(int(s.get("quantity") or 0) for s in exist_sizes)
            else:
                doc["total_stock"] = int(existing.get("total_stock") or 0) + int(doc.get("total_stock") or 0)
            doc = _prep_item_doc(doc)
            try:
                await _validate_full_number_uniqueness(tid, doc, exclude_id=existing_id)
            except HTTPException as he:
                errors.append({"row": 0, "field": "Hovedvarenummer", "error": str(he.detail)})
                continue
            doc_update = {k: v for k, v in doc.items() if k not in ("id", "tenant_id", "created_at")}
            await db.items.update_one({"id": existing_id, "tenant_id": tid}, {"$set": doc_update})
            updated += 1
        else:
            doc = _prep_item_doc(doc)
            try:
                await _validate_full_number_uniqueness(tid, doc)
            except HTTPException as he:
                errors.append({"row": 0, "field": "Hovedvarenummer", "error": str(he.detail)})
                continue
            await db.items.insert_one(doc)
            created += 1
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "items_import",
                             f"Importerte {created} nye + {updated} oppdaterte varer fra Excel",
                             {"created": created, "updated": updated, "errors": len(errors)})
    return {"created": created, "updated": updated, "errors": errors}


@api.get("/items/{item_id}")
async def get_item(item_id: str, request: Request, user=Depends(require_perm("inventory", "read"))):
    """Henter én vare for innlogget klubbs tenant. Brukes bl.a. av Skann QR-siden."""
    tid = await require_tenant(request, user)
    it = await db.items.find_one({"id": item_id, "tenant_id": tid}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Vare finnes ikke")
    return it


@api.get("/items/{item_id}/open-orders")
async def get_item_open_orders(item_id: str, request: Request, user=Depends(require_perm("inventory", "read"))):
    """Henter åpne bestillinger (ikke levert/arkivert/annullert) som inneholder denne varen."""
    tid = await require_tenant(request, user)
    final_statuses = {"levert", "arkivert", "annullert"}
    orders = await db.purchase_orders.find({"tenant_id": tid, "lines.item_id": item_id,
                                             "status": {"$nin": list(final_statuses)}},
                                            {"_id": 0}).sort("created_at", -1).to_list(100)
    result = []
    for o in orders:
        for ln in o.get("lines", []):
            if ln.get("item_id") != item_id:
                continue
            ordered = int(ln.get("quantity") or 0)
            received = int(ln.get("received_quantity") or 0)
            remaining = max(0, ordered - received)
            result.append({
                "order_id": o["id"],
                "po_number": o.get("po_number"),
                "supplier_name": o.get("supplier_name"),
                "created_at": o.get("created_at"),
                "status": o.get("status"),
                "size": ln.get("size"),
                "jersey_number": ln.get("jersey_number"),
                "full_number": ln.get("full_number") or ln.get("item_number") or "",
                "ordered": ordered,
                "received": received,
                "remaining": remaining,
                "line_status": ln.get("line_status", "ulevert"),
            })
    return {"orders": result}
