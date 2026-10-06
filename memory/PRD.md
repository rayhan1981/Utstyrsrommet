# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe), plattformeier-impersonering, QR-skanning, varsler, faktura-generering og 7-dagers gratis prøveperiode.

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT, Emergent email, reportlab (PDF), qrcode + PIL
- Frontend: React 19 + shadcn/ui + Tailwind, Sonner, html5-qrcode
- Multi-tenancy: `tenant_id` på alle data
- Stripe Billing: Checkout, add-on seats, 50% kupong første år

## Users
- Platform Owner: raymond.d.hansen@gmail.com (deluxe-workspace, upåvirket av trial-logikk)
- Admin per kunde: full tilgang
- Standard brukere: rettigheter per modul

## Plans og trial
- Alle nye klubber: **7-dagers gratis Deluxe-prøveperiode**. Ingen betalingskort kreves.
- Når prøveperioden utløper: → **expired** (read-only) hvis ingen plan valgt. Hvis `selected_plan` satt under trial → auto-aktivering av den planen.
- Plans: `basic` 399/mnd, `pro` 599/mnd, `deluxe` 999/mnd. `free` kun manuelt av plattformeier.
- Subscription statuses: `trial`, `active`, `expired`, `cancelled`

## Implemented
### Feb 2026
- JWT auth, invitasjon via Resend, ToS, rettighetsmatrise, lag/personer/varer/utlån/varetelling, Excel inn/ut, Stripe, DataTable

### Okt 2026
- Plattformeier kundeadmin m/ soft-delete (12-mnd purge)
- Varetelling forhåndsutfylt m/ dato/tid pr linje, slett linjer
- DataTable grupperings-visning
- Loan-target (Person/Lag), hurtig Lån ut, Lag-detalj
- Trenerfjerning fjerner team_id fra personens team_ids
- Brukere: online/offline, siste pålogging, login-historikk
- Varsler: forfallsdato (7/14/30), bjelle m/teller, påtrengende popup, Forleng frist
- Faktura: valgbare linjer, PDF, email, bank/KID
- QR (Deluxe): per-størrelse `has_qr`, auto-QR ved oppretting, Generer QR-dialog m/ str-sjekkbokser, Vis QR-dialog m/ grid + Skriv ut, QR-eksport-dialog (scope + str), logo-overlay i senter
- Bulk-generer QR for alle varer
- UpgradeCTA for basic/pro-brukere som møter Deluxe-features

### Okt 2026 – 7-dagers Deluxe-trial (denne økten)
- **Backend**: SignupIn.plan optional, auto-trial 7 dager på signup. `_sync_subscription_status` kjører på hver /auth/me — switcher til `expired` eller aktiverer `selected_plan` når trial går ut. `require_perm` m/ level ≥ write blokkerer med 402 for expired/cancelled. Owner-workspace short-circuit.
- Nye endepunkter: `POST /subscription/select-plan` (deferred activation), `POST /owner/customers/{id}/extend-trial`
- **Frontend**:
  - Signup forenklet – ingen plan-velger, trial-startet-welcome dialog
  - `TrialBanner` i header m/ dag-sensitiv messaging (klikk → /abonnement)
  - `TrialDashboardCard` m/ 4 varianter: early (7-4 dager), midterm (3), urgent (1), expired
  - Subscription-side: Velg Basic/Pro/Deluxe-knapper under trial = deferred activation (ikke Stripe-checkout). Valgt plan vises som badge.
  - AuthContext.hasPerm returnerer false for write/admin når expired → UI skjuler handlinger
  - Logo-fil fra bruker lastet opp som `/public/logo.png`, brukes i sidemeny og signup
- Testing: 8/8 backend-tester grønne + full E2E (signup → welcome → trial-banner → Dashboard trial-kort → Subscription select-pro deferred → trial expire → 402 på write + 200 på read).

## Backlog
- P1: Excel Import for Teams og People
- P1: Automatisk fakturakvittering ved Stripe-betaling
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P1: Admin-UI for extend-trial i OwnerPanel (endpoint finnes, UI mangler)
- P2: Cache subscription-status for å unngå find_one+update_one på hver auth request
- P2: KID med MOD10/MOD11 kontrollsiffer
- P2: Faktura-PDF til GridFS
- P2: TTL-index på login_history
- P2: Background purge-task for `purge_at < now`
- P2: Global hurtigsøk Ctrl+K
- Refactor: splitt /app/backend/server.py i routers (qr, invoices, notifications, subscription)
