"""Backend tests for UTSTYRSROMMET - focus on NEW changes:
- Plans filtering (no 'free'), signup blocking 'free'
- Owner CRUD/soft-delete/restore for customers
- Status blocks login
- Stock-counts pre-populate, auto-save, apply skips null, delete, line delete
- Teams trainer-remove syncs people team_ids
- Loan to person+team charges only person
"""
import os
import time
import uuid
import pytest
import requests

def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    return url.rstrip("/")


BASE_URL = _load_backend_url()
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = BASE_URL + "/api"

ADMIN_EMAIL = "raymond.d.hansen@gmail.com"
ADMIN_PASSWORD = "Snowboard1!"


# --------------- Fixtures ---------------
@pytest.fixture(scope="session")
def owner_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "platform_owner"
    s.headers.update({"Authorization": f"Bearer {data['token']}"})
    return s


@pytest.fixture(scope="session")
def test_customer(owner_session):
    """Create a test customer via /api/signup and return customer dict + login creds."""
    suffix = uuid.uuid4().hex[:8]
    email = f"test_{suffix}@example.com"
    password = "TestPass1!"
    payload = {
        "club_name": f"TEST_Klubb_{suffix}",
        "owner_name": "TEST Eier",
        "owner_email": email,
        "owner_phone": "+4712345678",
        "password": password,
        "plan": "basic",
        "accept_terms": True,
    }
    r = requests.post(f"{API}/signup", json=payload)
    assert r.status_code == 200, f"Signup failed: {r.status_code} {r.text}"
    d = r.json()
    customer = d["customer"]
    yield {"customer": customer, "email": email, "password": password}
    # cleanup
    try:
        owner_session.delete(f"{API}/owner/customers/{customer['id']}")
        # hard cleanup from DB not possible via API; soft delete is OK
    except Exception:
        pass


# --------------- Plans / Signup ---------------
class TestPlansAndSignup:
    def test_plans_excludes_free(self):
        r = requests.get(f"{API}/plans")
        assert r.status_code == 200
        plans = r.json()
        keys = [p["key"] for p in plans]
        assert "free" not in keys, f"free should be hidden, got {keys}"
        for req in ["basic", "pro", "deluxe"]:
            assert req in keys, f"missing {req} in {keys}"

    def test_signup_rejects_free(self):
        payload = {
            "club_name": "TEST_Free",
            "owner_name": "x", "owner_email": f"freex_{uuid.uuid4().hex[:6]}@example.com",
            "owner_phone": "", "password": "abcdef", "plan": "free", "accept_terms": True,
        }
        r = requests.post(f"{API}/signup", json=payload)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"


