# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe), plattformeier-impersonering, QR-skanning, varsler og faktura-generering. App heter «UTSTYRSROMMET».

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT (12h cookie + Bearer), Resend, reportlab (PDF), qrcode (QR gen)
- Frontend: React 19 + React Router + shadcn/ui + Tailwind, Sonner, html5-qrcode (mobil kamera-skanning)
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
- JWT auth, invitasjons-epost via Resend, sett-passord, Terms of Service
- Rettighetsmatrise per modul, admin-seeding ikke-slettbar
- Lag/Personer/Varer/Utlån/Retur/Varetelling/Excel-eksport/import
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
- Brukeradministrasjon: online/offline + siste pålogging + login-historikk m/ varighet

### Okt 2026 – QR + Varsler + Faktura (denne økten)
- **QR-skanning**: `/app/skann` mobilside med html5-qrcode (kameratilgang) → scanner QR → forhåndsutfylt utlånsdialog. QR-etikett PDF-generering fra Utstyr-siden (3×7 grid A4).
- **Forfallsdato på utlån**: `due_in_days` (7/14/30) i utlånsdialog, scanner og alle hurtig-utlån. `due_date` + historikk pr forlengelse.
- **Varselsystem**: `GET /api/notifications` returnerer forfalte utlån. Bjelle-ikon i topp-header med teller. Påtrengende popup når det er usette forfalte lån – kan ikke lukkes utenom "Bekreft og lukk". «Forleng frist»-knapp (7/14/30 dager) genererer nytt varsel når ny dato overskrides.
- **Faktura-generering**: `POST /api/invoices` med valgte loan_ids. Lager PDF med reportlab (klubbnavn, org.nr, bankkonto, KID = kundenr+fakturanr, linjer, total). `GET /api/invoices/{id}/pdf` nedlasting. `POST /api/invoices/{id}/send` sender PDF-vedlegg via Emergent email. «Lag faktura»-knapp i Person- og Lag-detaljmodal med linje-avkryssing + «Velg alle».
- **Klubbinnstillinger**: nye felter `bank_account` + `kid_prefix` for faktura-generering

## Backlog (P1/P2)
- P1: Excel Import for Teams og People
- P1: Automatisk fakturakvittering ved Stripe-betaling
- P1: CTA-oppgraderingsbanner når kunde når pakkegrenser
- P2: KID-nummer med MOD10/MOD11 kontrollsiffer for bankkompatibilitet
- P2: Lagre faktura-PDF i GridFS i stedet for base64 i doc
- P2: TTL-index på `login_history` for å begrense vekst
- P2: Background purge-task for kunder med `purge_at < now`
- P2: Background email-reminder X dager før forfall
- P2: Global shortcut-søk (Ctrl/Cmd+K)
- Refactor: splitt /app/backend/server.py (~2140 linjer) i routers (invoices, notifications, loans)
