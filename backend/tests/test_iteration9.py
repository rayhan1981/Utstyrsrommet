"""Iteration 9 - Trial subscription (7-day deluxe trial, deferred select-plan, expired=402, extend-trial)."""
import os
import uuid
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "utstyrsrommet_db")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "raymond.d.hansen@gmail.com"
ADMIN_PASSWORD = "Snowboard1!"


def _rand():
    return uuid.uuid4().hex[:8]


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def trial_tenant():
    """Create a fresh trial tenant via /signup (no plan field)."""
    s = requests.Session()
    email = f"TEST_it9_trial_{_rand()}@example.com"
    payload = {
        "club_name": f"TEST_It9_Club_{_rand()}",
        "owner_name": "Test Trial Owner",
        "owner_email": email,
        "owner_phone": "+4799999999",
        "password": "TrialPass123!",
        "accept_terms": True,
    }
    r = s.post(f"{API}/signup", json=payload)
    assert r.status_code == 200, r.text
    me = s.get(f"{API}/auth/me").json()
    return {"session": s, "email": email, "me": me, "tenant_id": me["tenant_id"]}


# ---------------- Signup → trial ----------------
def test_signup_creates_trial_without_plan(trial_tenant):
    me = trial_tenant["me"]
    assert me["customer"]["subscription_status"] == "trial"
    assert me["plan"]["key"] == "deluxe"
    assert 6 <= me["trial_days_left"] <= 7
    cust = me["customer"]
    assert cust.get("trial_start_date")
    assert cust.get("trial_end_date")


def test_trial_user_can_write_items(trial_tenant):
    s = trial_tenant["session"]
    payload = {"name": f"TEST_It9_Item_{_rand()}", "category": "Ski", "sizes": [{"size": "M", "quantity": 1}]}
    r = s.post(f"{API}/items", json=payload)
    assert r.status_code in (200, 201), r.text
    item_id = r.json()["id"]
    # Also PUT and DELETE for completeness
    r2 = s.put(f"{API}/items/{item_id}", json={**payload, "name": payload["name"] + "_upd"})
    assert r2.status_code == 200
    r3 = s.delete(f"{API}/items/{item_id}")
    assert r3.status_code in (200, 204)


