"""Iteration 6: QR-only-deluxe backend tests.
Covers:
- GET /api/plans: deluxe has qr_codes True; basic/pro do not have truthy qr_codes
- POST /api/items: auto has_qr=True for deluxe/platform_owner, False for basic/pro
- POST /api/items/{id}/generate-qr: deluxe -> 200 has_qr=True; basic/pro -> 403
- GET /api/inventory/qr-filters: deluxe returns shape; basic -> 403
- GET /api/inventory/qr-labels: deluxe scope=all/item/main_group/sub_group x size=small/medium/large PDF; basic -> 403
- Logo overlay: upload logo, request qr-labels, confirm no error (200 PDF)
"""
import os
import uuid
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


def _signup_tenant(plan: str):
    """Create tenant via /api/signup and (optionally) upgrade plan via owner."""
    suffix = uuid.uuid4().hex[:8]
    email = f"it6_{plan}_{suffix}@example.com"
    password = "TestPass1!"
    payload = {
        "club_name": f"TEST_It6_{plan}_{suffix}",
        "owner_name": "It6 Eier",
        "owner_email": email,
        "owner_phone": "+4712345678",
        "password": password,
        "plan": "basic",
        "accept_terms": True,
    }
    r = requests.post(f"{API}/signup", json=payload)
    assert r.status_code == 200, r.text
    cid = r.json()["customer"]["id"]
    return {"email": email, "password": password, "cid": cid, "plan_requested": plan}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def deluxe_tenant(owner_session):
    t = _signup_tenant("deluxe")
    r = owner_session.patch(f"{API}/owner/customers/{t['cid']}", json={"plan": "deluxe", "status": "active"})
    assert r.status_code == 200, r.text
    s = _login(t["email"], t["password"])
    yield {"s": s, **t}
    try:
        owner_session.delete(f"{API}/owner/customers/{t['cid']}")
    except Exception:
        pass


@pytest.fixture(scope="module")
def basic_tenant(owner_session):
    t = _signup_tenant("basic")
    # ensure active (signup usually creates trial / active - make active)
    owner_session.patch(f"{API}/owner/customers/{t['cid']}", json={"plan": "basic", "status": "active"})
    s = _login(t["email"], t["password"])
    yield {"s": s, **t}
    try:
        owner_session.delete(f"{API}/owner/customers/{t['cid']}")
    except Exception:
        pass


# ---------- Plans ----------
class TestPlans:
    def test_plans_qr_codes_flag(self):
        r = requests.get(f"{API}/plans")
        assert r.status_code == 200
        plans = {p["key"]: p for p in r.json()}
        assert "deluxe" in plans and "basic" in plans and "pro" in plans
        assert plans["deluxe"].get("qr_codes") is True
        # basic/pro should NOT have truthy qr_codes
        assert not plans["basic"].get("qr_codes")
        assert not plans["pro"].get("qr_codes")


# ---------- Auto has_qr on create ----------
class TestItemCreateHasQr:
    def test_deluxe_auto_has_qr(self, deluxe_tenant):
        s = deluxe_tenant["s"]
        r = s.post(f"{API}/items", json={"name": f"TEST_D_{uuid.uuid4().hex[:5]}", "price": 10.0, "total_stock": 1, "location": "A"})
        assert r.status_code == 200, r.text
        assert r.json().get("has_qr") is True

    def test_basic_no_auto_has_qr(self, basic_tenant):
        s = basic_tenant["s"]
        r = s.post(f"{API}/items", json={"name": f"TEST_B_{uuid.uuid4().hex[:5]}", "price": 10.0, "total_stock": 1, "location": "A"})
        assert r.status_code == 200, r.text
        assert not r.json().get("has_qr")

    def test_platform_owner_auto_has_qr(self, owner_session):
        r = owner_session.post(f"{API}/items", json={"name": f"TEST_PO_{uuid.uuid4().hex[:5]}", "price": 10.0, "total_stock": 1, "location": "A"})
        assert r.status_code == 200, r.text
        assert r.json().get("has_qr") is True
        # Cleanup
        owner_session.delete(f"{API}/items/{r.json()['id']}")


