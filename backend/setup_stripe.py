"""Idempotent Stripe catalog setup for Utstyrsrommet SaaS plans + yearly coupons."""
import os
import stripe
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

CURRENCY = "nok"
TAX_CODE = "txcd_10103001"

CATALOG = [
    {
        "emergent_product_id": "utr_basic", "name": "Klubb Basic",
        "description": "Grunnleggende lagerstyring - inntil 3 lag, 1 admin",
        "prices": [
            {"lookup_key": "utr_basic_monthly", "amount": 39900, "interval": "month"},
            {"lookup_key": "utr_basic_yearly", "amount": 39900 * 12, "interval": "year"},
        ],
    },
    {
        "emergent_product_id": "utr_pro", "name": "Klubb Pro",
        "description": "Utvidet lagerstyring - inntil 10 lag, 4 brukere, varetelling & Excel-eksport",
        "prices": [
            {"lookup_key": "utr_pro_monthly", "amount": 59900, "interval": "month"},
            {"lookup_key": "utr_pro_yearly", "amount": 59900 * 12, "interval": "year"},
        ],
    },
    {
        "emergent_product_id": "utr_deluxe", "name": "Klubb Deluxe",
        "description": "Full pakke - ubegrenset lag, 5 brukere, Excel-import, logo, prioritert support",
        "prices": [
            {"lookup_key": "utr_deluxe_monthly", "amount": 99900, "interval": "month"},
            {"lookup_key": "utr_deluxe_yearly", "amount": 99900 * 12, "interval": "year"},
        ],
    },
    {
        "emergent_product_id": "utr_user_addon", "name": "Ekstra bruker",
        "description": "Ekstra bruker-sete i tillegg til pakkens inkluderte brukere",
        "prices": [{"lookup_key": "utr_user_addon_monthly", "amount": 19900, "interval": "month"}],
    },
]

COUPONS = [
    {"id": "UTR_YEARLY_50_FIRST", "percent_off": 50, "duration": "once",
     "name": "Første år 50% rabatt (årlig)"},
    {"id": "UTR_YEARLY_10_LOYAL", "percent_off": 10, "duration": "forever",
     "name": "Lojalitet 10% rabatt (årlig)"},
]


def get_or_create_product(entry):
    for p in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if p.metadata.get("emergent_product_id") == entry["emergent_product_id"]:
            return p
    return stripe.Product.create(
        name=entry["name"], description=entry.get("description"), tax_code=TAX_CODE,
        metadata={"managed_by": "emergent", "emergent_product_id": entry["emergent_product_id"]},
    )


def ensure_price(product, p):
    existing = stripe.Price.list(lookup_keys=[p["lookup_key"]], active=True, limit=1).data
    if existing:
        ex = existing[0]
        if ex.unit_amount != p["amount"] or ex.currency != CURRENCY:
            stripe.Price.modify(ex.id, active=False)
            existing = []
    if not existing:
        price = stripe.Price.create(
            product=product.id, unit_amount=p["amount"], currency=CURRENCY,
            lookup_key=p["lookup_key"], transfer_lookup_key=True,
            recurring={"interval": p["interval"]},
        )
        print(f"  Price created: {price.id} {p['lookup_key']}")
    else:
        print(f"  Price exists: {existing[0].id} {p['lookup_key']}")


def ensure_coupon(c):
    try:
        stripe.Coupon.retrieve(c["id"])
        print(f"Coupon exists: {c['id']}")
    except stripe.error.InvalidRequestError:
        stripe.Coupon.create(id=c["id"], percent_off=c["percent_off"],
                             duration=c["duration"], name=c["name"], currency=CURRENCY)
        print(f"Coupon created: {c['id']}")


for entry in CATALOG:
    product = get_or_create_product(entry)
    print(f"Product: {product.id} - {product.name}")
    for p in entry["prices"]:
        ensure_price(product, p)

for c in COUPONS:
    ensure_coupon(c)

print("\nDone.")
