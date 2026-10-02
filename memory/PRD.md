# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Håndterer klubber, lag, personer, utstyr, utlån/retur, varetelling, Excel-eksport, brukeradministrasjon med rettigheter og invitasjonsepost. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe) og plattformeier-impersonering. App heter «UTSTYRSROMMET».

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT auth (12h cookie + Bearer), Resend-integrasjon
- Frontend: React 19 + React Router + shadcn/ui + Tailwind, Sonner for toasts
- Multi-tenancy: `tenant_id` på alle data, platform_owner kan impersonere via `imp_cid`-cookie
- Stripe Billing: Checkout (mnd/år), add-on seats, 50%→10% kupong på årsabonnement, webhooks

## Users
- Platform Owner: raymond.d.hansen@gmail.com (kan ikke slettes, kundenr 000001, eget workspace)
- Admin per kunde: full tilgang
- Standard brukere: individuelle rettigheter per modul (none/read/write/admin)

## Plans
- `free`: KUN manuell tildeling av plattformeier – skjult fra /api/plans og signup
- `basic` 399/mnd: 3 lag, 1 admin
- `pro` 599/mnd: 10 lag, 3 ekstra brukere, varetelling, Excel-eksport
- `deluxe` 999/mnd: ubegrenset lag, 5 ekstra brukere + 199,-/mnd pr ekstra, Excel-import, logo

## Implemented
### Feb 2026
- JWT auth, invitasjons-epost via Resend, sett-passord-flyt, Terms of Service-akseptasjon
- Rettighetsmatrise per modul, admin-seeding ikke-slettbar
- Lag (hovedtrener/lagleder/trener 1-5), Personer (auto-opprettet fra trenerroller)
- Varer med klær (størrelser + draktnr) og baller (predefinerte størrelser), lokasjon pr str
- Utlån/utlevering med skyldig beløp (person-utlån → kun person, lag-utlån → kun lag)
- Retur med automatisk nullstilling + lageroppdatering
- Varetelling, Excel-eksport (beholdning + per-lag), Excel-import m/mal
- Stripe Checkout, 14-dagers gratis prøve, mnd/år med 50% første år, add-on seats
- Plattformeier søk/impersonering via /app/kunder
- Universell DataTable (søk, sort, filter) på alle lister

### Okt 2026 (denne økten)
- **Plattformeier kundeadministrasjon** (/app/kunder → «Administrer»): 3-fane modal
  - Konto & Pakke: endre e-post, navn, telefon, pakke (inkl. «Gratis»), ekstra seter, manuell pris
  - Brukere: slett brukere hos kunden
  - Data & Sletting: tellere + soft-delete (12-mnd purge) + gjenopprett
  - Deaktiver/aktiver: blokkerer innlogging for alle brukere i tenant (Stripe røres ikke)
  - Plan→«Gratis» kan samtidig kansellere Stripe-abonnement (toggle)
- **Varetelling-forbedringer**:
  - Oppstart forhåndsutfyller ALLE varer, sortert på lokasjon → varenavn → størrelse
  - Hver linje har dato/tid-stempel (`counted_at`) når tall registreres
  - Inline-input + auto-lagring (blur/Enter), diff beregnes live
  - Slett enkeltlinjer; slett hele varetelling
  - `apply` hopper over utalte linjer (counted_quantity=null)
- **Lån ut-knapp per person-rad**: ett-klikks utlånsdialog forhåndsutfylt med person + hennes lag
- **Trenerfjerning-sync**: når trener fjernes fra lag → team_id fjernes fra personens team_ids, person beholdes
- **Grupperings-visning**: «Grupper etter»-dropdown på DataTable (personer kan grupperes på lag med collapsible headere)
- **`free` plan skjult**: ikke i /api/plans og signup; kun plattformeier kan sette det via PATCH

## Backlog (P1/P2)
- P1: Excel Import for Teams og People
- P1: Automatisk fakturakvittering via Resend ved Stripe-betaling
- P1: CTA-oppgraderingsbanner når kunde når pakkegrenser
- P2: 14-dagers angrerett for privatkunder i Terms
- P2: Global shortcut-søk (Ctrl/Cmd+K)
- P2: Aktivitetslogg for plattformeier (hvem impersonerte hvem)
- P2: Background purge-task for kunder med `purge_at < now`
- P3: QR-kode skanning for raskt utlån
- Refactor: splitt /app/backend/server.py (1778 linjer) i moduler
