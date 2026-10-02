#!/usr/bin/env python3
"""Backend smoke tests for UTSTYRSROMMET."""
import os
import sys
import io
import requests

BASE = "https://klub-utstyr-admin.preview.emergentagent.com/api"
ADMIN_EMAIL = "raymond.d.hansen@gmail.com"
ADMIN_PASSWORD = "Snowboard1!"

results = {"passed": [], "failed": []}

def rec(name, ok, detail=""):
    (results["passed"] if ok else results["failed"]).append(f"{name}: {detail}")
    print(("PASS " if ok else "FAIL ") + name + " | " + detail)


session = requests.Session()
token = None

# 1) Admin login
try:
    r = session.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    d = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    ok = r.status_code == 200 and "token" in d and "user" in d
    token = d.get("token")
    rec("admin_login", ok, f"status={r.status_code} has_token={bool(token)} user_email={d.get('user',{}).get('email')}")
except Exception as e:
    rec("admin_login", False, str(e)); sys.exit(1)

H = {"Authorization": f"Bearer {token}"} if token else {}

# 2) /auth/me
try:
    r = session.get(f"{BASE}/auth/me", headers=H, timeout=10)
    d = r.json()
    perms = d.get("permissions", [])
    rec("auth_me", r.status_code == 200 and d.get("email") == ADMIN_EMAIL and len(perms) >= 1,
        f"status={r.status_code} role={d.get('role')} perms={len(perms)}")
    super_admin_id = d.get("id")
except Exception as e:
    rec("auth_me", False, str(e)); super_admin_id = None

# 3) Create user (invitation flow)
invitation_token = None
new_user_id = None
try:
    import uuid
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = session.post(f"{BASE}/users", headers=H, json={
        "email": email, "name": "Test User", "role": "user", "permissions": {"items": "view"}
    }, timeout=15)
    d = r.json()
    link = d.get("invitation_link", "")
    # parse token=XXX query param
    import urllib.parse as _up
    if link:
        q = _up.parse_qs(_up.urlparse(link).query)
        invitation_token = q.get("token", [None])[0]
    else:
        invitation_token = d.get("invitation_token")
    new_user_id = d.get("user", {}).get("id") or d.get("id")
    rec("create_user_invite", r.status_code in (200, 201) and bool(invitation_token),
        f"status={r.status_code} has_link={bool(link)}")
except Exception as e:
    rec("create_user_invite", False, str(e))

# 4) Invitation GET + set-password
try:
    if invitation_token:
        r = session.get(f"{BASE}/auth/invitation/{invitation_token}", timeout=10)
        rec("get_invitation", r.status_code == 200, f"status={r.status_code} body={r.text[:120]}")
        r2 = session.post(f"{BASE}/auth/set-password", json={"token": invitation_token, "password": "NewPass123!"}, timeout=10)
        rec("set_password", r2.status_code == 200, f"status={r2.status_code}")
        # Re-login as admin because set-password swapped the session cookie
        session.cookies.clear()
        rr = session.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
        token = rr.json().get("token")
        H["Authorization"] = f"Bearer {token}"
    else:
        rec("get_invitation", False, "no token")
except Exception as e:
    rec("get_invitation", False, str(e))

# 5) Teams CRUD
team_id = None
try:
    r = session.post(f"{BASE}/teams", headers=H, json={"team_name": "Testlag A", "age_class": "2015", "head_coach": {"name": "Coach", "phone": "123"}}, timeout=10)
    d = r.json(); team_id = d.get("id")
    rec("create_team", r.status_code in (200,201) and team_id and d.get("head_coach",{}).get("name")=="Coach", f"status={r.status_code} head_coach={d.get('head_coach')}")
    r = session.get(f"{BASE}/teams", headers=H, timeout=10)
    rec("list_teams", r.status_code == 200 and isinstance(r.json(), list), f"count={len(r.json()) if r.status_code==200 else '?'}")
    r = session.get(f"{BASE}/teams/{team_id}", headers=H, timeout=10)
    d = r.json()
    rec("get_team_debt0", r.status_code == 200 and d.get("debt", -1) == 0, f"debt={d.get('debt')}")
    r = session.put(f"{BASE}/teams/{team_id}", headers=H, json={"team_name": "Testlag B", "age_class": "2015"}, timeout=10)
    rec("update_team", r.status_code == 200 and r.json().get("team_name") == "Testlag B", f"status={r.status_code} body={r.text[:120]}")
