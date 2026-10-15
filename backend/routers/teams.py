"""
Router for lag (Teams) og personer (People) – UTSTYRSROMMET

Inneholder:
- Lag CRUD (list, create, get, update, delete)
- Personer CRUD (list, create, get, update, delete)
- _sync_team_people: holder personer i sync med trenerroller på et lag

Hjelpefunksjoner som kun brukes her: _sync_team_people.
Felles hjelpefunksjoner importeres via _shared.
"""
from typing import List, Optional

from fastapi import Depends, HTTPException, Request

from ._shared import (
    api, db, require_tenant, require_perm,
    get_tenant_plan, now_iso, new_id, _clean,
    TeamIn, PersonIn,
)


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


# ---------------- Teams ----------------
@api.get("/teams")
async def list_teams(request: Request, user=Depends(require_perm("teams", "read"))):
    tid = await require_tenant(request, user)
    return await db.teams.find({"tenant_id": tid}, {"_id": 0}).to_list(1000)


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
    # Auto-utled fullt navn fra first_name/last_name dersom name er tomt
    if not (doc.get("name") or "").strip():
        full = f"{doc.get('first_name','').strip()} {doc.get('last_name','').strip()}".strip()
        if not full:
            raise HTTPException(400, "Navn (fornavn + etternavn) kreves")
        doc["name"] = full
    # Synkroniser team_ids fra team_memberships dersom memberships er satt (sannhetskilde)
    memberships = doc.get("team_memberships") or []
    if memberships:
        doc["team_ids"] = list({m["team_id"] for m in memberships if m.get("team_id")})
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
    update = data.dict()
    # Auto-utled fullt navn fra first_name/last_name dersom name er tomt
    if not (update.get("name") or "").strip():
        full = f"{update.get('first_name','').strip()} {update.get('last_name','').strip()}".strip()
        if full:
            update["name"] = full
    # Synkroniser team_ids fra team_memberships dersom memberships er satt (sannhetskilde)
    memberships = update.get("team_memberships") or []
    if memberships:
        update["team_ids"] = list({m["team_id"] for m in memberships if m.get("team_id")})
    await db.people.update_one({"id": person_id, "tenant_id": tid}, {"$set": update})
    return await db.people.find_one({"id": person_id, "tenant_id": tid}, {"_id": 0})


@api.delete("/people/{person_id}")
async def delete_person(person_id: str, request: Request, user=Depends(require_perm("people", "admin"))):
    tid = await require_tenant(request, user)
    await db.people.delete_one({"id": person_id, "tenant_id": tid})
    return {"ok": True}
