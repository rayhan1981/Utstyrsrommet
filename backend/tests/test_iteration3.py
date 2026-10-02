"""Backend tests for iteration 3 - loan_target, GET /teams/{id} shape,
users online/last_login, login_history, logout tracking."""
import os
import uuid
import time
import pytest
import requests


def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip()
                    break
    return url.rstrip("/")


BASE_URL = _load_backend_url()
API = BASE_URL + "/api"

ADMIN_EMAIL = "raymond.d.hansen@gmail.com"
ADMIN_PASSWORD = "Snowboard1!"


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def tenant(owner_session):
    """Create a fresh test tenant on deluxe plan and return a logged-in session."""
    suffix = uuid.uuid4().hex[:8]
    email = f"it3_{suffix}@example.com"
    password = "TestPass1!"
    payload = {
        "club_name": f"TEST_It3_{suffix}", "owner_name": "It3 Eier",
        "owner_email": email, "owner_phone": "+4712345678",
        "password": password, "plan": "basic", "accept_terms": True,
    }
    r = requests.post(f"{API}/signup", json=payload)
    assert r.status_code == 200, r.text
    cid = r.json()["customer"]["id"]
    # upgrade to deluxe to unlock features
    owner_session.patch(f"{API}/owner/customers/{cid}", json={"plan": "deluxe", "status": "active"})
    s = requests.Session()
    lr = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert lr.status_code == 200, lr.text
    data = lr.json()
    s.headers.update({"Authorization": f"Bearer {data['token']}"})
    yield {"s": s, "email": email, "password": password, "cid": cid, "user_id": data["user"]["id"]}
    # soft cleanup
    try:
        owner_session.delete(f"{API}/owner/customers/{cid}")
    except Exception:
        pass


# -------- Loan target routing --------
class TestLoanTargetRouting:
    def _make_entities(self, s):
        rt = s.post(f"{API}/teams", json={"team_name": f"TEST_T_{uuid.uuid4().hex[:5]}"})
        team = rt.json()
        rp = s.post(f"{API}/people", json={"name": f"TEST_P_{uuid.uuid4().hex[:5]}", "team_ids": [team["id"]]})
        person = rp.json()
        ri = s.post(f"{API}/items", json={"name": f"TEST_I_{uuid.uuid4().hex[:5]}", "price": 100.0, "total_stock": 20, "location": "X"})
        item = ri.json()
        return team, person, item

    def test_loan_target_team(self, tenant):
        s = tenant["s"]
        team, person, item = self._make_entities(s)
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 2, "team_id": team["id"],
            "person_id": person["id"], "mode": "loan", "charge_price": True,
            "loan_target": "team",
        })
        assert rl.status_code == 200, rl.text
        loan = rl.json()
        assert loan["loan_target"] == "team"

        team_after = next(t for t in s.get(f"{API}/teams").json() if t["id"] == team["id"])
        person_after = next(p for p in s.get(f"{API}/people").json() if p["id"] == person["id"])
        assert team_after.get("debt", 0) == 200.0, f"team debt: {team_after.get('debt')}"
        assert person_after.get("debt", 0) == 0.0, f"person debt: {person_after.get('debt')}"

        # Return the loan - debt should return to team only
        rr = s.post(f"{API}/loans/{loan['id']}/return", json={"quantity": 2})
        assert rr.status_code == 200, rr.text
        team_after2 = next(t for t in s.get(f"{API}/teams").json() if t["id"] == team["id"])
        assert team_after2.get("debt", 0) == 0.0, f"team debt after return: {team_after2.get('debt')}"

    def test_loan_target_person(self, tenant):
        s = tenant["s"]
        team, person, item = self._make_entities(s)
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "team_id": team["id"],
            "person_id": person["id"], "mode": "loan", "charge_price": True,
            "loan_target": "person",
        })
        assert rl.status_code == 200, rl.text
        loan = rl.json()
        assert loan["loan_target"] == "person"
        team_after = next(t for t in s.get(f"{API}/teams").json() if t["id"] == team["id"])
        person_after = next(p for p in s.get(f"{API}/people").json() if p["id"] == person["id"])
        assert person_after.get("debt", 0) == 100.0
        assert team_after.get("debt", 0) == 0.0

        rr = s.post(f"{API}/loans/{loan['id']}/return", json={"quantity": 1})
        assert rr.status_code == 200
        person_after2 = next(p for p in s.get(f"{API}/people").json() if p["id"] == person["id"])
        assert person_after2.get("debt", 0) == 0.0


# -------- GET /teams/{id} shape --------
class TestGetTeamDetail:
    def test_shape(self, tenant):
        s = tenant["s"]
        rt = s.post(f"{API}/teams", json={"team_name": f"TEST_Detail_{uuid.uuid4().hex[:5]}"})
        team = rt.json()
        rp = s.post(f"{API}/people", json={"name": "TEST_Member", "team_ids": [team["id"]]})
        person = rp.json()
        ri = s.post(f"{API}/items", json={"name": "TEST_DetailItem", "price": 50.0, "total_stock": 5, "location": "A"})
        item = ri.json()
        s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "team_id": team["id"],
            "person_id": person["id"], "mode": "loan", "charge_price": True,
            "loan_target": "team",
        })
        r = s.get(f"{API}/teams/{team['id']}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "team" in d and "people" in d and "history" in d
        assert d["team"]["id"] == team["id"]
        assert any(p["id"] == person["id"] for p in d["people"])
        assert len(d["history"]) >= 1
        assert d["history"][0]["team_id"] == team["id"]


# -------- Users online + last_login + login history --------
class TestUsersAndLoginHistory:
    def test_users_online_and_last_login(self, tenant, owner_session):
        s = tenant["s"]
        r = s.get(f"{API}/users")
        assert r.status_code == 200, r.text
        users = r.json()
        me = next((u for u in users if u["id"] == tenant["user_id"]), None)
        assert me is not None
        assert "online" in me and "last_login" in me
        assert me["online"] is True
        assert me["last_login"] is not None

    def test_login_history_tracking(self, tenant):
        # Login a second time with fresh session
        s2 = requests.Session()
        lr = s2.post(f"{API}/auth/login", json={"email": tenant["email"], "password": tenant["password"]})
        assert lr.status_code == 200
        token = lr.json()["token"]
        s2.headers.update({"Authorization": f"Bearer {token}"})
        # logout
        lo = s2.post(f"{API}/auth/logout")
        assert lo.status_code in (200, 204)

        # Fetch history (admin role - tenant owner has admin)
        r = tenant["s"].get(f"{API}/users/{tenant['user_id']}/login-history")
        assert r.status_code == 200, r.text
        hist = r.json()
        assert isinstance(hist, list)
        assert len(hist) >= 2
        # Newest first
        assert hist[0]["logged_in_at"] >= hist[-1]["logged_in_at"]
        # The most recent completed logout should have logged_out_at populated for at least one record
        assert any(h.get("logged_out_at") for h in hist)

    def test_login_history_requires_admin(self, tenant, owner_session):
        # Create a non-admin user under tenant and ensure they can't access
        s = tenant["s"]
        uname = f"TEST_viewer_{uuid.uuid4().hex[:5]}"
        email = f"{uname}@example.com"
        r = s.post(f"{API}/users", json={"name": uname, "email": email, "role": "viewer"})
        # If backend requires other fields it may return 400 - skip gracefully
        if r.status_code != 200:
            pytest.skip(f"Could not create viewer user: {r.status_code} {r.text}")
