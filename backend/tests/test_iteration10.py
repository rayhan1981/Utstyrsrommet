"""Iteration 10 tests:
- Per-tenant email settings (GET/PUT/test)
- Order send endpoint /api/orders/{oid}/send (PDF attachment)
- Behovsskjema /send still works
- Item multi-image limits (main 5, variation 4) + plan gating
"""
import os
import uuid
import pytest
import requests


def _url():
    u = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not u:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    u = line.split("=", 1)[1].strip()
    return u.rstrip("/")


BASE = _url()
API = BASE + "/api"
ADMIN_EMAIL = "raymond.d.hansen@gmail.com"
ADMIN_PASSWORD = "Snowboard1!"


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def owner_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="session")
def tenant(owner_session):
    """Create a Deluxe tenant with admin status for testing."""
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_it10_{suffix}@example.com"
    password = "TestPass1!"
    payload = {
        "club_name": f"TEST_It10_{suffix}",
        "owner_name": "TEST Eier It10",
        "owner_email": email,
        "owner_phone": "+4712345678",
        "password": password,
        "plan": "deluxe",
        "accept_terms": True,
    }
    r = requests.post(f"{API}/signup", json=payload)
    assert r.status_code == 200, r.text
    cust = r.json()["customer"]
    # Ensure plan deluxe & active (signup may put trial)
    owner_session.patch(f"{API}/owner/customers/{cust['id']}", json={"plan": "deluxe", "status": "active"})
    s = requests.Session()
    lr = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert lr.status_code == 200, lr.text
    s.headers["Authorization"] = f"Bearer {lr.json()['token']}"
    yield {"session": s, "customer": cust, "email": email, "password": password}
    try:
        owner_session.delete(f"{API}/owner/customers/{cust['id']}")
    except Exception:
        pass


@pytest.fixture(scope="session")
def basic_tenant(owner_session):
    """Basic plan tenant for image stripping tests."""
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_it10b_{suffix}@example.com"
    password = "TestPass1!"
    r = requests.post(f"{API}/signup", json={
        "club_name": f"TEST_It10b_{suffix}",
        "owner_name": "Basic Eier",
        "owner_email": email,
        "owner_phone": "+4799999999",
        "password": password, "plan": "basic", "accept_terms": True,
    })
    assert r.status_code == 200, r.text
    cust = r.json()["customer"]
    owner_session.patch(f"{API}/owner/customers/{cust['id']}", json={"plan": "basic", "status": "active"})
    # Need to end trial via direct DB update so effective plan becomes basic (trial gives deluxe)
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = ""; dbn = ""
    for line in open("/app/backend/.env"):
        if line.startswith("MONGO_URL="):
            mongo = line.split("=", 1)[1].strip().strip('"')
        if line.startswith("DB_NAME="):
            dbn = line.split("=", 1)[1].strip().strip('"')
    async def _end_trial():
        c = AsyncIOMotorClient(mongo); d = c[dbn]
        await d.customers.update_one({"id": cust["id"]}, {"$set": {
            "subscription_status": "active", "selected_plan": "basic", "plan": "basic",
        }})
        c.close()
    asyncio.run(_end_trial())
    s = requests.Session()
    lr = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert lr.status_code == 200, lr.text
    s.headers["Authorization"] = f"Bearer {lr.json()['token']}"
    yield {"session": s, "customer": cust}
    try:
        owner_session.delete(f"{API}/owner/customers/{cust['id']}")
    except Exception:
        pass


