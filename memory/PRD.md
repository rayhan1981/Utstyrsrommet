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

## Implemented (seneste iterasjoner)

### Feb 2026 – iter 11-18 (tidligere)
Se CHANGELOG via git log. Full historie: 11-punkts forbedring, Excel-preview, Varemottak-vs-bestilling, mappe-visning i DataTable, Behovsskjema import+rediger+bekreft, Quick-order per leverandør med PDF-action-modal, taxonomy-fix, drag-and-drop + startet routers-ekstraksjon.

### Feb 2026 – iter 19: 3-nivå hierarki + Mobilvennlig + Hierarki-søk ✅
- **Fullt 3-nivå kategorihierarki**: `initialGroupBy` i Inventory.jsx = `["category","main_group","sub_group"]`. Items vises **kun** i den dypeste undergruppen, aldri direkte under hovedgruppe. Hjemmedrakter/Bortedrakter alltid adskilt.
- **Empty-bucket labels**: `(Uten kategori)` / `(Uten hovedgruppe)` / `(Uten undergruppe)` holder item i korrekt gruppe uten å blande.
- **Antall i parentes**: `_count` = deep count over alle underliggende nivåer.
- **Mobilvennlig vareliste**: Responsive Tailwind-klasser (`hidden sm/md/lg/xl:table-cell`) skjuler mindre viktige kolonner på smale skjermer. Kompakt radstruktur: bilde + navn + size/jerseynr-badge inline, pris · antall · lokasjon på andre linje. Padding `py-1` for data-rader. Null horisontal scroll på 390px.
- **getRowId-fix**: Variants av samme item delte `id`, nå bruker DataTable `_id`.
- **Hierarki-søk (Søk på tvers av hierarki)**: `isSearching = search || activeFilterCount > 0` i DataTable. Når aktivt tvinger `isOpen = true` på alle mapper så treff vises på tvers av hele hierarkiet uten å åpne manuelt. Hint-banner viser `Mapper er auto-åpne under søk/filter · N treff på tvers av hierarkiet`. Når søk tømmes beholdes brukerens originale collapsed-state.
- Testing: iteration_19.json – 100% frontend pass, 0 UI-bugs, 0 React-warnings.

## Backlog
- **P1: Server-refaktor** – Splitt `/app/backend/server.py` (5480 linjer) i routers (items, loans, orders, stock_audit, behovsskjema, admin). Flytt shared deps til `/app/backend/deps.py`. `/app/backend/routers/` har `_shared.py` + `taxonomy_admin.py`. KRITISK før flere features.
- P1: Excel Import for Teams og People
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P2: Punkt 4 – Full-featured strict-mode UI «Avbryt hvis feil» på import.
- P2: Dangling refs – `DELETE /items` sjekker ikke behovsskjema-linjer.
- P2: ImportPreviewDialog laster filen 2 ganger – optimaliser med `/items/import/commit` preview-token.
- P2: Dedikert Excel-import for lagerbeholdning m/ forhåndsvisning + leverandør-dropdown-matching.
- P2: Cache subscription-status, KID MOD10/11, Faktura GridFS, TTL login_history
