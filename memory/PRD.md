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

### Nov 2026 – Trial-admin UI, Stripe-kvittering, Trial-påminnelser
- **Backend**: 
  - `send_trial_reminder_email()` dag 5 (2 dager igjen) og dag 7 (siste dag), idempotent via `trial_reminders_sent`-liste på kundedokumentet
  - `send_payment_receipt_email()` kalles i Stripe webhook ved `invoice.payment_succeeded` (inkluderer beløp, periode, hosted invoice-link)
  - Nytt cron-endpoint `POST /api/cron/trial-reminders` (auth: `Bearer WEBHOOK_CRON_SECRET`, idempotent via `X-Webhook-Id` + `cron_runs`-collection, acks 2xx + `asyncio.create_task`)
  - Fikset `TrialBanner` null-crash når brukeren ikke er i trial-status
- **Frontend**: OwnerPanel kundeadmin-modal har ny «Forleng prøveperiode»-seksjon m/ +3/+7/+14-dagers knapper (synlig kun for kunder i trial-status)
- **Cron**: `.emergent/crons.yml` kjører daglig 09:00 Europe/Oslo
- Testing: cron 401/200 OK, extend-trial API verifisert (13.10 → 20.10), E2E screenshot av OwnerPanel med nye knapper OK

### Nov 2026 – Luxury dark theme + bilder på varer
- **Nytt tema**: Logo (locker-shield svart/rød/sølv-krom) implementert overalt. Globalt bytte emerald → red i hele frontend. Nye utility-klasser: `brand-gradient` (sort m/rød glow), `chrome-text`, `red-gloss-text`, `lux-dark`, `lux-ring`, `chrome-hr`.
- **Landing redesign**: Fullt mørkt tema med radial red glow. «Start 14 dager gratis» og «Start Gratis» (header + hero) fjernet. Prøveversjon lagt til som 4. plan-kort ved siden av Basic/Pro/Deluxe, med «7 DAGER GRATIS»-badge.
- **Login + Signup**: Full dark luxury theme m/ logo + chrome-krom + red gloss. Dark Toaster.
- **Layout (sidebar)**: Logo (shield) + chrome/red-gloss tekst som brand-mark.
- **Bilder på varer**:
  - Backend: `ItemIn.image_url` + `SizeStock.image_url` (base64 data URL i Mongo)
  - Frontend: `compressImage()` helper (canvas 900px / JPEG 0.82)
  - Dialog: Hovedbilde-seksjon m/ 96x96 preview + «Legg til / Bytt / Fjern»
  - Dialog: Bilde-knapp pr str-linje (40x40 preview-flate, både klær og baller)
  - DataTable: Ny thumbnail-kolonne først (12x12 fallback-ikon når tom)
  - Mini-thumbs ved siden av hver størrelse-linje i tabell-visning
- Testing: Backend API verifisert (POST/GET/DELETE med base64-bilder både på item og size), landing + login + inventory screenshot OK, cron fortsatt grønn

### Nov 2026 – Branded app shell + plan-gated images
- **Landing header**: `sticky top-0`, bakdrop-blur, økt padding (`py-5`), hero fått `pt-24` for å unngå konflikt mellom tittel og «Logg inn»-knapp
- **App-shell**: Ny `.app-shell`-klasse gir subtil mørk gradient m/ rød glow (lesbar bakgrunn, branded følelse). Topp-stripe i Layout bruker `brand-gradient` for TrialBanner + varsel-ikon
- **Sidebar restrukturert**: Primary (Dashboard, Utstyr, Utlån, Skann QR, Varetelling) → Collapsible «Klubbinnstillinger» (Lag, Personer, Klubb logo/info) → Admin (Brukere, Abonnement). Auto-ekspanderer når man er på en under-side
- **Deluxe-only produktbilder**:
  - Nytt plan-flagg `product_images: True` kun på Deluxe
  - Backend: `create_item` + `update_item` stripper `image_url` på item og alle sizes hvis plan mangler flagget
  - Frontend: `hasFeature("product_images")` gater hovedbilde-seksjon + per-str bilde-knapper. Non-deluxe får amber info-banner i stedet
  - UpgradeCTA utvidet m/ `product_images`-tekst