# ---------------- Select plan (deferred) ----------------
def test_select_plan_pro_sets_selected_plan(trial_tenant):
    s = trial_tenant["session"]
    r = s.post(f"{API}/subscription/select-plan", json={"plan": "pro"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["selected_plan"] == "pro"
    # Trial should still be active - subscription_status unchanged
    me = s.get(f"{API}/auth/me").json()
    assert me["customer"]["subscription_status"] == "trial"
    assert me["plan"]["key"] == "deluxe"  # still deluxe during trial
    assert me["customer"]["selected_plan"] == "pro"


# ---------------- Expire trial via DB & verify 402 ----------------
def _backdate_trial(tenant_id: str, selected_plan=None):
    async def _run():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        updates = {"trial_end_date": past, "trial_ends_at": past, "subscription_status": "trial"}
        if selected_plan is not None:
            updates["selected_plan"] = selected_plan
        await db.customers.update_one({"id": tenant_id}, {"$set": updates})
        client.close()
    asyncio.get_event_loop().run_until_complete(_run()) if False else asyncio.run(_run())


def test_expired_trial_with_selected_plan_activates():
    # Signup fresh tenant
    s = requests.Session()
    email = f"TEST_it9_exp_act_{_rand()}@example.com"
    r = s.post(f"{API}/signup", json={
        "club_name": f"TEST_It9_ExpAct_{_rand()}",
        "owner_name": "Exp Act",
        "owner_email": email, "owner_phone": "", "password": "Pass1234!",
        "accept_terms": True,
    })
    assert r.status_code == 200
    me = s.get(f"{API}/auth/me").json()
    tid = me["tenant_id"]
    # Select pro, then backdate trial
    r2 = s.post(f"{API}/subscription/select-plan", json={"plan": "pro"})
    assert r2.status_code == 200
    _backdate_trial(tid)
    me2 = s.get(f"{API}/auth/me").json()
    assert me2["customer"]["subscription_status"] == "active"
    assert me2["customer"]["plan"] == "pro"
    # Writes should still work
    r3 = s.post(f"{API}/items", json={"name": f"TEST_It9_Post_{_rand()}", "category": "Ski", "sizes": []})
    assert r3.status_code in (200, 201), r3.text


def test_expired_trial_no_selected_plan_blocks_writes_402():
    s = requests.Session()
    email = f"TEST_it9_exp_block_{_rand()}@example.com"
    r = s.post(f"{API}/signup", json={
        "club_name": f"TEST_It9_ExpBlock_{_rand()}",
        "owner_name": "Exp Block",
        "owner_email": email, "owner_phone": "", "password": "Pass1234!",
        "accept_terms": True,
    })
    assert r.status_code == 200
    me = s.get(f"{API}/auth/me").json()
    tid = me["tenant_id"]
    _backdate_trial(tid)  # no selected_plan
    me2 = s.get(f"{API}/auth/me").json()
    assert me2["customer"]["subscription_status"] == "expired"
    # GET still works
    r_get = s.get(f"{API}/items")
    assert r_get.status_code == 200
    # POST should return 402
    r_post = s.post(f"{API}/items", json={"name": f"TEST_It9_Blocked_{_rand()}", "category": "Ski", "sizes": []})
    assert r_post.status_code == 402, f"expected 402 got {r_post.status_code}: {r_post.text}"
    assert "Prøveperioden" in r_post.text or "abonnement" in r_post.text.lower()
    # PUT/DELETE should also 402 on any existing item - try an arbitrary id
    r_del = s.delete(f"{API}/items/nonexistent_id")
    assert r_del.status_code in (402, 403, 404)
    # Return the tenant id for extend-trial test
    return tid


# ---------------- Extend trial (owner) ----------------
def test_platform_owner_extend_trial(owner_session):
    # Create a fresh tenant and expire it, then owner extends
    s = requests.Session()
    email = f"TEST_it9_ext_{_rand()}@example.com"
    r = s.post(f"{API}/signup", json={
        "club_name": f"TEST_It9_Ext_{_rand()}",
        "owner_name": "Ext Owner",
        "owner_email": email, "owner_phone": "", "password": "Pass1234!",
        "accept_terms": True,
    })
    assert r.status_code == 200
    me = s.get(f"{API}/auth/me").json()
    tid = me["tenant_id"]
    _backdate_trial(tid)
    # Extend as platform owner
    r_ext = owner_session.post(f"{API}/owner/customers/{tid}/extend-trial", json={"days": 7})
    assert r_ext.status_code == 200, r_ext.text
    data = r_ext.json()
    assert data["ok"] is True
    new_end = datetime.fromisoformat(data["trial_end_date"])
    assert new_end > datetime.now(timezone.utc) + timedelta(days=6)
    # Verify tenant can write again
    me2 = s.get(f"{API}/auth/me").json()
    assert me2["customer"]["subscription_status"] == "trial"
    assert me2["trial_days_left"] >= 6
    r_write = s.post(f"{API}/items", json={"name": f"TEST_It9_PostExt_{_rand()}", "category": "Ski", "sizes": []})
    assert r_write.status_code in (200, 201)


# ---------------- Regression ----------------
def test_plans_hides_free(owner_session):
    r = owner_session.get(f"{API}/plans")
    assert r.status_code == 200
    plans = r.json()
    keys = [p.get("key") for p in plans] if isinstance(plans, list) else list(plans.keys())
    assert "free" not in keys


def test_owner_workspace_not_affected_by_sync(owner_session):
    me = owner_session.get(f"{API}/auth/me").json()
    assert me["customer"].get("is_owner_workspace") is True
    assert me["plan"]["key"] == "deluxe"
    # Owner's subscription_status is NOT 'expired'
    assert me["customer"].get("subscription_status") != "expired"
