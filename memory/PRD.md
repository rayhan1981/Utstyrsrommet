# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe), plattformeier-impersonering, QR-skanning, varsler og faktura-generering. App heter «UTSTYRSROMMET».

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT (12h cookie + Bearer), Resend, reportlab (PDF), qrcode + PIL (QR gen + logo overlay)
- Frontend: React 19 + React Router + shadcn/ui + Tailwind, Sonner, html5-qrcode (mobil kamera-skanning)
- Multi-tenancy: `tenant_id` på alle data, platform_owner kan impersonere via `imp_cid`-cookie
- Stripe Billing: Checkout (mnd/år), add-on seats, 50% kupong første år, webhooks

## Users
- Platform Owner: raymond.d.hansen@gmail.com (ikke slettbar, kundenr 000001, eget deluxe-workspace)
- Admin per kunde: full tilgang
- Standard brukere: individuelle rettigheter per modul (none/read/write/admin)

## Plans
- `free`: KUN manuell tildeling av plattformeier – skjult fra /api/plans og signup
- `basic` 399/mnd / `pro` 599/mnd / `deluxe` 999/mnd
- **QR-koder og QR-skanning er Deluxe-eksklusivt**

## Implemented
### Feb 2026
- JWT auth, invitasjons-epost via Resend, Terms of Service
- Rettighetsmatrise per modul, admin-seeding ikke-slettbar
- Lag/Personer/Varer/Utlån/Retur/Varetelling/Excel-eksport+import
- Stripe Checkout + add-on seats + plattformeier impersonering
- Universell DataTable (søk, sort, filter)

### Okt 2026 – Kundeadmin + varetelling
- Plattformeier kundeadmin (3-fane modal, soft-delete m/ 12-mnd purge)
- Varetelling forhåndsutfylt + inline-input + dato/tid pr linje
- Grupperings-visning på DataTable
- Loan-target styring (Person vs Lag)
- Hurtig Lån ut-knapp på Personer og Lag
- Lag-detaljvisning med personer + historikk
- Trenerfjerning fjerner team_id fra personens team_ids
- Brukeradministrasjon: online/offline + siste pålogging + login-historikk

### Okt 2026 – Varsler + Faktura
- Forfallsdato (7/14/30 dager) på utlån, bjelle-ikon m/teller
- Påtrengende popup for forfalte utlån m/ «Forleng frist»
- Faktura-generering: valgbare linjer, PDF (reportlab), send via email
- Klubbinnstillinger: bankkontonr + KID-prefix

### Okt 2026 – QR-koder (Deluxe) [denne økten]
- **Deluxe-eksklusivt**: `qr_codes: true` i deluxe-plan, 403 for basic/pro, nav + routes gated
- **Auto-QR ved opprettelse**: nye varer får `has_qr=true` på Deluxe
- **Generer QR per vare**: knapp per rad for eksisterende varer (deluxe + inventory:write). Grønt QR-ikon når aktiv.
- **QR-eksport-dialog**: scope (alle/vare/hovedgruppe/undergruppe) + størrelse (small 2cm/medium 6cm/large 10cm)
- **Logo-overlay i QR-senter**: klubblogo pastes automatisk i senter m/ error correction H, varenavn alltid under
- Endpoints: `POST /items/{id}/generate-qr`, `GET /inventory/qr-filters`, `GET /inventory/qr-labels?scope&value&size`

## Backlog (P1/P2)
- P1: Excel Import for Teams og People
- P1: Automatisk fakturakvittering ved Stripe-betaling
- P1: CTA-oppgraderingsbanner når kunde når pakkegrenser (inkl. QR-tilgang)
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P2: KID-nummer med MOD10/MOD11 kontrollsiffer
- P2: Faktura-PDF til GridFS (nå base64 i doc)
- P2: QR-labels bakgrunnsjobb for store beholdninger (nå sync)
- P2: TTL-index på `login_history`
- P2: Background purge-task for `purge_at < now`
- P2: Global hurtigsøk Ctrl+K
- Refactor: splitt /app/backend/server.py (~2234 linjer) i routers (invoices, notifications, loans, qr)
