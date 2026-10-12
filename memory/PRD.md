# UTSTYRSROMMET – Product Requirements Document

## Overview
Multi-tenant SaaS inventory- og administrasjonssystem for norske idrettsklubber. Deep-taxonomy utstyrsstyring (Kategori → Hovedgruppe → Undergruppe), QR-koder, strenge Excel-import/-eksporter, lagertelling (Varetelling), varemottak, behovsmeldinger, PDF-rapporter, komplekse utlån/lag-koblinger, Stripe-abonnement, JWT-auth, soft-deletion. **Lagsportal (portal.utstyrsrommet.no)** – separat sub-portal for Deluxe-abonnementer der lagledere og trenere kan logge inn, se sine lån og sende inn behovsmeldinger uten tilgang til klubbens admin-flate.

## User Personas
- **Klubbadmin / Materialforvalter**: Hovedbruker. Oppretter varer, bestiller, mottar varer, låner ut utstyr til lag/personer, kjører varetelling.
- **Lagleder / Trener**: Melder inn behov via Lagsportal (Deluxe) eller via klubbinternt skjema (alle planer), mottar utstyrsliste på epost.
- **Platform-eier (Emergent)**: Impersonerer kunder, administrerer abonnement.

## Core Requirements
- Taksonomi: Kategori → Hovedgruppe → Undergruppe. 3-nivå gruppering i Inventory-UI.
- Varer har `main_item_number` (fritekst, f.eks. `HJEM100`) → auto-generert `full_number` per variant (`HJEM100-M-08`).
- Variantsammenslåing: Samme vare + str + draktnr aggregeres til én rad med sum-lager.
- Excel import/eksport med **Varenummer som første kolonne**.
- PDF-rapporter (bestilling, lag-utstyr, varemottak, QR-etiketter, varetelling) viser **Varenr først**.
- QR-koder: `item_id` eller `item_id#size`. Etiketter viser `full_number` som menneskelesbar tekst. 1 QR per variant uavhengig av lagerantall; print-dialog for 1 / lik lager / lager+2.
- Soft-delete og activate/deactivate for leverandører.
- Role_title på brukere, brukt i epost-signaturer.
- Multi-tenant isolasjon via `tenant_id` på alle collections.
- **Lagsportal**: Egen JWT-type (typ=portal), eget cookie `portal_token`, serverside Deluxe-gate på hver forespørsel. Portal-brukere kan aldri se andre lag eller klubbens lagerbeholdning.

## Implementation Status

### 2026-10-12 – GET /items/{item_id} + Skann QR-fiks
- Lagt til `GET /api/items/{item_id}` i server.py (etter `/items/taxonomy` og `/items/import/template` for å unngå shadowing). Beskyttet med `require_perm("inventory","read")`, tenant-scopet lookup.
- Fikser Skann QR-siden (`Scan.jsx:67`) som tidligere feilet med «Ukjent QR-kode – vare ikke funnet» pga. 405.
- Verifisert: ny ruten 200 ved gyldig id, 404 ved ukjent, 401 uten auth. Taxonomy og open-orders uendret.

### 2026-10-12 – Lagsportal Fase 2: E-postvarsel + Klubbside linjebehandling
- `PortalApp.jsx` setter `document.title = "Portal Utstyrsrommet"` via useEffect ved mount; gjenopprettes ved unmount (nullrisiko for klubbappens egen tittel).
- Verifisert: Lagsportal viser «Portal Utstyrsrommet», klubbappen viser fortsatt «UTSTYRSROMMET».
- Domene: `App.js` sin `isPortalHost()` håndterer allerede `portal.*`-hostnames – ingen kodeendring nødvendig for `portal.utstyrsrommet.no`. Krever kun CNAME + custom-domain i Emergent deploy etter deploy.

### 2026-10-12 – Lagspålogginger: Rediger, Slett og Admin-Sett-Passord
- Backend: `TeamPortalAccountUpdateIn` utvidet med `email` + `team_id`. PUT håndterer unikhets-sjekk + bytter `team_name` ved laglytting.
- Nytt endepunkt `DELETE /api/team-portal/accounts/{aid}` – permanent sletting, aktivitetslogg.
- Nytt endepunkt `POST /api/team-portal/accounts/{aid}/set-password` – admin setter manuelt passord (min 8 tegn), fjerner evt. åpen invitasjon.
- Frontend `TeamPortalAccounts.jsx`: Blyant (Rediger), Nøkkel (Sett passord), Søppelbøtte (Slett) – alle krever `teams.admin`.
- Verifisert: edit basic/email/team_id, duplicate-email → 400, admin-set-password → login med nytt passord virker, delete → login 401, idempotent delete → 404.

### 2026-10-12 – Lagsportal klubb-branding
- `GET /api/portal/auth/me` returnerer nå `club.logo_url` i tillegg til `club.name`.
- Nytt public endpoint `GET /api/portal/branding?token=<invite>` lar «sett passord»-siden vise klubbens logo+navn før konto er aktiv.
- `PortalLayout`: klubblogo (eller fallback-initialer) i header, gull-aksentlinje, subtil sportsstripe-bakgrunn, footer med klubb-navn + «drevet av UTSTYRSROMMET».
- `PortalLogin`: oppgradert med gull-gradient topplinje og sportsstripe-bakgrunn.
- `PortalSetPassword`: viser klubbens logo/initialer og navn før passord settes.

