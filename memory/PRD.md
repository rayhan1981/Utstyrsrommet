# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Håndterer klubber, lag, personer, utstyr, utlån/retur, varetelling, Excel-eksport, brukeradministrasjon med rettigheter og invitasjonsepost. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe) og plattformeier-impersonering. App heter «UTSTYRSROMMET».

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT auth (12h cookie + Bearer), Resend
- Frontend: React 19 + React Router + shadcn/ui + Tailwind, Sonner
- Multi-tenancy: `tenant_id` på alle data, platform_owner kan impersonere via `imp_cid`-cookie
- Stripe Billing: Checkout (mnd/år), add-on seats, 50% kupong første år, webhooks

## Users
- Platform Owner: raymond.d.hansen@gmail.com (ikke slettbar, kundenr 000001, eget workspace)
- Admin per kunde: full tilgang
- Standard brukere: individuelle rettigheter per modul (none/read/write/admin)

## Plans
- `free`: KUN manuell tildeling av plattformeier – skjult fra /api/plans og signup
- `basic` 399/mnd / `pro` 599/mnd / `deluxe` 999/mnd

## Implemented
### Feb 2026
- JWT auth, invitasjons-epost via Resend, sett-passord-flyt, Terms of Service
- Rettighetsmatrise per modul, admin-seeding ikke-slettbar
- Lag (trenerroller), Personer (auto-opprettet fra trenere), Varer m/ klær+baller
- Utlån/utlevering med skyldig beløp, retur, varetelling
- Excel eksport/import, Stripe Checkout, add-on seats, plattformeier impersonering
- Universell DataTable (søk, sort, filter)

### Okt 2026
- **Plattformeier kundeadmin** (`/app/kunder` → Administrer): 3-fane modal med e-post/plan/pris-endring, deaktiver/aktiver, soft-delete m/ 12-mnd purge + gjenopprett
- **Varetelling-forbedringer**: forhåndsutfylte linjer sortert på lokasjon→vare, inline-input m/auto-lagring, dato/tid pr linje, slett linjer, apply hopper over utalte
- **Grupperings-visning**: «Grupper etter» på DataTable (f.eks. personer per lag med collapse)
- **Loan-target styring**: `LoanIn.loan_target` ("team"|"person") styrer hvor skyldig beløp havner. Retur reverserer samme mål. Riktig valg eksponert i Loans-dialog med Person/Lag-toggle.
- **Lån ut-knapp per rad**: både på Personer (sender loan_target='person') og Lag (sender loan_target='team') med forhåndsutfylte dialoger
- **Lag-detaljvisning** (eye-ikon): modal med personer tilknyttet + utlånshistorikk
- **Trenerfjerning fjerner team_id fra personens team_ids** (person beholdes)
- **Brukeradministrasjon**: online/offline-prikk pr bruker, kolonne «Pålogget» + «Siste pålogging», historikk-knapp (login/logout/varighet). Online = `last_seen < 5 min`. Login lukker tidligere åpne sesjoner før ny insert.
- **`free` plan skjult**: ikke i /api/plans og signup; kun plattformeier kan sette det via PATCH

## Backlog (P1/P2)
- P1: Excel Import for Teams og People
- P1: Automatisk fakturakvittering via Resend ved Stripe-betaling
- P1: CTA-oppgraderingsbanner når kunde når pakkegrenser
- P2: 14-dagers angrerett for privatkunder i Terms
- P2: Global shortcut-søk (Ctrl/Cmd+K)
- P2: Aktivitetslogg plattformeier impersonering
- P2: TTL-index på `login_history` for å begrense vekst
- P2: Background purge-task for kunder med `purge_at < now`
- P3: QR-kode skanning
- Refactor: splitt /app/backend/server.py (~1800 linjer)
