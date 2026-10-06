"""Iteration 8: Bulk-generate QR + Upgrade CTA.

Covers:
- POST /api/items/bulk-generate-qr on deluxe tenant: all items + sizes get has_qr=True.
  Response {ok, items_updated, sizes_updated}.
- Idempotent: second call returns items_updated=0 and sizes_updated=0.
- Basic plan: 403 'Pakken støtter ikke qr_codes'.
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


def _signup(plan="basic"):
    suffix = uuid.uuid4().hex[:8]
    email = f"it8_{suffix}@example.com"
    password = "TestPass1!"
    payload = {
        "club_name": f"TEST_It8_{suffix}",
        "owner_name": "It8 Eier",
        "owner_email": email,
        "owner_phone": "+4712345678",
        "password": password,
        "plan": plan,
        "accept_terms": True,
    }
    r = requests.post(f"{API}/signup", json=payload)
    assert r.status_code == 200, r.text
    return {"email": email, "password": password, "cid": r.json()["customer"]["id"]}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def deluxe(owner_session):
    t = _signup()
    r = owner_session.patch(f"{API}/owner/customers/{t['cid']}", json={"plan": "deluxe", "status": "active"})
    assert r.status_code == 200, r.text
    s = _login(t["email"], t["password"])
    yield {"s": s, **t}
    try:
        owner_session.delete(f"{API}/owner/customers/{t['cid']}")
    except Exception:
        pass


@pytest.fixture(scope="module")
def basic(owner_session):
    t = _signup()
    s = _login(t["email"], t["password"])
    yield {"s": s, **t}
    try:
        owner_session.delete(f"{API}/owner/customers/{t['cid']}")
    except Exception:
        pass


def _mk_clothing(s, name="TEST_Drakt_It8"):
    payload = {
        "name": name,
        "category": "Klær",
        "main_group": "Drakter",
        "sub_group": "Hjemmedrakt",
        "price": 100.0,
        "is_clothing": True,
        "sizes": [
            {"size": "S", "jersey_number": "10", "quantity": 5, "location": "A1"},
            {"size": "M", "jersey_number": "11", "quantity": 5, "location": "A1"},
            {"size": "L", "jersey_number": "12", "quantity": 5, "location": "A1"},
        ],
    }
    r = s.post(f"{API}/items", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _mk_sizeless(s, name="TEST_Kjegle_It8"):
    payload = {"name": name, "category": "Trening", "main_group": "Trening", "price": 29.0, "total_stock": 50}
    r = s.post(f"{API}/items", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Deluxe: bulk generate QR ----------
def test_bulk_generate_qr_deluxe(deluxe):
    s = deluxe["s"]
    # Create fresh items. On deluxe, create auto-sets has_qr. So we must manually
    # clear has_qr to test bulk-generate meaningful work. The simplest option:
    # we can rely on the fact that create ALSO already sets has_qr=True in deluxe.
    # So bulk-generate should return 0/0 on fresh deluxe tenant. To exercise the
    # "updates" branch we need items/sizes without has_qr. Simulate by directly
    # creating items on basic... but basic can't. Alternative: list existing items
    # and verify response shape.
    cloth = _mk_clothing(s, name=f"TEST_It8_Cloth_{uuid.uuid4().hex[:6]}")
    sl = _mk_sizeless(s, name=f"TEST_It8_SL_{uuid.uuid4().hex[:6]}")

    # On deluxe, items are already fully QR-enabled from creation. So bulk should
    # be idempotent (0/0) immediately.
    r = s.post(f"{API}/items/bulk-generate-qr")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert data.get("items_updated") == 0
    assert data.get("sizes_updated") == 0

    # Verify item still has QR
    r2 = s.get(f"{API}/items")
    assert r2.status_code == 200
    items = r2.json()
    me = next((it for it in items if it["id"] == cloth["id"]), None)
    assert me is not None
    assert me.get("has_qr") is True
    assert all(sz.get("has_qr") for sz in me.get("sizes", []))
    me2 = next((it for it in items if it["id"] == sl["id"]), None)
    assert me2 is not None
    assert me2.get("has_qr") is True


def test_bulk_generate_qr_idempotent_deluxe(deluxe):
    s = deluxe["s"]
    r1 = s.post(f"{API}/items/bulk-generate-qr")
    assert r1.status_code == 200
    r2 = s.post(f"{API}/items/bulk-generate-qr")
    assert r2.status_code == 200
    data = r2.json()
    assert data["items_updated"] == 0
    assert data["sizes_updated"] == 0


def test_bulk_generate_qr_response_shape(deluxe):
    s = deluxe["s"]
    r = s.post(f"{API}/items/bulk-generate-qr")
    assert r.status_code == 200
    data = r.json()
    assert set(["ok", "items_updated", "sizes_updated"]).issubset(data.keys())
    assert isinstance(data["items_updated"], int)
    assert isinstance(data["sizes_updated"], int)


# ---------- Basic: 403 ----------
def test_bulk_generate_qr_basic_403(basic):
    s = basic["s"]
    r = s.post(f"{API}/items/bulk-generate-qr")
    assert r.status_code == 403, r.text
    detail = (r.json().get("detail") or "").lower()
    assert "qr_codes" in detail or "pakken" in detail