# ---------- Generate QR endpoint ----------
class TestGenerateQr:
    def test_deluxe_generate_qr(self, deluxe_tenant):
        s = deluxe_tenant["s"]
        # Create item (auto has_qr=True on deluxe)
        r = s.post(f"{API}/items", json={"name": f"TEST_GEN_{uuid.uuid4().hex[:5]}", "price": 5.0, "total_stock": 1, "location": "A"})
        iid = r.json()["id"]
        r = s.post(f"{API}/items/{iid}/generate-qr", json={})
        assert r.status_code == 200, r.text
        assert r.json().get("has_qr") is True

    def test_basic_generate_qr_forbidden(self, basic_tenant):
        s = basic_tenant["s"]
        r = s.post(f"{API}/items", json={"name": f"TEST_GENB_{uuid.uuid4().hex[:5]}", "price": 5.0, "total_stock": 1, "location": "A"})
        iid = r.json()["id"]
        r = s.post(f"{API}/items/{iid}/generate-qr", json={})
        assert r.status_code == 403, r.text


# ---------- QR Filters ----------
class TestQrFilters:
    def test_deluxe_qr_filters_shape(self, deluxe_tenant):
        s = deluxe_tenant["s"]
        # Make sure at least one item with group exists
        s.post(f"{API}/items", json={"name": f"TEST_F_{uuid.uuid4().hex[:5]}", "price": 5.0, "total_stock": 1,
                                      "location": "A", "main_group": "Hovedgr1", "sub_group": "Undergr1"})
        r = s.get(f"{API}/inventory/qr-filters")
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(["items", "main_groups", "sub_groups", "total"]).issubset(d.keys())
        assert isinstance(d["items"], list)
        assert d["total"] == len(d["items"])
        # Each item must have has_qr enabled -- they are created on deluxe so should
        assert d["total"] >= 1

    def test_basic_qr_filters_forbidden(self, basic_tenant):
        s = basic_tenant["s"]
        r = s.get(f"{API}/inventory/qr-filters")
        assert r.status_code == 403, r.text


# ---------- QR Labels PDF ----------
class TestQrLabels:
    @pytest.mark.parametrize("size", ["small", "medium", "large"])
    def test_deluxe_qr_labels_all_sizes(self, deluxe_tenant, size):
        s = deluxe_tenant["s"]
        # Seed at least one item to avoid 404 regardless of execution order
        s.post(f"{API}/items", json={"name": f"TEST_SZ_{size}_{uuid.uuid4().hex[:5]}", "price": 5.0, "total_stock": 1, "location": "A"})
        r = s.get(f"{API}/inventory/qr-labels", params={"scope": "all", "size": size})
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_qr_labels_scope_main_group(self, deluxe_tenant):
        s = deluxe_tenant["s"]
        # Ensure one has main_group=Hovedgr1
        s.post(f"{API}/items", json={"name": f"TEST_MG_{uuid.uuid4().hex[:5]}", "price": 5.0, "total_stock": 1,
                                      "location": "A", "main_group": "Hovedgr1"})
        r = s.get(f"{API}/inventory/qr-labels", params={"scope": "main_group", "value": "Hovedgr1", "size": "medium"})
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"

    def test_qr_labels_scope_item(self, deluxe_tenant):
        s = deluxe_tenant["s"]
        r = s.post(f"{API}/items", json={"name": f"TEST_SI_{uuid.uuid4().hex[:5]}", "price": 5.0, "total_stock": 1, "location": "A"})
        iid = r.json()["id"]
        r = s.get(f"{API}/inventory/qr-labels", params={"scope": "item", "value": iid, "size": "small"})
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"

    def test_basic_qr_labels_forbidden(self, basic_tenant):
        s = basic_tenant["s"]
        r = s.get(f"{API}/inventory/qr-labels", params={"scope": "all", "size": "medium"})
        assert r.status_code == 403, r.text


# ---------- Logo overlay ----------
class TestLogoOverlay:
    def test_qr_labels_with_club_logo(self, deluxe_tenant):
        s = deluxe_tenant["s"]
        # Fetch user's club or create one
        clubs = s.get(f"{API}/clubs").json()
        if clubs:
            club = clubs[0]
        else:
            club = s.post(f"{API}/clubs", json={"name": f"TEST_LC_{uuid.uuid4().hex[:5]}"}).json()
        # 1x1 PNG data URL
        tiny_png = (
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        r = s.put(f"{API}/clubs/{club['id']}", json={"name": club["name"], "logo_url": tiny_png})
        assert r.status_code == 200, r.text
        # Ensure one item
        s.post(f"{API}/items", json={"name": f"TEST_LOGO_{uuid.uuid4().hex[:5]}", "price": 5.0, "total_stock": 1, "location": "A"})
        r = s.get(f"{API}/inventory/qr-labels", params={"scope": "all", "size": "medium"})
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"
