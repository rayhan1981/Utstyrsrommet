"""Iteration 5 backend tests: loans due_in_days, extend, notifications,
invoices (create/pdf/send), QR labels, club bank/kid fields."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio


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


def _mongo():
    return AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[
        os.environ.get("DB_NAME", "utstyrsrommet_db")
    ]


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def tenant(owner_session):
    suffix = uuid.uuid4().hex[:8]
    email = f"it5_{suffix}@example.com"
    password = "TestPass1!"
    payload = {
        "club_name": f"TEST_It5_{suffix}", "owner_name": "It5 Eier",
        "owner_email": email, "owner_phone": "+4712345678",
        "password": password, "plan": "basic", "accept_terms": True,
    }
    r = requests.post(f"{API}/signup", json=payload)
    assert r.status_code == 200, r.text
    cid = r.json()["customer"]["id"]
    owner_session.patch(f"{API}/owner/customers/{cid}", json={"plan": "deluxe", "status": "active"})
    s = requests.Session()
    lr = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert lr.status_code == 200
    data = lr.json()
    s.headers.update({"Authorization": f"Bearer {data['token']}"})
    yield {"s": s, "email": email, "password": password, "cid": cid, "user_id": data["user"]["id"]}
    try:
        owner_session.delete(f"{API}/owner/customers/{cid}")
    except Exception:
        pass


def _make_entities(s, charge=True):
    rt = s.post(f"{API}/teams", json={"team_name": f"TEST_T_{uuid.uuid4().hex[:5]}", "email": "team@test.no"})
    team = rt.json()
    rp = s.post(f"{API}/people", json={"name": f"TEST_P_{uuid.uuid4().hex[:5]}",
                                        "email": "p@test.no", "team_ids": [team["id"]]})
    person = rp.json()
    ri = s.post(f"{API}/items", json={"name": f"TEST_I_{uuid.uuid4().hex[:5]}",
                                       "price": 100.0, "total_stock": 20, "location": "X"})
    item = ri.json()
    return team, person, item


# ---------- Loans due_in_days ----------
class TestLoanDueInDays:
    @pytest.mark.parametrize("days", [7, 14, 30])
    def test_create_loan_sets_due_date(self, tenant, days):
        s = tenant["s"]
        team, person, item = _make_entities(s)
        r = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "person_id": person["id"],
            "mode": "loan", "charge_price": True, "loan_target": "person",
            "due_in_days": days,
        })
        assert r.status_code == 200, r.text
        loan = r.json()
        assert loan["due_in_days"] == days
        assert loan["due_date"]
        loan_dt = datetime.fromisoformat(loan["loan_date"].replace("Z", "+00:00"))
        due_dt = datetime.fromisoformat(loan["due_date"].replace("Z", "+00:00"))
        diff_days = (due_dt - loan_dt).total_seconds() / 86400
        assert abs(diff_days - days) < 0.1, f"diff={diff_days} vs {days}"


# ---------- Extend ----------
class TestExtendDueDate:
    def test_extend_updates_due_date_and_history(self, tenant):
        s = tenant["s"]
        team, person, item = _make_entities(s)
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "person_id": person["id"],
            "mode": "loan", "charge_price": True, "loan_target": "person",
            "due_in_days": 7,
        })
        assert rl.status_code == 200
        loan_id = rl.json()["id"]
        before = datetime.now(timezone.utc)
        r = s.post(f"{API}/loans/{loan_id}/extend", json={"due_in_days": 30})
        assert r.status_code == 200, r.text
        new_due = datetime.fromisoformat(r.json()["due_date"].replace("Z", "+00:00"))
        delta_days = (new_due - before).total_seconds() / 86400
        assert 29.5 < delta_days < 30.5

        # Verify via mongo that due_date_history and overdue_dismissed_at updated
        async def check():
            db = _mongo()
            ln = await db.loans.find_one({"id": loan_id})
            assert ln["due_in_days"] == 30
            assert ln.get("overdue_dismissed_at") is None
            assert isinstance(ln.get("due_date_history"), list)
            assert len(ln["due_date_history"]) >= 1
        asyncio.get_event_loop().run_until_complete(check())

    def test_extend_rejects_invalid_days(self, tenant):
        s = tenant["s"]
        _, person, item = _make_entities(s)
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "person_id": person["id"],
            "mode": "loan", "charge_price": True, "loan_target": "person",
            "due_in_days": 7,
        })
        loan_id = rl.json()["id"]
        r = s.post(f"{API}/loans/{loan_id}/extend", json={"due_in_days": 5})
        assert r.status_code == 400


# ---------- Notifications ----------
class TestNotifications:
    def test_notifications_overdue_and_dismiss(self, tenant):
        s = tenant["s"]
        _, person, item = _make_entities(s)
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "person_id": person["id"],
            "mode": "loan", "charge_price": True, "loan_target": "person",
            "due_in_days": 7,
        })
        loan_id = rl.json()["id"]
        tid = tenant["cid"]

        async def _set_overdue():
            db = _mongo()
            past = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
            await db.loans.update_one({"id": loan_id}, {"$set": {
                "due_date": past, "overdue_dismissed_at": None
            }})
        asyncio.get_event_loop().run_until_complete(_set_overdue())

        r = s.get(f"{API}/notifications")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "overdue" in d and "unseen" in d and "unseen_count" in d
        assert any(ln["id"] == loan_id for ln in d["overdue"]), f"loan not in overdue list"
        assert d["unseen_count"] >= 1

        # Dismiss
        r = s.post(f"{API}/notifications/dismiss")
        assert r.status_code == 200
        r = s.get(f"{API}/notifications")
        d = r.json()
        # overdue still listed, but unseen_count should drop (for this loan)
        unseen_ids = [ln["id"] for ln in d["unseen"]]
        assert loan_id not in unseen_ids


# ---------- Invoices ----------
class TestInvoices:
    def test_create_invoice_pdf_and_fields(self, tenant):
        s = tenant["s"]
        _, person, item = _make_entities(s)
        # Create two loans, one with amount, one handout (should be ignored if 0)
        rl1 = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 2, "person_id": person["id"],
            "mode": "loan", "charge_price": True, "loan_target": "person",
            "due_in_days": 14,
        })
        assert rl1.status_code == 200
        loan1 = rl1.json()
        rl2 = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "person_id": person["id"],
            "mode": "handout", "charge_price": False, "loan_target": "person",
            "due_in_days": 14,
        })
        loan2 = rl2.json()
        # loan2 has amount_owed=0 → should be filtered out
        r = s.post(f"{API}/invoices", json={
            "person_id": person["id"],
            "loan_ids": [loan1["id"], loan2["id"]],
            "due_in_days": 14, "notes": "test faktura",
        })
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["invoice_number"]
        assert inv["kid"]  # customer_number + invoice_number
        assert inv["invoice_number"] in inv["kid"]
        assert inv["total"] == 200.0  # 2 x 100
        assert len(inv["lines"]) == 1  # loan2 filtered out
        assert inv["lines"][0]["loan_id"] == loan1["id"]

        # GET PDF
        pdf_r = s.get(f"{API}/invoices/{inv['id']}/pdf")
        assert pdf_r.status_code == 200
        assert pdf_r.headers.get("content-type", "").startswith("application/pdf")
        assert pdf_r.content[:4] == b"%PDF"

    def test_create_invoice_empty_lines_rejected(self, tenant):
        s = tenant["s"]
        _, person, item = _make_entities(s)
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "person_id": person["id"],
            "mode": "handout", "charge_price": False, "loan_target": "person",
            "due_in_days": 7,
        })
        loan = rl.json()
        r = s.post(f"{API}/invoices", json={
            "person_id": person["id"], "loan_ids": [loan["id"]],
            "due_in_days": 14, "notes": "",
        })
        # All lines amount=0 → 400
        assert r.status_code == 400

    def test_send_invoice_endpoint_exists(self, tenant):
        s = tenant["s"]
        _, person, item = _make_entities(s)
        rl = s.post(f"{API}/loans", json={
            "item_id": item["id"], "quantity": 1, "person_id": person["id"],
            "mode": "loan", "charge_price": True, "loan_target": "person",
            "due_in_days": 7,
        })
        loan = rl.json()
        r = s.post(f"{API}/invoices", json={
            "person_id": person["id"], "loan_ids": [loan["id"]],
            "due_in_days": 14, "notes": "",
        })
        assert r.status_code == 200
        inv = r.json()
        # Send - email configured, may succeed or 500. Both acceptable; 404/405 not acceptable
        r = s.post(f"{API}/invoices/{inv['id']}/send", json={"email": "test@example.no"})
        assert r.status_code in (200, 500), f"Unexpected status: {r.status_code} {r.text}"


# ---------- QR Labels ----------
class TestQrLabels:
    def test_qr_labels_pdf(self, tenant):
        s = tenant["s"]
        # Ensure at least one item exists
        s.post(f"{API}/items", json={
            "name": f"TEST_QR_{uuid.uuid4().hex[:5]}", "price": 10.0,
            "total_stock": 1, "location": "A",
        })
        r = s.get(f"{API}/inventory/qr-labels")
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"


# ---------- Club fields ----------
class TestClubFields:
    def test_club_bank_and_kid_fields(self, tenant):
        s = tenant["s"]
        rc = s.post(f"{API}/clubs", json={"name": f"TEST_Club_{uuid.uuid4().hex[:5]}"})
        assert rc.status_code == 200, rc.text
        club = rc.json()
        r = s.put(f"{API}/clubs/{club['id']}", json={
            "name": club["name"],
            "org_number": "123456789",
            "bank_account": "1234.56.78901",
            "kid_prefix": "KID",
        })
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated.get("bank_account") == "1234.56.78901"
        assert updated.get("kid_prefix") == "KID"