- Testing: `/plans` returnerer `product_images: True` kun for deluxe. E2E: Klubbinnstillinger-knapp synlig, Lag + Personer nestet, inventory viser thumbnails-kolonne

### Nov 2026 – Varemottak + Innmeldt Behov + Innkjøpspris
- **Innkjøpspris**: `purchase_price: Optional[float]` på både Item og SizeStock (model). UI: nytt felt i Inventory-dialog
- **Varemottak** (`/app/varemottak`):
  - Backend: `POST /stock-receipts` (idempotent via `request_id`), `GET /stock-receipts`, `POST /stock-receipts/resolve-qr`
  - Dekker klær/baller (variant via size+jersey) OG vanlig vare
  - Lagrer: dato, bruker, qty_before/qty_after, order_ref, comment
  - Frontend: Tabs «Velg vare fra liste» + «Motta vare QR» (html5-qrcode). Søk, variant-knapper, før/etter preview, confirm-knapp disables under submit
  - Sidebar-link under Utstyr
- **Innmeldt Behov** (ny tab i Lag-detalj):
  - Backend: `GET /needs/seasons` (dynamisk: 26/27 + 27/28 i 2026)
  - `GET/POST/DELETE /teams/{id}/needs` + `/needs/import` + `/needs/confirm`
  - Excel-mal med openpyxl `DataValidation` (lag/årsklasse/sesong/varetype/vare/str/antall), 205 datalinjer, lag-ID i B7
  - NEED_RULES validerer antall per varetype (Håndball 1-50, Hjemmedrakt=1, Tape 1-10, osv), krever størrelse for klær/håndball, draktnummer for drakter
  - Preview-dialog med rad-feilmeldinger, replace|append-valg, blokkerer confirm ved feil
  - Dekningsberegning: `_compute_need_coverage` fordeler lager FIFO over linjer så samme variant ikke dobbeltelles
  - Alternativer: samme kategori + størrelse først, feil str ikke foreslått direkte
  - UI: 6 KPI-kort (sesong, linjer, ønsket, dekkes, må bestilles, kostnad*), filtre (alle/dekkes/bestille/alt/mangler pris), tidligere imports m/ dato+bruker+slett
- Testing: 7 API-tester grønne (seasons, create-receipt +3 10→13, idempotency, zero-qty-400, QR resolve, template 7 DVs, team-ID forhåndsutfylt). E2E screenshot av Varemottak-side viser full UX

