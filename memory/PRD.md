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
### Feb 2026 – Oversikt (seneste iterasjoner)

### Feb 2026 – 11-punkts forbedring (iter 11)
- **Punkt 3 — Varediagnostikk & tekstlabels**: `DELETE /api/items/{id}` blokkerer 409 ved aktive utlån/åpne bestillinger. `delVariant`-funksjon kaller `POST /api/items/{id}/delete-variant`. Tekstlabels under alle action-ikoner.
- **Punkt 6 — Dedikert sidebar-fane**: Ny `/app/behov` med Layout.jsx entry. Full CRUD, redigering, send e-post med reell Excel-vedlegg.
- **Punkt 9 — Varetelling Excel-flyt**: `GET /api/stock-counts/{id}/export`, `POST /api/stock-counts/{id}/import` med line_id-match. applied blokkerer import. `POST /api/stock/manual-adjust` krever reason+size.
- **Punkt 8 — Returer gruppert per Lag · Årsklasse**: `ReturnedByTeamGrouped`-komponent + `POST /api/loans/{id}/undo-return`.
- **Punkt 5 — Varemottak restrukturert**: Gruppert per Kategori · Hovedgruppe.
- **Punkt 1 — Naturlig størrelsessortering**: `/app/frontend/src/lib/sizeSort.js`.
- **Punkt 2 — QR per variant**: Verifisert payload `{item_id}#{size}`.
- Testing: iteration_11.json – 13/13 backend pytest + 11/11 UI.

### Feb 2026 – Kategori-hierarki, Excel-preview, Varemottak-vs-bestilling (iter 12)
- **Kategori-hierarki**: `TaxonomyPicker.jsx` – 3 cascading dropdowns basert på `GET /api/items/taxonomy`. DEFAULT_TAXONOMY_SEEDS for tomme tenants.
- **Excel-import-mal + preview**: `GET /api/items/import/template`, `POST /api/items/import/preview`, `ImportPreviewDialog.jsx`. Upsert-mode.
- **Varemottak vs bestilling**: `GET /api/items/{item_id}/open-orders`, gult panel i Varemottak.jsx.
- Testing: iteration_12.json – 10/10 backend.

### Feb 2026 – Mappe-visning (iter 13)
- **DataTable nøstet gruppering**: `groupBy` er array, nøstede foldere med fargekodet venstrebord.
- **Inventory folder-view**: default `initialGroupBy={["category","main_group"]}`.

### Feb 2026 – Behovsskjema import+rediger+bekreft (iter 14)
- `POST /api/behovsskjema/{sid}/import`, `PUT /lines`, `POST /confirm`, `POST /unlock`.
- `EditBehovLinesDialog.jsx` + Behov.jsx UI.
- QR per varelinje blokkerer re-generering 409.

### Feb 2026 – Quick-order per leverandør + PDF-action-modal (iter 15)
- `Leverandorer.jsx` «Bestill varer»-knapp pr rad → `StockOrderDialog` med `lockedSupplierId`.
- `OrderActionDialog.jsx` – Lagre lokalt / Skriv ut / Send e-post.

### Feb 2026 – Dialogbrukervennlighet + Drakt-undergrupper (iter 16)
- `DEFAULT_TAXONOMY_SEEDS` oppdatert: Hjemmedrakter / Bortedrakter som egne undergrupper.
- TaxonomyPicker m/ tydelige «+ Ny»-knapper.
- Lagre/Avbryt øverst OG nederst i Inventory-dialog.
- «🗑️ Slett str»-knapp per variant.

### Feb 2026 – Taxonomy-fix: dropdown-basert + Spillertroye-hierarki (iter 17)
- «+ Opprett ny» inline øverst i Select-dropdown (ikke sibling-button) – fjerner race condition.
- Default seeds: «Klær → Spillertrøye → Hjemmedrakter/Bortedrakter».
- Migrasjonsscript: 3 items main_group=Drakt → Spillertrøye.

### Feb 2026 – Taxonomy-admin + drag-drop + routers (iter 18)
- Routers-ekstraksjon startet: `/app/backend/routers/_shared.py` + `taxonomy_admin.py`.
- `POST /api/items/taxonomy/rename`, `POST /api/items/taxonomy/delete`, `POST /api/items/bulk-move`.
- `TaxonomyAdminCard` i Settings-siden.
- Drag-and-drop i DataTable: `onDropToGroup`-prop.

### Feb 2026 – 3-nivå hierarki + Mobilvennlig vareliste (iter 19 - denne økten) ✅
- **Fullt 3-nivå kategorihierarki**: `initialGroupBy` i Inventory.jsx endret fra `["category","main_group"]` → `["category","main_group","sub_group"]`. Items vises kun i det dypeste nivået (sub_group), aldri direkte under hovedgruppe eller kategori.
- **Empty-bucket labels**: GroupLabel pr nivå viser `(Uten kategori)`, `(Uten hovedgruppe)`, `(Uten undergruppe)` når feltet mangler – holder varer i korrekt gruppe uten å blande.
- **Antall i parentes**: `_count` i DataTable er total deep count under hvert nivå (f.eks. Klær (3) teller alle rader under hele Klær-grenen).
- **Mobilvennlig vareliste**: Responsive Tailwind-klasser pr kolonne (`hidden sm/md/lg/xl:table-cell`) skjuler mindre viktige kolonner på smale skjermer. Mobile radstruktur: image + varenavn på én linje m/ size+jersey-badge inline, pris/antall/lokasjon på andre linje – `(Mangler leverandør)` badge på tredje linje ved behov.
- **Kompakte rader**: Redusert cell-padding (py-1 vs py-2) + mindre gap i actions-cell + mindre indentasjon pr nøstet nivå (14px vs 20px).
- **Null horisontal scroll på mobil**: `document.body.scrollWidth === clientWidth` på 390px.
- **getRowId-fix**: Variants av samme item delte `id`, nå bruker DataTable `_id` som er unik.
- Testing: iteration_19.json – 100% frontend pass, 11/11 krav verifisert, 0 UI-bugs. 0 horisontal overflow på mobil 390x844.

## Backlog
- **P1: Server-refaktor** – Splitt `/app/backend/server.py` (5480 linjer) i routers (items, loans, orders, stock_audit, behovsskjema, admin). Krever først å flytte shared deps til `/app/backend/deps.py`. Dir `/app/backend/routers/` opprettet med `_shared.py` og `taxonomy_admin.py` som placeholder. KRITISK før flere features for å unngå search_replace-mismatch og lastetid.
- P1: Excel Import for Teams og People
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P2: Punkt 4 (iter11-restpost) – Full-featured strict-mode UI der bruker kan velge «Avbryt hvis feil» på import.
- P2: Dangling refs – `DELETE /items` sjekker ikke behovsskjema-linjer.
- P2: ImportPreviewDialog laster filen 2 ganger – kan optimaliseres med `/items/import/commit` som bruker preview-token.
- P2: Punkt 4 – Dedikert Excel-import for lagerbeholdning med forhåndsvisning + leverandør-dropdown-matching.
- P2: Punkt 1 – Streng hierarki Kategori → Hovedgruppe → Undergruppe (cascading dropdowns) – nåværende er fri tekst.
- P2: Cache subscription-status, KID MOD10/11, Faktura GridFS, TTL login_history