### 2026-10-12 – Lagsportal (Team Portal) Fase 1 LIVE
- **Kritisk bugfix**: `app.include_router(api)` ble kalt midt i filen; alle Lagsportal-endepunkter definert etter kallet (6350-6990) var 404. Flyttet til slutten med beskyttende kommentar.
- Backend-endepunkter (gatet på Deluxe via `_require_tenant_deluxe_portal`):
  - Admin: `GET/POST /api/team-portal/accounts`, `PUT /api/team-portal/accounts/{id}`, `POST .../resend-invite`
  - Portal auth: `POST /api/portal/auth/{login,logout,set-password}`, `GET /api/portal/auth/me`
  - Portal data: `GET /api/portal/dashboard` (lån, utleveringer, forfalte, skyldig beløp, behov),
    `GET /api/portal/items` (uten `quantity`/`location`/`has_qr`), `GET/POST /api/portal/needs`,
    `GET /api/portal/needs/{id}`, `POST /api/portal/needs/{id}/withdraw`
  - Klubbside: `GET /api/needs-requests`, `GET /api/needs-requests/{id}`, `POST .../start-processing`
  - Status: `GET /api/team-portal/status`
- Database: `team_portal_accounts` collection (tenant_id, team_id, email, password_hash, active, reset_token, invite-expiry 7 dager).
- Behovsmeldingsnummer: `BM{seq:05d}-{YY}` via atomic counter.
- 3-dagers regel for ønsket dato (Europe/Oslo).
- Idempotent `start-processing` (optimistisk lås på status=sendt).
- In-app notification til klubb-brukere ved ny behovsmelding.
- Frontend (`/app/frontend/src/portal/`): PortalApp router, PortalLogin, PortalSetPassword, PortalLayout, PortalDashboard, PortalNeedsList/New/Detail.
- Hostname-basert routing i `App.js`: `portal.*` eller `?portal=1` fallback for preview.
- E2E verifisert: admin oppretter konto → invitasjon → set-password → login → dashboard → opprette behov → trekke tilbake → admin start-behandling → portal kan ikke lenger trekke tilbake. Data-isolasjon mellom lag verifisert (404 på direktoppslag av annet lags behov).

### 2026-02-01 – Varenummer i alle rapporter + QR-etiketter
- QR-etiketter viser `full_number` + navn/str under QR.
- Utlån/Retur-PDF, Varemottak-PDF, Bestilling-PDF: Varenr som første kolonne.
- Varemottak-UI: Varenr-kolonne + dato-filter + PDF-nedlasting.
- Helper `_lookup_full_numbers_for_loans` + startup-backfill av `main_item_number` + `full_number`.

### Tidligere (gjeldende i produksjon)
- 3-nivå taksonomi i Inventory-UI, mobil kompakt vareliste, søk-auto-ekspanderende hierarki.
- UTSTYRSROMMET-branding (title, favicon, manifest).
- Soft-delete og activate/deactivate for leverandører.
- `role_title` + epost-signaturer.
- Varenummer-migrering, variant-aggregering, Excel-maler.
- Webshop-stil kategori-filterbar.
- Hjelpesenter (`/app/hjelpesenter`) med dynamisk PDF-generering.
- Støtteapparat med multi-team-membership (team_memberships[]).
- Sidebar: User Name + Role + Club Name + "Om appen"-modal + Logout-ikon.
- Konfigurerbar Reply-To i Email Settings.

## Backlog

### P0 – Backend-refactoring (STOR, ikke blokkerende for Fase 2)
- `server.py` er nå ~7000 linjer. Må deles opp i `/app/backend/routers/`:
  - `routers/portal.py` (første kandidat – isolert kode nederst i server.py)
  - `routers/items.py`, `routers/loans.py`, `routers/orders.py`, `routers/stock_audit.py`,
    `routers/behovsskjema.py`, `routers/admin.py`.
  - Delte helpers i `routers/_shared.py` (allerede startet).
  - Hvorfor: Fil-størrelsen gir timeout i `mcp_search_replace` og øker LLM-kostnad.
- Beskyttende kommentar lagt til ved `app.include_router(api)` for å unngå regresjon.

### P1 – Lagsportal Fase 2
- E-postvarsel til klubbens aktive brukere når ny behovsmelding kommer inn.
- Klubbside: UI for manuell behandling av behovslinjer (godkjenne/avvise/dellevering/låne/kjøpe).
- Varemagasin-reservasjon fra behovsmelding (knytte linjer til lagerbeholdning).
- Statusoppdaterings-eposter til lagleder (f.eks. «behandlet – må bestilles», «kan leveres omgående»).
- «Glemt passord»-flyt for Lagsportal (reset-token-epost + sett-passord).
- Portal-dashboard: vise behandling-fremgang per linje.

### P2 – Enhancements
- E-postvarsel ved varemottak når mengde fyller en bestilling (lagleder-notify).
- Statistikk-dashboard: Mottak-trender per uke/måned.
- Lagerverdi-PDF (sum per kategori).
- Portal mobil-optimering (nå bruker den klubbappens Tailwind som er desktop-first).

## Tech Stack
- Backend: FastAPI, Motor (async MongoDB), ReportLab (PDF), openpyxl (Excel), qrcode (QR), bcrypt+JWT.
- Frontend: React 18, TailwindCSS, shadcn/ui, html5-qrcode, axios.
- 3rd party: Stripe (betalinger), Twilio (SMS), Resend (epost – Emergent-managed).
