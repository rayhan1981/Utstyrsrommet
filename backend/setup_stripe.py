"""Idempotent Stripe catalog setup for Utstyrsrommet SaaS plans."""
import os
import stripe
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

CURRENCY = "nok"
TAX_CODE = "txcd_10103001"  # SaaS

CATALOG = [
    {
        "emergent_product_id": "utr_basic",
        "name": "Klubb Basic",
        "description": "Grunnleggende lagerstyring - inntil 3 lag, 1 admin",
        "prices": [{"lookup_key": "utr_basic_monthly", "amount": 39900, "interval": "month"}],
    },
    {
        "emergent_product_id": "utr_pro",
        "name": "Klubb Pro",
        "description": "Utvidet lagerstyring - inntil 10 lag, 4 brukere, varetelling & Excel-eksport",
        "prices": [{"lookup_key": "utr_pro_monthly", "amount": 59900, "interval": "month"}],
    },
    {
        "emergent_product_id": "utr_deluxe",
        "name": "Klubb Deluxe",
        "description": "Full pakke - ubegrenset lag, 5 brukere, Excel-import, logo, prioritert support",
        "prices": [{"lookup_key": "utr_deluxe_monthly", "amount": 99900, "interval": "month"}],
    },
    {
        "emergent_product_id": "utr_user_addon",
        "name": "Ekstra bruker",
        "description": "Ekstra bruker-sete i tillegg til pakkens inkluderte brukere",
        "prices": [{"lookup_key": "utr_user_addon_monthly", "amount": 19900, "interval": "month"}],
    },
]


def get_or_create_product(entry):
    for p in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if p.to_dict().get("metadata", {}).get("emergent_product_id") == entry["emergent_product_id"]:
            return p
    return stripe.Product.create(
        name=entry["name"],
        description=entry.get("description"),
        tax_code=TAX_CODE,
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
        kwargs = dict(
            product=product.id,
            unit_amount=p["amount"],
            currency=CURRENCY,
            lookup_key=p["lookup_key"],
            transfer_lookup_key=True,
            recurring={"interval": p["interval"]},
        )
        price = stripe.Price.create(**kwargs)
        print(f"  Price created: {price.id} {p['lookup_key']} {p['amount']/100} {CURRENCY}")
    else:
        print(f"  Price exists: {existing[0].id} {p['lookup_key']}")


for entry in CATALOG:
    product = get_or_create_product(entry)
    print(f"Product: {product.id} - {product.name}")
    for p in entry["prices"]:
        ensure_price(product, p)

print("\nDone.")
