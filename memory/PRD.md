# UTSTYRSROMMET – Product Requirements Document

## Overview
Multi-tenant SaaS inventory- og administrasjonssystem for norske idrettsklubber. Deep-taxonomy utstyrsstyring (Kategori → Hovedgruppe → Undergruppe), QR-koder, strenge Excel-import/-eksporter, lagertelling (Varetelling), varemottak, behovsmeldinger, PDF-rapporter, komplekse utlån/lag-koblinger, Stripe-abonnement, JWT-auth, soft-deletion.

## User Personas
- **Klubbadmin / Materialforvalter**: Hovedbruker. Oppretter varer, bestiller, mottar varer, låner ut utstyr til lag/personer, kjører varetelling.
- **Lagleder / Trener**: Melder inn behov via skjema, mottar utstyrsliste på epost.
- **Platform-eier (Emergent)**: Impersonerer kunder, administrerer abonnement.

## Core Requirements
- Taksonomi: Kategori → Hovedgruppe → Undergruppe. 3-nivå gruppering i Inventory-UI.
- Varer har `main_item_number` (fritekst, f.eks. `HJEM100`) → auto-generert `full_number` per variant (`HJEM100-M-08`).
- Variantsammenslåing: Samme vare + str + draktnr aggregeres til én rad med sum-lager.
- Excel import/eksport med **Varenummer som første kolonne**.
- PDF-rapporter (bestilling, lag-utstyr, varemottak, QR-etiketter, varetelling) viser **Varenr først**.
- QR-koder: `item_id` eller `item_id#size`. Etiketter viser `full_number` som menneskelesbar tekst.
- Soft-delete og activate/deactivate for leverandører.
- Role_title på brukere, brukt i epost-signaturer.
- Multi-tenant isolasjon via `tenant_id` på alle collections.

## Implementation Status

### 2026-02-01 – Varenummer i alle rapporter + QR-etiketter
- QR-etiketter (`/api/inventory/qr-labels`): Viser `full_number` (bold) + navn/str (slankere) under QR. Small-størrelse viser kun varenr. 2 cm / 6 cm / 10 cm.
- Utlån/Retur-PDF (`_build_team_equipment_pdf`): Varenr som **første kolonne** i «Utestående utstyr»-seksjonen. Dato → Varenr → Vare → Str/Nr → Antall → Utlevert til i «Utleverte forbruksvarer».
- Varemottak-PDF (nytt endepunkt `GET /api/stock-receipts/pdf?date_from=&date_to=`): Varenr som første kolonne, med dato-filter.
- Varemottak-UI: Varenr-kolonne lagt til i «Siste varemottak» og «Åpne bestillinger»-tabellene. Dato-filter + «Last ned PDF»-knapp.
- Backend lagrer `full_number` på nye stock_receipts; backfill on-the-fly for gamle.
- Helper `_lookup_full_numbers_for_loans` henter varenumre fra items-collection for utlån som mangler feltet.

### Tidligere (gjeldende i produksjon)
- 3-nivå taksonomi i Inventory-UI (Kategori → Hovedgruppe → Undergruppe).
- Mobil kompakt vareliste uten horisontal scroll.
- Søk-auto-ekspanderende hierarki i DataTable.
- Egen UTSTYRSROMMET-branding (title, favicon, manifest).
- Soft-delete og restore for leverandører (admin).
- Activate/deactivate-toggle for leverandører.
- `role_title`-felt på bruker + epost-signaturer med rolle, navn, telefon, epost.
- Masse-migrering: Varenummer med `main_item_number` + auto `full_number`.
- Variant-aggregering (fjernet duplikater fra databasen).
- Alle Excel-maler/eksporter + Varetelling + Bestilling-PDF har Varenr i første kolonne.
- Webshop-stil kategori-filterbar i Inventory.
- Main item number tekst-input med live preview i Add/Edit vare-dialog.

## Backlog

### P0 – Backend-refactoring
- `server.py` er ~5900 linjer. Må deles opp i `/app/backend/routers/`:
  - `routers/items.py`, `routers/loans.py`, `routers/orders.py`, `routers/stock_audit.py`, `routers/behovsskjema.py`, `routers/admin.py`.
  - Delte helpers i `routers/_shared.py` (allerede startet).
  - Hvorfor: Fil-størrelsen gir timeout i `mcp_search_replace` og øker LLM-kostnad.

### P1 – Edge cases
- Verifisere alle gamle utlån/mottak har backfill av `full_number` ved første request.
- Verifisere at Excel-import godtar nye `main_item_number` for eksisterende varer uten å bryte unikhetssjekk.

### P2 – Enhancements
- E-postvarsel ved varemottak når mengde fyller en bestilling (lagleder-notify).
- Statistikk-dashboard: Mottak-trender per uke/måned.
- Lagerverdi-PDF (sum per kategori).

## Tech Stack
- Backend: FastAPI, Motor (async MongoDB), ReportLab (PDF), openpyxl (Excel), qrcode (QR), bcrypt+JWT.
- Frontend: React 18, TailwindCSS, shadcn/ui, html5-qrcode, axios.
- 3rd party: Stripe (betalinger), Twilio (SMS), Resend (epost – Emergent-managed).