# --------------- Owner customer admin ---------------
class TestOwnerCustomerAdmin:
    def test_login_platform_owner(self, owner_session):
        r = owner_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "platform_owner"

    def test_get_customer_with_counts(self, owner_session, test_customer):
        cid = test_customer["customer"]["id"]
        r = owner_session.get(f"{API}/owner/customers/{cid}")
        assert r.status_code == 200
        d = r.json()
        assert "customer" in d and "users" in d and "counts" in d
        for k in ("teams", "people", "items", "loans", "users"):
            assert k in d["counts"], f"missing count {k}"
        assert d["counts"]["users"] >= 1

    def test_patch_customer_email_and_plan(self, owner_session, test_customer):
        cid = test_customer["customer"]["id"]
        new_email = f"patched_{uuid.uuid4().hex[:6]}@example.com"
        r = owner_session.patch(f"{API}/owner/customers/{cid}", json={
            "club_name": "TEST_Klubb_Updated",
            "owner_name": "Oppd Eier",
            "owner_email": new_email,
            "owner_phone": "+4799999999",
            "plan": "pro",
            "extra_user_seats": 3,
            "custom_price": 199.0,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["owner_email"] == new_email
        assert d["plan"] == "pro"
        assert d["extra_user_seats"] == 3
        assert d["club_name"] == "TEST_Klubb_Updated"
        # update local reference
        test_customer["email"] = new_email
        # Verify login works with new email
        s = requests.Session()
        lr = s.post(f"{API}/auth/login", json={"email": new_email, "password": test_customer["password"]})
        assert lr.status_code == 200, f"login with new email failed: {lr.text}"

    def test_patch_to_free_with_cancel_stripe(self, owner_session, test_customer):
        cid = test_customer["customer"]["id"]
        r = owner_session.patch(f"{API}/owner/customers/{cid}", json={
            "plan": "free", "cancel_stripe": True,
        })
        assert r.status_code == 200, r.text
        assert r.json()["plan"] == "free"

    def test_status_inactive_blocks_login(self, owner_session, test_customer):
        cid = test_customer["customer"]["id"]
        r = owner_session.patch(f"{API}/owner/customers/{cid}", json={"status": "inactive"})
        assert r.status_code == 200
        assert r.json()["status"] == "inactive"
        # Login must now fail with 403
        lr = requests.post(f"{API}/auth/login", json={"email": test_customer["email"], "password": test_customer["password"]})
        assert lr.status_code == 403, f"expected 403, got {lr.status_code} {lr.text}"
        assert "deaktivert" in lr.text.lower()

    def test_status_active_restores_login(self, owner_session, test_customer):
        cid = test_customer["customer"]["id"]
        r = owner_session.patch(f"{API}/owner/customers/{cid}", json={"status": "active"})
        assert r.status_code == 200
        lr = requests.post(f"{API}/auth/login", json={"email": test_customer["email"], "password": test_customer["password"]})
        assert lr.status_code == 200, f"login should work when active: {lr.text}"

    def test_soft_delete_and_restore(self, owner_session, test_customer):
        cid = test_customer["customer"]["id"]
        r = owner_session.delete(f"{API}/owner/customers/{cid}")
        assert r.status_code == 200
        d = r.json()
        assert d.get("deleted_at") and d.get("purge_at")
        # login should fail 403 "slettet"
        lr = requests.post(f"{API}/auth/login", json={"email": test_customer["email"], "password": test_customer["password"]})
        assert lr.status_code == 403, lr.text
        assert "slettet" in lr.text.lower()
        # Restore
        r2 = owner_session.post(f"{API}/owner/customers/{cid}/restore")
        assert r2.status_code == 200
        lr2 = requests.post(f"{API}/auth/login", json={"email": test_customer["email"], "password": test_customer["password"]})
        assert lr2.status_code == 200, f"login after restore failed: {lr2.text}"


# --------------- Tenant-scoped tests (as test customer) ---------------
@pytest.fixture(scope="class")
def tenant_session(test_customer, owner_session):
    # Ensure plan supports stock_audit + unlimited teams, and status is active
    cid = test_customer["customer"]["id"]
    owner_session.post(f"{API}/owner/customers/{cid}/restore")
    pr = owner_session.patch(f"{API}/owner/customers/{cid}", json={"plan": "deluxe", "status": "active"})
    assert pr.status_code == 200, pr.text
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": test_customer["email"], "password": test_customer["password"]})
    assert r.status_code == 200, f"tenant login failed: {r.text}"
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


class TestStockCountsAndLoans:
    def test_full_stock_count_flow(self, tenant_session):
        s = tenant_session
        # Create a few items with locations to validate sort
        items = []
        for name, loc, stock in [("Alfa Ball", "B-Hylle", 5), ("Beta Ball", "A-Hylle", 3), ("Gamma Ball", "A-Hylle", 10)]:
            r = s.post(f"{API}/items", json={"name": name, "location": loc, "total_stock": stock, "price": 100.0})
            assert r.status_code == 200, r.text
            items.append(r.json())

        # Start stock count
        r = s.post(f"{API}/stock-counts", json={"name": "TEST Varetelling"})
        assert r.status_code == 200, r.text
        sc = r.json()
        assert sc["status"] == "open"
        assert len(sc["lines"]) >= 3
        # Verify sort: location asc, item_name asc
        locs = [(ln["location"].lower(), ln["item_name"].lower()) for ln in sc["lines"]]
        assert locs == sorted(locs), f"lines not sorted: {locs}"
        for ln in sc["lines"]:
            assert ln["counted_quantity"] is None
            assert ln["counted_at"] is None
            assert "line_id" in ln

        count_id = sc["id"]
        # Count one line
        line = next(ln for ln in sc["lines"] if ln["item_name"] == "Alfa Ball")
        r = s.put(f"{API}/stock-counts/{count_id}/lines/{line['line_id']}", json={
            "item_id": line["item_id"], "size": None, "counted_quantity": 7
        })
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["counted_quantity"] == 7
        assert updated["counted_at"] is not None
        assert updated["diff"] == 7 - line["system_quantity"]

        # Delete another line
        del_line = next(ln for ln in sc["lines"] if ln["item_name"] == "Beta Ball")
        r = s.delete(f"{API}/stock-counts/{count_id}/lines/{del_line['line_id']}")
        assert r.status_code == 200

        # Apply - should only apply the counted line, skip null ones
        r = s.post(f"{API}/stock-counts/{count_id}/apply")
        assert r.status_code == 200, r.text

        # Verify Alfa Ball stock is 7, Gamma Ball unchanged (10)
        r = s.get(f"{API}/items")
        inv = {it["name"]: it for it in r.json()}
        assert inv["Alfa Ball"]["total_stock"] == 7
        assert inv["Gamma Ball"]["total_stock"] == 10

        # Delete entire stock count (platform_owner permission). As admin tenant user with admin role we also have perm
        r = s.delete(f"{API}/stock-counts/{count_id}")
        assert r.status_code == 200

    def test_team_trainer_removal_syncs_people(self, tenant_session):
        s = tenant_session
        # Create team with team_manager
        r = s.post(f"{API}/teams", json={
            "team_name": "TEST_Lag_Trenersync",
            "team_manager": {"name": "Trener Testesen", "email": "tt@x.com", "phone": "99999999"},
        })
        assert r.status_code == 200, r.text
        team = r.json()
        tid = team["id"]
        # Verify person auto-created with team_id
        r = s.get(f"{API}/people")
        people = r.json()
        t_person = next((p for p in people if p["name"] == "Trener Testesen"), None)
        assert t_person is not None
        assert tid in t_person.get("team_ids", [])

        # Update team: remove manager
        r = s.put(f"{API}/teams/{tid}", json={
            "team_name": "TEST_Lag_Trenersync",
            "team_manager": None,
        })
        assert r.status_code == 200, r.text

        # Verify person's team_ids no longer contains tid, but person still exists
        r = s.get(f"{API}/people")
        people = r.json()
        t_person = next((p for p in people if p["name"] == "Trener Testesen"), None)
        assert t_person is not None, "person should be kept"
        assert tid not in t_person.get("team_ids", []), f"team_id should be removed: {t_person.get('team_ids')}"

    def test_loan_person_and_team_debt_only_person(self, tenant_session):
        s = tenant_session
        # Create a team, person and item
        rt = s.post(f"{API}/teams", json={"team_name": "TEST_Debtlag"})
        team = rt.json()
        rp = s.post(f"{API}/people", json={"name": "TEST_Spiller", "team_ids": [team["id"]]})
        assert rp.status_code == 200, rp.text
        person = rp.json()
        ri = s.post(f"{API}/items", json={"name": "TEST_Vare", "price": 250.0, "total_stock": 10, "location": "X"})
        item = ri.json()

        # Loan with person_id AND team_id
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 2, "team_id": team["id"],
            "person_id": person["id"], "mode": "loan", "charge_price": True,
        })
        assert rl.status_code == 200, rl.text

        # Verify person debt=500, team debt=0
        rp2 = s.get(f"{API}/people")
        person_after = next(p for p in rp2.json() if p["id"] == person["id"])
        assert person_after["debt"] == 500.0, f"person debt: {person_after['debt']}"

        rt2 = s.get(f"{API}/teams")
        team_after = next(t for t in rt2.json() if t["id"] == team["id"])
        assert team_after.get("debt", 0) == 0.0, f"team debt should be 0, got {team_after.get('debt')}"


# --------------- Owner delete nested resources ---------------
class TestOwnerDeleteNested:
    def test_delete_tenant_user_person_item(self, owner_session, test_customer, tenant_session):
        s = tenant_session
        cid = test_customer["customer"]["id"]
        # Create a person & item under tenant
        rp = s.post(f"{API}/people", json={"name": "TEST_DelPerson"})
        pid = rp.json()["id"]
        ri = s.post(f"{API}/items", json={"name": "TEST_DelItem"})
        iid = ri.json()["id"]
        # Delete via owner endpoints
        r = owner_session.delete(f"{API}/owner/customers/{cid}/people/{pid}")
        assert r.status_code == 200
        r = owner_session.delete(f"{API}/owner/customers/{cid}/items/{iid}")
        assert r.status_code == 200
        # Verify gone
        rp2 = s.get(f"{API}/people")
        assert not any(p["id"] == pid for p in rp2.json())
        ri2 = s.get(f"{API}/items")
        assert not any(i["id"] == iid for i in ri2.json())