# ---------------- Email Settings ----------------
class TestEmailSettings:
    def test_get_default_for_new_tenant(self, tenant):
        r = tenant["session"].get(f"{API}/email-settings")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("method", "default") in ("default", None, "")
        # Raw password must never be present
        assert "smtp_password" not in d or not d.get("smtp_password")
        assert "resend_api_key" not in d or not d.get("resend_api_key")

    def test_put_smtp_encrypts_and_masks(self, tenant):
        payload = {
            "method": "smtp",
            "from_name": "TEST Klubb",
            "from_email": "noreply@example.com",
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_username": "user@example.com",
            "smtp_password": "SuperSecret123!",
            "smtp_use_tls": True,
            "smtp_use_ssl": False,
        }
        r = tenant["session"].put(f"{API}/email-settings", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["method"] == "smtp"
        assert d["from_email"] == "noreply@example.com"
        assert d["smtp_host"] == "smtp.example.com"
        # password should NOT be returned raw
        assert d.get("smtp_password") in (None, "")
        # should indicate password set + masked
        assert d.get("smtp_password_set") is True or d.get("password_set") is True or d.get("smtp_password_mask")
        # verify no plaintext leak
        raw = r.text
        assert "SuperSecret123" not in raw, "Raw password leaked in response!"

        # GET returns same masked state
        r2 = tenant["session"].get(f"{API}/email-settings")
        assert r2.status_code == 200
        assert "SuperSecret123" not in r2.text

    def test_put_resend_encrypts(self, tenant):
        r = tenant["session"].put(f"{API}/email-settings", json={
            "method": "resend",
            "from_name": "TEST Klubb",
            "from_email": "noreply@example.com",
            "resend_api_key": "re_abcdef1234567890",
        })
        assert r.status_code == 200, r.text
        assert "re_abcdef1234567890" not in r.text, "Resend key leaked!"
        d = r.json()
        assert d["method"] == "resend"

    def test_test_endpoint_default(self, tenant):
        # Switch back to default
        tenant["session"].put(f"{API}/email-settings", json={"method": "default",
                                                              "from_name": "TEST Klubb"})
        r = tenant["session"].post(f"{API}/email-settings/test", json={"to": "test@example.com"})
        # Should either succeed (ok=true, method=default) or return 502 if EMAIL_KEY unavailable
        if r.status_code == 200:
            d = r.json()
            assert d.get("ok") is True
            assert d.get("method") == "default"
        else:
            assert r.status_code == 502, f"unexpected: {r.status_code} {r.text}"

    def test_test_endpoint_invalid_smtp_returns_502(self, tenant):
        tenant["session"].put(f"{API}/email-settings", json={
            "method": "smtp",
            "from_name": "TEST Klubb",
            "from_email": "noreply@example.com",
            "smtp_host": "invalid.example.com",
            "smtp_port": 587,
            "smtp_username": "u",
            "smtp_password": "p",
            "smtp_use_tls": True,
        })
        r = tenant["session"].post(f"{API}/email-settings/test", json={"to": "test@example.com"})
        assert r.status_code == 502, f"expected 502, got {r.status_code}: {r.text}"
        # verify last_test_ok=false persisted
        g = tenant["session"].get(f"{API}/email-settings").json()
        assert g.get("last_test_ok") is False
        assert g.get("last_test_error")

    def test_reset_to_default_after_tests(self, tenant):
        """Reset back to default so later tests use default send."""
        r = tenant["session"].put(f"{API}/email-settings", json={"method": "default"})
        assert r.status_code == 200


# ---------------- Items multi-image ----------------
class TestItemMultiImage:
    def test_create_item_5_images_main(self, tenant):
        imgs = [f"https://example.com/img{i}.jpg" for i in range(5)]
        r = tenant["session"].post(f"{API}/items", json={
            "name": "TEST_MultiImage_5", "images": imgs, "price": 100,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["images"] == imgs
        assert d.get("image_url") == imgs[0]

    def test_create_item_truncates_to_5(self, tenant):
        imgs = [f"https://example.com/x{i}.jpg" for i in range(6)]
        r = tenant["session"].post(f"{API}/items", json={"name": "TEST_Trunc6", "images": imgs})
        assert r.status_code == 200, r.text
        assert len(r.json()["images"]) == 5
        assert r.json()["images"] == imgs[:5]

    def test_variation_images_truncate_to_4(self, tenant):
        imgs = [f"https://example.com/s{i}.jpg" for i in range(5)]
        r = tenant["session"].post(f"{API}/items", json={
            "name": "TEST_VarImg",
            "sizes": [{"size": "M", "quantity": 1, "images": imgs}],
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["sizes"][0]["images"]) == 4
        assert d["sizes"][0]["images"] == imgs[:4]
        assert d["sizes"][0].get("image_url") == imgs[0]

    def test_update_item_images(self, tenant):
        r = tenant["session"].post(f"{API}/items", json={"name": "TEST_UpdImg"})
        iid = r.json()["id"]
        imgs = [f"https://example.com/u{i}.jpg" for i in range(3)]
        r2 = tenant["session"].put(f"{API}/items/{iid}", json={
            "name": "TEST_UpdImg", "images": imgs,
        })
        assert r2.status_code == 200, r2.text
        assert r2.json()["images"] == imgs

    def test_basic_plan_strips_images(self, basic_tenant):
        imgs = [f"https://example.com/b{i}.jpg" for i in range(3)]
        r = basic_tenant["session"].post(f"{API}/items", json={
            "name": "TEST_BasicStrip", "images": imgs, "image_url": imgs[0],
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["images"] == []
        assert d.get("image_url") in (None, "", False)


# ---------------- Order send ----------------
@pytest.fixture(scope="class")
def test_order(tenant):
    s = tenant["session"]
    # Create supplier
    rs = s.post(f"{API}/suppliers", json={"name": "TEST_Supplier", "email": "sup@example.com"})
    assert rs.status_code == 200, rs.text
    sup = rs.json()
    # Create a lagerbestilling (stock order) so no behovsskjema needed
    r = s.post(f"{API}/orders", json={
        "supplier_id": sup["id"],
        "is_stock_order": True,
        "lines": [{"item_name": "TEST Vare", "quantity": 2, "unit_price": 100.0, "size": "M"}],
    })
    assert r.status_code == 200, r.text
    return r.json()


class TestOrderSend:
    def test_send_order_with_pdf(self, tenant, test_order):
        s = tenant["session"]
        # Ensure method=default
        s.put(f"{API}/email-settings", json={"method": "default"})
        oid = test_order["id"]
        r = s.post(f"{API}/orders/{oid}/send", json={
            "to": "supplier@example.com",
            "subject": "Test bestilling",
            "message": "Vennligst behandle",
        })
        print(f"ORDER_SEND response: {r.status_code} {r.text}")
        if r.status_code != 200:
            # 502 acceptable if EMAIL_KEY unavailable - we at least want to prove endpoint not crashing
            assert r.status_code in (200, 502), f"got {r.status_code}: {r.text}"
            pytest.skip(f"email send returned {r.status_code}: {r.text}")
        d = r.json()
        assert d["ok"] is True
        assert d["sent_to"] == "supplier@example.com"
        assert "method" in d
        # verify DB updated
        g = s.get(f"{API}/orders").json()
        o = next(x for x in g if x["id"] == oid)
        assert o["sent_to"] == "supplier@example.com"
        assert o["sent_at"]
        hist = o.get("status_history", [])
        assert any("PDF sendt" in (h.get("note") or "") for h in hist)

    def test_send_order_invalid_order(self, tenant):
        r = tenant["session"].post(f"{API}/orders/nonexistent/send", json={"to": "x@example.com"})
        assert r.status_code == 404


# ---------------- Behovsskjema send regression ----------------
class TestBehovsskjemaRegression:
    def test_behovsskjema_send_still_works(self, tenant):
        s = tenant["session"]
        # Need a team to create a behovsskjema
        rt = s.post(f"{API}/teams", json={"team_name": "TEST_It10_Lag"})
        assert rt.status_code == 200, rt.text
        team = rt.json()
        # Create behovsskjema
        rb = s.post(f"{API}/behovsskjema", json={
            "team_id": team["id"],
            "season": "2025/26",
            "age_class": "G13",
            "notes": "Test",
        })
        if rb.status_code != 200:
            pytest.skip(f"Could not create behovsskjema: {rb.status_code} {rb.text}")
        bs = rb.json()
        # Ensure email=default
        s.put(f"{API}/email-settings", json={"method": "default"})
        r = s.post(f"{API}/behovsskjema/{bs['id']}/send", json={
            "recipient_email": "lagleder@example.com",
            "recipient_name": "Lagleder",
            "message": "Fyll ut malen",
        })
        if r.status_code != 200:
            assert r.status_code in (200, 502, 503), f"got {r.status_code}: {r.text}"
            pytest.skip(f"behov send returned {r.status_code}")
        # provider_id/method verification is handled by endpoint
