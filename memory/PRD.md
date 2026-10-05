# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe), plattformeier-impersonering, QR-skanning, varsler og faktura-generering. App heter «UTSTYRSROMMET».

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT, Resend/Emergent email, reportlab (PDF), qrcode + PIL (QR + logo overlay)
- Frontend: React 19 + shadcn/ui + Tailwind, Sonner, html5-qrcode
- Multi-tenancy: `tenant_id` på alle data, platform_owner kan impersonere
- Stripe Billing: Checkout, add-on seats, 50% kupong første år, webhooks

## Users
- Platform Owner: raymond.d.hansen@gmail.com (ikke slettbar, deluxe-workspace)
- Admin per kunde: full tilgang
- Standard brukere: rettigheter per modul (none/read/write/admin)

## Plans
- `free`: KUN manuell tildeling av plattformeier – skjult fra /plans og signup
- `basic` 399/mnd / `pro` 599/mnd / `deluxe` 999/mnd
- **QR-koder og QR-skanning: Deluxe-eksklusivt**

## Implemented
### Feb 2026
- JWT auth, Resend invitasjon, ToS, rettighetsmatrise, lag/personer/varer/utlån/varetelling, Excel inn/ut, Stripe, universell DataTable

### Okt 2026
- Plattformeier kundeadmin (3-fane modal, soft-delete m/ 12-mnd purge)
- Varetelling forhåndsutfylt m/ dato pr linje
- Grupperings-visning på DataTable
- Loan-target (Person/Lag), hurtig Lån ut, Lag-detalj
- Trenerfjerning fjerner team_id fra personens team_ids
- Brukere: online/offline, siste pålogging, login-historikk
- Varsler: forfallsdato (7/14/30), bjelle m/teller, påtrengende popup m/ Forleng frist
- Faktura: valgbare linjer, PDF, email, bank/KID

### Okt 2026 – QR-koder (Deluxe)
- `qr_codes` feature på deluxe. Basic/pro: 403. «Skann QR» nav + /app/skann gated.
- **Per-størrelse QR**: SizeStock.has_qr. For klær/ball får hver størrelse sin egen unike QR-kode (payload `item_id#size`). Scanner parser format og forhåndsutfyller str.
- **Generer QR-dialog**: for sized-varer kommer dialog med «Alle»-checkbox + str-sjekkbokser; velg hvilke str du vil generere. Sizeless-varer: direkte generering.
- **Vis QR-dialog**: øye-ikon vises når varen har ≥1 aktiv QR. Åpner grid med alle genererte QR-bilder (base64 data-URL) + «Skriv ut»-knapp (åpner printbar HTML).
- **Auto-QR ved opprettelse**: nye varer på Deluxe får has_qr=true (sizeless: item-level, sized: hver str + aggregert item-level).
- **QR-eksport-dialog**: scope (alle/vare/hovedgruppe/undergruppe) + størrelse (2/6/10 cm). PDF genereres med én etikett pr aktiv størrelse (ikke én pr vare). Klubblogo bakes i QR-senter med PIL.
- Endpoints: `POST /items/{id}/generate-qr {sizes?}`, `GET /items/{id}/qr-images`, `GET /inventory/qr-filters`, `GET /inventory/qr-labels?scope&value&size`

## Backlog
- P1: Excel Import for Teams og People
- P1: Automatisk fakturakvittering ved Stripe-betaling
- P1: CTA-oppgraderingsbanner (gir Deluxe-oppfordring når basic/pro-bruker treffer QR-vegg)
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P1: Bulk-generer QR for alle eksisterende varer uten `has_qr`
- P2: KID med MOD10/MOD11 kontrollsiffer
- P2: Faktura-PDF til GridFS
- P2: QR-labels bakgrunnsjobb for store beholdninger
- P2: TTL-index på login_history
- P2: Background purge-task for `purge_at < now`
- P2: Global hurtigsøk Ctrl+K
- Refactor: splitt /app/backend/server.py i routers
