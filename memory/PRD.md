# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Håndterer klubber, lag, personer, utstyr, utlån/retur, varetelling, Excel-eksport, brukeradministrasjon med rettigheter og invitasjonsepost. App heter «UTSTYRSROMMET».

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT auth (12h cookie + Bearer), Resend-integrasjon for invitasjon
- Frontend: React 19 + React Router + shadcn/ui + Tailwind, Sonner for toasts
- Auth: Custom JWT, super admin seeded (raymond.d.hansen@gmail.com), ikke-slettbar

## Users
- Super Admin: raymond.d.hansen@gmail.com (opprettet, kan ikke slettes)
- Admin brukere: full tilgang til alle moduler
- Standard brukere: individuelle rettigheter per modul (none/read/write/admin)

## Implemented (Feb 2026)
- JWT auth med super-admin seeding, invitasjonsepost via Resend, sett-passord-flyt
- Rettighetsmatrise per modul (dashboard, teams, people, inventory, loans, stock_audit, users, settings)
- Lag med lagsnavn-meny, aldersklasse, treningstider (7), kontaktperson, nøkkelansvarlig, hovedtrener/lagleder/trener 1-5
- Personregister med lagstilknytning, personlig & lags skyldig beløp, utlånshistorikk
- Utstyr med hovedgruppe/undergruppe, klær med størrelser + draktnummer (default X)
- Utlån og utlevering med automatisk debt-oppdatering på lag og person, modus toggle, pris on/off ved utlevering
- Retur med automatisk nullstilling av skyldig beløp + lageroppdatering
- Varetelling: start, legge til linjer, anvende for å oppdatere systembeholdning
- Excel-eksport: beholdning + per-lag historikk (xlsx)
- Klubbinnstillinger med logo-opplasting (data URL, max 2MB)
- Dashboard med statistikk, lagerverdi, skyldig beløp, lav beholdning, siste aktivitet
- Responsivt design, grønt sports-tema, Outfit + Plus Jakarta Sans

## Backlog (P1/P2)
- Flere klubber: multi-tenant-filtrering per klubb på data
- Avansert søk/filter i tabeller + paginering
- Grafisk statistikk (Recharts) på dashboard
- Historisk logg over endringer per bruker (audit trail)
- Push-varsel ved innlevering forfalt
- QR-kode skanning for raskere utlån