except Exception as e:
    rec("teams_crud", False, str(e))

# 6) People
person_id = None
try:
    r = session.post(f"{BASE}/people", headers=H, json={"name": "Ola Nordmann", "team_ids": [team_id] if team_id else []}, timeout=10)
    d = r.json(); person_id = d.get("id")
    rec("create_person", r.status_code in (200,201) and person_id, f"status={r.status_code}")
    r = session.get(f"{BASE}/people/{person_id}", headers=H, timeout=10)
    d = r.json()
    rec("get_person_detail", r.status_code == 200 and "teams" in d and "history" in d, f"keys={list(d.keys())[:8]}")
except Exception as e:
    rec("people", False, str(e))

# 7) Clothing item with sizes
item_id = None
try:
    r = session.post(f"{BASE}/items", headers=H, json={
        "name": "Drakt", "price": 100, "is_clothing": True,
        "sizes": [{"size": "M", "jersey_number": "", "quantity": 5},
                  {"size": "L", "jersey_number": "10", "quantity": 3}]
    }, timeout=10)
    d = r.json(); item_id = d.get("id")
    sizes = d.get("sizes", [])
    jerseys = [s.get("jersey_number") for s in sizes]
    rec("create_clothing_item", r.status_code in (200,201) and item_id and d.get("total_stock") == 8 and "X" in jerseys,
        f"total_stock={d.get('total_stock')} jerseys={jerseys}")
except Exception as e:
    rec("create_clothing_item", False, str(e))

# 8) Loan (loan with price)
loan_id = None
try:
    r = session.post(f"{BASE}/loans", headers=H, json={
        "item_id": item_id, "person_id": person_id, "team_id": team_id,
        "quantity": 2, "size": "M", "mode": "loan"
    }, timeout=10)
    d = r.json(); loan_id = d.get("id")
    rec("create_loan", r.status_code in (200,201) and loan_id and d.get("amount_owed", 0) > 0,
        f"status={r.status_code} amount_owed={d.get('amount_owed')}")
    r = session.get(f"{BASE}/teams/{team_id}", headers=H, timeout=10)
    rec("team_debt_updated", r.json().get("debt", 0) >= 200, f"debt={r.json().get('debt')}")
    r = session.get(f"{BASE}/items", headers=H, timeout=10)
    it = next((x for x in r.json() if x.get("id") == item_id), {})
    m_qty = next((s.get("quantity") for s in it.get("sizes",[]) if s.get("size")=="M"), None)
    rec("stock_reduced_size", m_qty == 3, f"M qty={m_qty}")
except Exception as e:
    rec("create_loan", False, str(e))

# 9) Handout no charge
try:
    r = session.post(f"{BASE}/loans", headers=H, json={
        "item_id": item_id, "person_id": person_id, "team_id": team_id,
        "quantity": 1, "size": "L", "mode": "handout", "charge_price": False
    }, timeout=10)
    d = r.json()
    rec("handout_no_charge", r.status_code in (200,201) and d.get("amount_owed", -1) == 0, f"amount_owed={d.get('amount_owed')}")
except Exception as e:
    rec("handout_no_charge", False, str(e))

# 10) Return loan
try:
    if loan_id:
        r = session.post(f"{BASE}/loans/{loan_id}/return", headers=H, json={"quantity": 2}, timeout=10)
        try: d = r.json()
        except Exception: d = {}
        rec("return_loan", r.status_code == 200 and d.get("status") == "returned" and d.get("amount_owed") == 0,
            f"http={r.status_code} status={d.get('status')} owed={d.get('amount_owed')} body={r.text[:150]}")
except Exception as e:
    rec("return_loan", False, str(e))