### Nov 2026 – Leverandører + Behovsskjema + Bestillinger + Varemottak-flyt
- **Leverandører** (`/app/leverandorer`): CRUD med Navn (obl.), Adresse, Postnr/Poststed, Land, E-post, Tlf, Kontaktperson, Orgnr, Notater. Søk + deaktivering (bevares ved ordrehistorikk). Ordrehistorikk-visning per leverandør m/ søk på innkjøpsnr/vare
- **Innkjøpsnummer-sekvens**: `_next_po_number()` genererer unike 5-sifret nummer `NNNNN-YY` per klubb per år via `counters` collection med `findOneAndUpdate` + upsert (thread-safe). Lagerbestillinger får prefiks `LB`
- **Behovsskjema** (`/app/bestillinger`): Opprett m/ lag+sesong → auto-generert innkjøpsnummer. Status: `ikke_sendt`/`sendt`/`bestilt`/`arkivert`. Last ned Excel-mal, marker som sendt (med e-postmottaker lagret). Arkivering i stedet for sletting hvis bestilling finnes
- **Purchase Orders**: Opprett bestilling (lagsbestilling bruker behovsskjema's po_number – ingen ny nummer; lagerbestilling får LB-prefiks). Linjer m/ item_id/size/jersey/quantity/unit_price. Status-historikk m/ hver endring
- **Order Receipt** (`POST /orders/{id}/receive`): Mottar én eller flere linjer, oppdaterer `received_quantity` + `line_status` (ulevert/delvis_levert/levert), auto-oppdaterer order-status (bestilt→delvis_levert→levert), oppdaterer fysisk lager atomisk, idempotent via request_id, krever `confirm_over` ved overmottak
- **Manuell status**: `POST /orders/{id}/manual-status` m/ obligatorisk begrunnelse (lagres i status_history som manual=true). `POST /orders/{id}/resume-auto-status` beregner på nytt fra mottakstall
- **Lagshistorikk**: `GET /teams/{id}/purchase-history` grupperer bestillinger per år + måned m/ totalsum i NOK
- **Statusbadges**: `StatusBadge`-komponent m/ farge+ikon (Bestilt●blå, Delvis▲orange, Levert✓grønn, Manko!rød, Restbestilling■lilla)
- Testing: 10 API-tester grønne (supplier CRUD, 5-siffer sekvens 00001-26→00002-26, lagsbestilling gjenbruker behovsskjema-nummer, LB-prefiks for lagerbestilling, delmottak oppdaterer status, GET by po_number, team-historikk)

### Nov 2026 – Bestill-dialog + Reservasjoner + PDF + Varsle lagleder
- **PDF-bestilling** (`GET /api/orders/{id}/pdf`): ReportLab A4 m/ klubbinfo (venstre), leverandør (høyre), lag/sesong, tabell m/ varer/str/draktnr/antall/à-pris/sum, totalsum eks. mva, notat. Testet: 2189 bytes, valid PDF v1.3
- **Udekket behov-endepunkt** (`GET /behovsskjema/{id}/udekket`): Kalkulerer udekket behov minus allerede bestilt (ekskl. arkivert), + viser åpne LB-lagerbestillinger som kandidater for reservasjon per linje
- **Reservasjoner** (`POST /stock-reservations`): Reserverer én LB-linje mot et behovsskjema. Blokkerer dobbelt-reservasjon. Setter `reserved_for_po`, `reserved_for_team`, `reserved_quantity` på lagerbestilling-linjen
- **Bestill-dialog** (`OrderDialog.jsx`): Åpnes fra behovsskjema. Velg leverandør, inkluder/ekskluder linjer, rediger antall + innkjøpspris. Røde advarsler per linje som har åpen LB med «Reserver»-knapp. Live-totalsum nederst. «Utfør bestilling» → oppretter PO, markerer skjema som `bestilt`
- **Varsle lagleder** (`POST /orders/{id}/notify-lagleder`): Krever at alle linjer er mottatt + team manager/hovedtrener har kontaktinfo. Standardtekst norsk mal. Sender via Twilio SMS (`twilio` pip-installert, krever `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` env) + Emergent-managed e-post. Loggfører kanal/mottaker/tidspunkt/resultat. Idempotent (en-gang-varsling). Validerings-tester: "ikke fullstendig mottatt" (3/10 → 400), "mangler kontakt" (400). CC til brukerens egen e-post
- **UI**: Nye knapper på bestillinger – PDF-download, Varsle lagleder (vises kun når klar), «✓ Varslet»-badge etter sending
- Testing: 4 parallelle API-tester grønne (PDF 2189 bytes, 2 validerings-feil med riktige meldinger, full receipt → status "levert")

## Backlog
- P1: Excel Import for Teams og People
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P2: Cache subscription-status for å unngå find_one+update_one på hver auth request
- P2: KID med MOD10/MOD11 kontrollsiffer
- P2: Faktura-PDF til GridFS
- P2: TTL-index på login_history
- P2: Background purge-task for `purge_at < now`
- P2: Global hurtigsøk Ctrl+K
- Refactor: splitt /app/backend/server.py i routers (qr, invoices, notifications, subscription)
