# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe), plattformeier-impersonering, QR-skanning, varsler og faktura-generering.

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT, Resend/Emergent email, reportlab (PDF), qrcode + PIL
- Frontend: React 19 + shadcn/ui + Tailwind, Sonner, html5-qrcode
- Multi-tenancy: `tenant_id` på alle data, platform_owner kan impersonere
- Stripe Billing: Checkout, add-on seats, 50% kupong første år

## Users
- Platform Owner: raymond.d.hansen@gmail.com (deluxe-workspace)
- Admin per kunde: full tilgang
- Standard brukere: rettigheter per modul

## Plans
- `free`: Manuell tildeling av plattformeier
- `basic` 399/mnd / `pro` 599/mnd / `deluxe` 999/mnd
- **QR-koder: Deluxe-eksklusivt**

## Implemented
### Feb 2026
- JWT auth, invitasjon via Resend, ToS, rettighetsmatrise, lag/personer/varer/utlån/varetelling, Excel inn/ut, Stripe, DataTable

### Okt 2026
- Plattformeier kundeadmin (soft-delete m/ 12-mnd purge)
- Varetelling forhåndsutfylt m/ dato pr linje
- DataTable grupperings-visning
- Loan-target (Person/Lag), hurtig Lån ut
- Lag-detalj m/ personer + historikk
- Trenerfjerning fjerner team_id fra personens team_ids
- Brukere: online/offline, siste pålogging, login-historikk
- Varsler: forfallsdato (7/14/30), bjelle m/teller, påtrengende popup, Forleng frist
- Faktura: valgbare linjer, PDF, email, bank/KID
- QR (Deluxe): per-størrelse `has_qr`, auto-QR ved opprettelse, Generer QR-dialog m/ str-sjekkbokser, Vis QR-dialog m/ grid + Skriv ut, QR-eksport-dialog (scope + str), logo-overlay i senter, scanner parser `item_id#size`

### Okt 2026 – Bulk + Oppgrade (denne økten)
- **Bulk-generer QR**: `POST /items/bulk-generate-qr` – aktiverer `has_qr` på alle items + sizes i én operasjon (deluxe only, 403 for basic/pro). «Generer QR for alle»-knapp i Utstyr.
- **UpgradeCTA-komponent**: viser et vennlig kort med krone-ikon, forklarer Deluxe-funksjonen og tilbyr «Oppgrader til Deluxe»-knapp som leder admin til /app/abonnement. Vises:
  - Inline nederst på /app/utstyr for basic/pro (med inline={true})
  - Full-page via ProtectedRoute når basic/pro bruker besøker /app/skann
  - For ikke-admin: viser «Kontakt klubbens admin for å oppgradere» i stedet
- Alle 4/4 backend-tester + alle frontend-flyter grønne, inkludert visuell screenshot-verifisering

## Backlog
- P1: Excel Import for Teams og People
- P1: Automatisk fakturakvittering ved Stripe-betaling
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P1: Auto-generer QR når ny størrelse legges til eksisterende Deluxe-vare
- P2: KID med MOD10/MOD11 kontrollsiffer
- P2: Faktura-PDF til GridFS
- P2: QR-labels bakgrunnsjobb for store beholdninger
- P2: Bulk-generate m/ `bulk_write`/array-filters for store tenants
- P2: TTL-index på login_history
- P2: Background purge-task for `purge_at < now`
- P2: Global hurtigsøk Ctrl+K
- Refactor: splitt /app/backend/server.py (~2360 linjer) i routers (qr, invoices, notifications, loans)