# 11) Stock count flow
try:
    r = session.post(f"{BASE}/stock-counts", headers=H, json={"name": "Count A"}, timeout=10)
    sc_id = r.json().get("id")
    rec("stock_count_start", r.status_code in (200,201) and sc_id, f"id={sc_id}")
    if sc_id and item_id:
        r = session.post(f"{BASE}/stock-counts/{sc_id}/lines", headers=H, json={
            "item_id": item_id, "size": "M", "counted_quantity": 99
        }, timeout=10)
        rec("stock_count_line", r.status_code in (200,201), f"status={r.status_code}")
        r = session.post(f"{BASE}/stock-counts/{sc_id}/apply", headers=H, timeout=10)
        rec("stock_count_apply", r.status_code == 200, f"status={r.status_code}")
        r = session.get(f"{BASE}/items", headers=H, timeout=10)
        it = next((x for x in r.json() if x.get("id") == item_id), {})
        m_q = next((s.get("quantity") for s in it.get("sizes",[]) if s.get("size")=="M"), None)
        rec("stock_count_total_updated", m_q == 99, f"M qty after apply={m_q} total={it.get('total_stock')}")
except Exception as e:
    rec("stock_count", False, str(e))

# 12) Exports
try:
    r = session.get(f"{BASE}/export/inventory", headers=H, timeout=15)
    ct = r.headers.get("content-type", "")
    rec("export_inventory_xlsx", r.status_code == 200 and "spreadsheetml" in ct, f"status={r.status_code} ct={ct[:60]} size={len(r.content)}")
    if team_id:
        r = session.get(f"{BASE}/export/team/{team_id}", headers=H, timeout=15)
        ct = r.headers.get("content-type", "")
        rec("export_team_xlsx", r.status_code == 200 and "spreadsheetml" in ct, f"status={r.status_code} ct={ct[:60]}")
except Exception as e:
    rec("exports", False, str(e))

# 13) Dashboard stats
try:
    r = session.get(f"{BASE}/dashboard/stats", headers=H, timeout=10)
    d = r.json()
    required = {"total_items","active_loans","teams","people","team_debt","person_debt","stock_value","low_stock_items","recent_loans"}
    missing = required - set(d.keys())
    rec("dashboard_stats", r.status_code == 200 and not missing, f"missing={missing} keys={sorted(d.keys())[:10]}")
except Exception as e:
    rec("dashboard_stats", False, str(e))

# 14) Super admin cannot be deleted
try:
    if super_admin_id:
        r = session.delete(f"{BASE}/users/{super_admin_id}", headers=H, timeout=10)
        rec("super_admin_undeletable", r.status_code == 403, f"status={r.status_code} body={r.text[:120]}")
except Exception as e:
    rec("super_admin_undeletable", False, str(e))

# 15) Club logo upload
try:
    r = session.get(f"{BASE}/clubs", headers=H, timeout=10)
    clubs = r.json() if r.status_code == 200 else []
    club_id = clubs[0].get("id") if clubs else None
    if not club_id:
        r = session.post(f"{BASE}/clubs", headers=H, json={"name": "Testklubb"}, timeout=10)
        club_id = r.json().get("id")
    # tiny PNG
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082")
    files = {"file": ("logo.png", io.BytesIO(png), "image/png")}
    r = session.post(f"{BASE}/clubs/{club_id}/logo", headers=H, files=files, timeout=15)
    d = r.json() if r.headers.get("content-type","").startswith("application/json") else {}
    url = d.get("logo_url", "")
    rec("club_logo_upload", r.status_code == 200 and url.startswith("data:"), f"status={r.status_code} url_prefix={url[:30]}")
except Exception as e:
    rec("club_logo_upload", False, str(e))

# Cleanup
try:
    if loan_id: session.delete(f"{BASE}/loans/{loan_id}", headers=H, timeout=5)
    if item_id: session.delete(f"{BASE}/items/{item_id}", headers=H, timeout=5)
    if person_id: session.delete(f"{BASE}/people/{person_id}", headers=H, timeout=5)
    if team_id: session.delete(f"{BASE}/teams/{team_id}", headers=H, timeout=5)
    if new_user_id: session.delete(f"{BASE}/users/{new_user_id}", headers=H, timeout=5)
except Exception:
    pass

print("\n=== SUMMARY ===")
print(f"Passed: {len(results['passed'])}")
print(f"Failed: {len(results['failed'])}")
for f in results["failed"]:
    print("  - " + f)
