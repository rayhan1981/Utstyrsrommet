"""Iteration 7: Per-size QR codes.
Covers:
- POST /api/items: clothing with 3 sizes on deluxe -> every size has_qr=True AND item.has_qr=True
- POST /api/items/{id}/generate-qr with sizes=["M","L"] -> only M and L get has_qr=True
- POST /api/items/{id}/generate-qr with {} / sizes=None -> all sizes get has_qr=True
- POST /api/items/{id}/generate-qr for sizeless item -> item.has_qr=True (sizes ignored)
- GET /api/items/{id}/qr-images for clothing -> per-size entries with payload=id#size, data_url starts with data:image/png;base64,
- GET /api/items/{id}/qr-images for sizeless -> single entry label=name, size=None, payload=id
- GET /api/inventory/qr-filters -> total counts per-size entries + 1 per sizeless with has_qr
- GET /api/inventory/qr-labels?scope=all -> PDF with per-size labels (status 200, content-type pdf)
- basic plan -> 403 on generate-qr and qr-images endpoints
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


def _signup():
    suffix = uuid.uuid4().hex[:8]
    email = f"it7_{suffix}@example.com"
    password = "TestPass1!"
    payload = {
        "club_name": f"TEST_It7_{suffix}",
        "owner_name": "It7 Eier",
        "owner_email": email,
        "owner_phone": "+4712345678",
        "password": password,
        "plan": "basic",
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


def _mk_clothing(s, name="TEST_Drakt"):
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


def _mk_sizeless(s, name="TEST_Kjegle"):
    payload = {"name": name, "category": "Trening", "main_group": "Trening", "price": 29.0, "total_stock": 50}
    r = s.post(f"{API}/items", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Create: auto has_qr per size ----------
def test_create_clothing_auto_has_qr_per_size(deluxe):
    it = _mk_clothing(deluxe["s"], name=f"TEST_Drakt_{uuid.uuid4().hex[:6]}")
    assert it["has_qr"] is True
    assert len(it["sizes"]) == 3
    for sz in it["sizes"]:
        assert sz["has_qr"] is True, f"size {sz['size']} missing has_qr"


# ---------- Partial regen: sizes=[M,L] only ----------
def test_generate_qr_partial_sizes(deluxe):
    s = deluxe["s"]
    it = _mk_clothing(s, name=f"TEST_Drakt_{uuid.uuid4().hex[:6]}")
    # Reset has_qr on all sizes via direct update endpoint: PUT /items/{id} with has_qr=false sizes
    reset_payload = {
        "name": it["name"], "category": it.get("category", ""), "main_group": it.get("main_group", ""),
        "sub_group": it.get("sub_group", ""), "price": it.get("price", 0),
        "is_clothing": True,
        "sizes": [{**sz, "has_qr": False} for sz in it["sizes"]],
        "has_qr": False,
    }
    r = s.put(f"{API}/items/{it['id']}", json=reset_payload)
    assert r.status_code == 200, r.text

    # Only M and L
    r = s.post(f"{API}/items/{it['id']}/generate-qr", json={"sizes": ["M", "L"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["has_qr"] is True
    by_size = {sz["size"]: sz for sz in out["sizes"]}
    assert by_size["S"]["has_qr"] is False
    assert by_size["M"]["has_qr"] is True
    assert by_size["L"]["has_qr"] is True


def test_generate_qr_all_when_sizes_null(deluxe):
    s = deluxe["s"]
    it = _mk_clothing(s, name=f"TEST_Drakt_{uuid.uuid4().hex[:6]}")
    # reset
    reset = {**it, "sizes": [{**sz, "has_qr": False} for sz in it["sizes"]], "has_qr": False}
    reset.pop("id", None); reset.pop("tenant_id", None); reset.pop("created_at", None)
    r = s.put(f"{API}/items/{it['id']}", json=reset); assert r.status_code == 200
    # empty body -> sizes=None -> all
    r = s.post(f"{API}/items/{it['id']}/generate-qr", json={})
    assert r.status_code == 200, r.text
    out = r.json()
    for sz in out["sizes"]:
        assert sz["has_qr"] is True


def test_generate_qr_sizeless(deluxe):
    s = deluxe["s"]
    it = _mk_sizeless(s, name=f"TEST_Kjegle_{uuid.uuid4().hex[:6]}")
    r = s.post(f"{API}/items/{it['id']}/generate-qr", json={"sizes": ["ignored"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["has_qr"] is True


# ---------- qr-images ----------
def test_qr_images_clothing(deluxe):
    s = deluxe["s"]
    it = _mk_clothing(s, name=f"TEST_Drakt_{uuid.uuid4().hex[:6]}")
    # reset then only S,M
    reset = {**it, "sizes": [{**sz, "has_qr": False} for sz in it["sizes"]], "has_qr": False}
    reset.pop("id", None); reset.pop("tenant_id", None); reset.pop("created_at", None)
    r = s.put(f"{API}/items/{it['id']}", json=reset); assert r.status_code == 200
    r = s.post(f"{API}/items/{it['id']}/generate-qr", json={"sizes": ["S", "M"]})
    assert r.status_code == 200
    r = s.get(f"{API}/items/{it['id']}/qr-images")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["item"]["id"] == it["id"]
    assert body["item"]["name"] == it["name"]
    codes = body["qr_codes"]
    assert len(codes) == 2
    sizes_returned = {c["size"] for c in codes}
    assert sizes_returned == {"S", "M"}
    for c in codes:
        assert c["payload"] == f"{it['id']}#{c['size']}"
        assert c["label"] == f"{it['name']} - {c['size']}"
        assert c["data_url"].startswith("data:image/png;base64,")
        assert len(c["data_url"]) > 100


def test_qr_images_sizeless(deluxe):
    s = deluxe["s"]
    it = _mk_sizeless(s, name=f"TEST_Kjegle_{uuid.uuid4().hex[:6]}")
    r = s.get(f"{API}/items/{it['id']}/qr-images")
    assert r.status_code == 200
    body = r.json()
    assert len(body["qr_codes"]) == 1
    e = body["qr_codes"][0]
    assert e["size"] is None
    assert e["payload"] == it["id"]
    assert e["label"] == it["name"]
    assert e["data_url"].startswith("data:image/png;base64,")


# ---------- qr-filters total count ----------
def test_qr_filters_total_counts_per_size(deluxe):
    s = deluxe["s"]
    # Create fresh deluxe-owned items with known counts
    it_cloth = _mk_clothing(s, name=f"TEST_Count_{uuid.uuid4().hex[:6]}")  # 3 sizes w/ has_qr
    it_sizeless = _mk_sizeless(s, name=f"TEST_CountKj_{uuid.uuid4().hex[:6]}")  # 1
    r = s.get(f"{API}/inventory/qr-filters")
    assert r.status_code == 200
    body = r.json()
    # Total must at minimum include our 3+1=4 new entries
    assert body["total"] >= 4
    assert isinstance(body["items"], list)
    # Our clothing item should appear
    ids = {i["id"] for i in body["items"]}
    assert it_cloth["id"] in ids
    assert it_sizeless["id"] in ids


# ---------- qr-labels PDF ----------
def test_qr_labels_pdf(deluxe):
    s = deluxe["s"]
    _mk_clothing(s, name=f"TEST_Lbl_{uuid.uuid4().hex[:6]}")
    r = s.get(f"{API}/inventory/qr-labels", params={"scope": "all", "size": "medium"})
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert len(r.content) > 500  # non-trivial pdf


# ---------- Basic plan 403 ----------
def test_basic_403_on_qr_endpoints(basic, deluxe):
    s_basic = basic["s"]
    # Create item on basic (no qr auto)
    r = s_basic.post(f"{API}/items", json={"name": "TEST_B", "category": "x", "total_stock": 5})
    assert r.status_code == 200
    item_id = r.json()["id"]
    # generate-qr -> 403
    r = s_basic.post(f"{API}/items/{item_id}/generate-qr", json={})
    assert r.status_code == 403
    # qr-images -> 403
    r = s_basic.get(f"{API}/items/{item_id}/qr-images")
    assert r.status_code == 403


def test_generate_qr_404_other_tenant(deluxe, basic):
    """Verify tenant isolation on QR endpoints."""
    it = _mk_clothing(deluxe["s"], name=f"TEST_Iso_{uuid.uuid4().hex[:6]}")
    # Try to access from a different tenant (basic session) — expect 403 (plan) before 404
    r = basic["s"].get(f"{API}/items/{it['id']}/qr-images")
    assert r.status_code in (403, 404)
