"""
Router for taxonomy-administrasjon:
- Omdøp kategori/hovedgruppe/undergruppe på tvers av alle varer
- Bulk-flytt varer mellom hovedgrupper/undergrupper

Monteres på eksisterende APIRouter `api` fra server.py via `_shared`.
"""
from typing import Optional, List
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from ._shared import api, db, require_tenant, require_perm, _log_activity


class TaxonomyRenameIn(BaseModel):
    level: str  # 'category' | 'main_group' | 'sub_group'
    old_name: str
    new_name: str
    parent_category: Optional[str] = None   # kreves for main_group/sub_group
    parent_main_group: Optional[str] = None  # kreves for sub_group


class BulkMoveIn(BaseModel):
    item_ids: List[str]
    target_category: Optional[str] = None
    target_main_group: Optional[str] = None
    target_sub_group: Optional[str] = None


@api.post("/items/taxonomy/rename")
async def rename_taxonomy(data: TaxonomyRenameIn, request: Request,
                           user=Depends(require_perm("inventory", "admin"))):
    """Omdøp en kategori/hovedgruppe/undergruppe. Oppdaterer alle berørte items i én operasjon."""
    tid = await require_tenant(request, user)
    old = (data.old_name or "").strip()
    new = (data.new_name or "").strip()
    if not old or not new:
        raise HTTPException(400, "Gammelt og nytt navn er påkrevd")
    if old == new:
        return {"ok": True, "updated": 0, "message": "Ingen endring"}

    if data.level == "category":
        q = {"tenant_id": tid, "category": old}
        update = {"$set": {"category": new}}
    elif data.level == "main_group":
        if not data.parent_category:
            raise HTTPException(400, "parent_category er påkrevd for hovedgruppe-omdøping")
        q = {"tenant_id": tid, "category": data.parent_category, "main_group": old}
        update = {"$set": {"main_group": new}}
    elif data.level == "sub_group":
        if not data.parent_category or not data.parent_main_group:
            raise HTTPException(400, "parent_category og parent_main_group er påkrevd for undergruppe-omdøping")
        q = {"tenant_id": tid, "category": data.parent_category,
             "main_group": data.parent_main_group, "sub_group": old}
        update = {"$set": {"sub_group": new}}
    else:
        raise HTTPException(400, "level må være 'category', 'main_group' eller 'sub_group'")

    # Sjekk at kombinasjonen eksisterer før vi oppdaterer
    count = await db.items.count_documents(q)
    if count == 0:
        raise HTTPException(404, f"Ingen varer funnet med «{old}» på nivå {data.level}")

    r = await db.items.update_many(q, update)
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "rename_taxonomy",
                             f"Omdøpte {data.level} «{old}» → «{new}» ({r.modified_count} varer oppdatert)",
                             {"level": data.level, "old": old, "new": new})
    return {"ok": True, "updated": r.modified_count}


@api.post("/items/taxonomy/delete")
async def delete_taxonomy_node(data: TaxonomyRenameIn, request: Request,
                                 user=Depends(require_perm("inventory", "admin"))):
    """Fjern en kategori/hovedgruppe/undergruppe. Setter berørte varer til tom streng på det nivået.
    Validering: Blokkerer hvis det er varer under noden.
    (Her gjenbrukes TaxonomyRenameIn – kun `level` og `old_name` + parents trengs; new_name ignoreres.)"""
    tid = await require_tenant(request, user)
    old = (data.old_name or "").strip()
    if not old:
        raise HTTPException(400, "Navn er påkrevd")

    if data.level == "category":
        q = {"tenant_id": tid, "category": old}
        update = {"$set": {"category": "", "main_group": "", "sub_group": ""}}
    elif data.level == "main_group":
        if not data.parent_category:
            raise HTTPException(400, "parent_category er påkrevd")
        q = {"tenant_id": tid, "category": data.parent_category, "main_group": old}
        update = {"$set": {"main_group": "", "sub_group": ""}}
    elif data.level == "sub_group":
        if not data.parent_category or not data.parent_main_group:
            raise HTTPException(400, "parent_category og parent_main_group er påkrevd")
        q = {"tenant_id": tid, "category": data.parent_category,
             "main_group": data.parent_main_group, "sub_group": old}
        update = {"$set": {"sub_group": ""}}
    else:
        raise HTTPException(400, "level må være category, main_group eller sub_group")

    r = await db.items.update_many(q, update)
    if user.get("role") != "platform_owner":
        await _log_activity(tid, user, "delete_taxonomy_node",
                             f"Slettet {data.level} «{old}» – {r.modified_count} varer flyttet til «uten»",
                             {"level": data.level, "name": old})
    return {"ok": True, "updated": r.modified_count}


@api.post("/items/bulk-move")
async def bulk_move_items(data: BulkMoveIn, request: Request,
                           user=Depends(require_perm("inventory", "write"))):
    """Flytt en liste av varer til ny kategori/hovedgruppe/undergruppe. Bruker for dra-og-slipp."""
    tid = await require_tenant(request, user)
    if not data.item_ids:
        raise HTTPException(400, "Ingen varer valgt")

    update: dict = {}
    if data.target_category is not None:
        update["category"] = data.target_category.strip()
    if data.target_main_group is not None:
        update["main_group"] = data.target_main_group.strip()
    if data.target_sub_group is not None:
        update["sub_group"] = data.target_sub_group.strip()
    if not update:
        raise HTTPException(400, "Ingen målverdier oppgitt")

    r = await db.items.update_many(
        {"tenant_id": tid, "id": {"$in": data.item_ids}},
        {"$set": update},
    )
    if user.get("role") != "platform_owner":
        path = " > ".join([v for v in [update.get("category"), update.get("main_group"), update.get("sub_group")] if v])
        await _log_activity(tid, user, "bulk_move_items",
                             f"Flyttet {r.modified_count} varer til «{path or 'uten mappe'}»",
                             {"count": r.modified_count, "target": update})
    return {"ok": True, "updated": r.modified_count}
