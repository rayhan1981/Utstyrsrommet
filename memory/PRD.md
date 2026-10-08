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

### Okt 2026 – Fix PDF-vedlegg + unified LoanDialog + knapp-labels
- **Bugfix PDF-vedlegg**: `_send_smtp_sync` leste kun `content_type` fra attachment, ikke `type` som nye endepunkter sender. Nå aksepteres begge formater. Verifisert: `POST /teams/{id}/send-equipment-list` returnerer provider_id og vedlegger utstyrs-PDFen korrekt uansett e-postmetode.
- **Unified LoanDialog**: Ny delt komponent `/components/LoanDialog.jsx` som støtter multi-linje utlån med utlevering/utlån-toggle, egen dato eller felles dato (månedskalender med år/måned-nedtrekk). Brukt i:
  - Loans.jsx (hovedside "Nytt utlån")
  - Teams.jsx (per-lag "Lån ut" → forhåndsvalgt lag)
  - People.jsx (per-person "Lån ut" → forhåndsvalgt person + lag)
  - Scan.jsx (etter QR-skanning → forhåndsvalgt vare+str, åpner samme dialog)
- **Beskrivende labels under ikonknapper**: Alle action-knapper i Lag- og Person-tabellene har nå tekstlabel under ikonet (Lån ut, Detaljer, Last ned, Send epost, Rediger, Slett). Scan-siden har også label-knapper.


### Okt 2026 – Reset-kvoter + personvern for app-eier + login-historikk tilgang
- **Reset-kvoter**: Vanlig bruker maks 1 nullstilling pr måned (30 dager). Admin maks 1 pr uke (7 dager). Super_admin (hovedadmin) + platform_owner har **ingen begrensning**. Returnerer HTTP 429 med beregnet neste-dato når kvoten er overskredet.
- **Personvern for platform-eier**: Pålogging som platform_owner skrives IKKE til `login_history`, `last_seen`/`last_login` oppdateres ikke, logout rydder ikke historikk, og database_reset utført av platform_owner skrives IKKE til `audit_log`. Platform-eier er usynlig i alle klubbers logger.
- **Login-historikk tilgangskontroll**: `can_view_login_history`-flagg pr bruker. Standard: false. Vanlige brukere kan nå kun se **sin egen** historikk med mindre admin har slått på flagget. Admin/platform_owner har alltid tilgang. Nytt toggle i brukerredigering.
- Verifisert: platform_owner reset = ingen audit-oppføring. Admin "testadmin" første reset = 200 OK, andre reset = 429 "Reset-kvote: maks 1 nullstilling pr uke. Neste nullstilling kan utføres etter DD.MM.YYYY HH:MM".


### Okt 2026 – Database-reset (nullstill pr seksjon)
- Nye endepunkter: `GET /api/reset/preview/{section}` returnerer antall rader som vil slettes, `POST /api/reset/{section}` krever `password` + `confirm=true` og bekrefter innloggingspassordet via bcrypt før sletting. Seksjoner: `inventory`, `suppliers`, `teams`, `people`, `users`, `all`. Audit-log skrives til `audit_log`-collection.
- Rolle-logikk: admin + platform_owner har alt. Vanlige brukere får per-seksjon `reset_permissions`-tilgang tildelt av admin (`UserCreateIn.reset_permissions` + `UserUpdateIn.reset_permissions`).
- Frontend: ny `DataResetCard` i Innstillinger – viser alle tillatte seksjoner som egne knapper, dialog med preview av antall rader som slettes, link til eksport-tips, to sjekkbokser (forstår + bekrefter) + passordfelt, røde advarselstekst om at handlingen er permanent.
- Users.jsx: Ny seksjon "Nullstillings-rettigheter" i brukerredigering med sjekkbokser pr seksjon (vises ikke for admin siden admin alltid har tilgang).


### Okt 2026 – Forbedret utstyrs-PDF + Multi-linje utlån
- Utstyrs-PDF: Nye kolonner **Pris/stk** og **Linjebeløp** (totalbeløp pr vare). Kolonne-oppsett rettet så Frist/Linjebeløp ikke lenger overlapper. Lange varenavn trunkereres. Dottet skilleline mellom seksjonene og mer whitespace for klar separering mellom utestående utstyr og forbruksvarer.
- Loans.jsx: Komplett rewrite. Dialog støtter nå **flere varer** på egne linjer med "Legg til linje". Frist-modus: **Felles** (én dato for alle linjer) eller **Egen frist pr linje**. Dato velges fra en månedskalender med måned/år-nedtrekk (bla fram/tilbake uten begrensning).
- Backend LoanIn støtter nå `due_date` ISO direkte i tillegg til `due_in_days`.


### Okt 2026 – Profil-tlf + Konfigurerbare varsler + Dashboard-widget
- `PUT /api/auth/me/profile` lar innlogget bruker oppdatere navn/telefon/adresse. Telefonen vises nå i signaturlinjen på utstyrs-PDFen ("Mvh / navn / telefon / klubb").
- `GET/PUT /api/notification-settings` pr tenant: `reminder_before_days` (default [14,7]) og `reminder_after_days` (default [1]), `enabled` on/off. CRON leser nå tenant-config i stedet for hardkodet 14/7/1.
- Idempotens-nøkler endret til `reminder_sent_{N}d_{before|after}` slik at flere intervaller støttes.
- Dashboard: nytt endpoint `/api/dashboard/stats` returnerer `due_soon` (lån med frist ≤ 7 dager). Ny widget "Lån med frist denne uka" grupperer pr lag med farge-badge (over frist=rød, ≤2 dager=amber, ellers blå) og "Send oversikt"-knapp per lag.
- Nye Settings-cards: `ProfileCard` (navn/tlf/adresse) + `NotificationSettingsCard` (chip-UI for å legge til/fjerne intervall-dager).


### Okt 2026 – Direkte-send + CRON forfallsvarsler
- Ny endpoint `POST /api/teams/{team_id}/send-equipment-list` som genererer utstyrs-PDFen og sender den rett til lagleder (default: team_manager.email → head_coach.email → team.email). Admin blir CC'd. Oppretter `equipment_list_sent_at` på teamet.
- Teams.jsx: Ny blå "Mail"-knapp pr lag ved siden av Download — åpner dialog m/ to/cc/melding, data-testid `send-equipment-{team_id}`, `confirm-send-equipment`.
- CRON `/api/cron/due-date-reminders` (daglig 08:00 Europe/Oslo via `.emergent/crons.yml`): 14 dager før frist og 7 dager før frist → e-post til lagleder m/ PDF; 1 dag etter frist → e-post til lagleder + CC alle aktive brukere i tenanten. Idempotent via `reminder_14_sent / reminder_7_sent / reminder_overdue_sent`-flagg pr lån, grupperer lån pr (tenant, team, milepel) i én mail.
- Verifisert: Test-trigger med due_date=today+7 sender 1 e-post, flagget blir satt, re-trigger sender 0 (idempotent).


### Okt 2026 – Egen avsender-epost + vedlegg + multi-bilder + Lagsutstyr-PDF
- Per-tenant E-postoppsett (Innstillinger): tre metoder (Standard / Egen SMTP / Resend), kryptert passord/API-nøkkel (Fernet avledet fra JWT_SECRET), "Send test-epost"-knapp, verifisert-badge, hjelpetekst under hvert felt.
- Unified `send_tenant_email(tid, to, subject, html, attachments, cc)` som ruter via tenantens konfig; fallback til Emergent-standard. Fikset Emergent-attachment-schema (`type` ikke `content_type`).
- Behovsskjema: Excel-malen vedlegges fortsatt, nå sendes via tenant-adresse. Fix: attachment nå akseptert av proxy.
- Bestillinger: Ny `POST /api/orders/{id}/send` som vedlegger PDF til leverandør/mottaker. Lagleder-varsling vedlegger også PDF.
- Inventory multi-bilder (Deluxe): opp til 5 bilder for hovedvare, 4 bilder per variasjon (`images: List[str]`), bakoverkompatibel med `image_url` (speiler images[0]).
- Lagsutstyr-PDF (erstatter Excel): klubblogo+brevhode, "Til: [lagsnavn] v/ [lagleder]", tittel "Oversikt over utstyr og utestående beløp", seksjon 1 (utestående: Vare/Str/Antall/Skyldig/Frist, én linje pr utlån), seksjon 2 (forbruksvarer: Dato/Vare/Str/Antall/Utlevert til), oppsummering med linjer/antall/totalbeløp, signatur Mvh/navn/tlf/klubb.


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

### Nov 2026 – Varetabell flatet + labels + responsiv
- **Inventory dialog**: Størrelse/Draktnr/Antall/Lokasjon-rader bygget om med explicitte feltlabels over hver kolonne (`text-[11px] text-slate-500`). Grid-layout `grid-cols-2 sm:grid-cols-5` (klær) og `sm:grid-cols-4` (ball) – wrapper på smale skjermer, aligner på desktop. Bilde-cell i bred mobil-kolonne på toppen.
- **Varetabell flatet**: `items.flatMap()` splitter klær/ball-varer i én rad per variasjon. Egne kolonner: Str, Draktnr, Kategori, Type, Pris, Antall, Lokasjon. Hver kolonne er filtrerbar – søk fungerer også på størrelse og draktnummer. Thumbnail per variasjon (fallback til hovedbilde).
- Testing: Screenshot bekrefter 11 av 11 rader uten horisontal scroll på 1920px. Hjemmedrakt 164-#4 og S-#10 vises som to separate linjer.

### Nov 2026 – Rediger behovsskjema + Reell e-postsending + Opprett lagerordre-dialog + Leverandørnummer + Vare-leverandør
- **E-postsending fungerer**: `POST /behovsskjema/{id}/send` genererer Excel-malen inline (via `_build_needs_template_bytes`), bygger HTML, sender via Resend (Emergent-managed) m/ Excel-vedlegg + CC til bruker. Verifisert: 202 Accepted fra provider.
- **Rediger behovsskjema**: Egen Pencil-knapp per skjema åpner modal med mottakers navn, e-post og custom melding. Lagres på skjemaet og brukes automatisk ved «Send»
- **Opprett ny lagerordre**: Full dialog i Bestillinger. Felter: leverandør (må velges først), ønsket leveringsdato, «Legg til vare»-knapp som åpner sub-dialog. Varer fra VALGT leverandør er aktivert; andre vises grå med «Annen lev.»-tekst. Per linje: antall + innkjøpspris redigeres inline. Live-total eks. mva.
- **Leverandørnummer**: Hver leverandør får unikt 5-sifret nummer (00001, 00002…) via `counters`-collection. Backfill ved GET /suppliers. Vises i leverandørlisten + i item-dropdown. Testet: #00001 Select Sport, #00002 Umbro Norge.
- **Vare-leverandør**: `supplier_id`, `supplier_number`, `supplier_name` på Item. Dropdown i Inventory-dialog. Varer uten leverandør får rødt «⚠ Mangler leverandør»-badge i varetabellen. Søkbart (søker også på leverandørnavn/nummer).

### Feb 2026 – 11-punkts forbedring (denne økten)
- **Punkt 3 — Varediagnostikk & tekstlabels**: `DELETE /api/items/{id}` blokkerer med 409 ved aktive utlån eller åpne bestillinger (ikke levert/arkivert/annullert). `delVariant`-funksjon lagt til i `Inventory.jsx` som kaller `POST /api/items/{id}/delete-variant` (returnerer 409 ved aktive utlån på varianten). Alle action-knapper har tekstlabels under ikon (Opprett QR, Vis QR, Rediger, Slett vare, Slett linje).
- **Punkt 6 — Dedikert sidebar-fane**: Ny side `/app/behov` ("Behov og behovsmeldinger") med egen Layout.jsx sidebar-entry (ClipboardList-ikon). Full CRUD: opprett skjema, rediger mottaker/melding, last ned Excel-mal, send e-post med reelt Excel-vedlegg (via `_build_needs_template_bytes` → base64 → `send_tenant_email`), opprett bestilling fra skjemaet.
- **Punkt 9 — Varetelling Excel-flyt**: `GET /api/stock-counts/{id}/export` genererer telledokument (.xlsx) med skjult line_id-kolonne. `POST /api/stock-counts/{id}/import` matcher på line_id. Varetelling-status=applied blokkerer import (409). Ny `POST /api/stock/manual-adjust` krever reason (min 3 tegn) OG size for klær/ball-varer. Lagrer i `stock_adjustments`-collection. `GET /api/stock/adjustments` returnerer historikk.
- **Punkt 8 — Returer gruppert per Lag · Årsklasse**: Ny `ReturnedByTeamGrouped`-komponent i Loans.jsx. "Slett retur"-knapp (Trash2 + tekst) kjører `undoReturn` som ber om begrunnelse og kaller `POST /api/loans/{id}/undo-return`.
- **Punkt 5 — Varemottak restrukturert**: Varer gruppert per Kategori · Hovedgruppe med egne tabeller (sortert alfabetisk). Størrelser sortert naturlig.
- **Punkt 1 — Naturlig størrelsessortering**: Ny `/app/frontend/src/lib/sizeSort.js` med `naturalSizeKey` (barne-tall 128,140,164 først → klær XS,S,M,L,XL → ballstørrelser til slutt). Brukt i Inventory-tabell, Varemottak, LoanDialog, GenerateQrDialog, ViewQrDialog, StockAudit-dialog.
- **Punkt 2 — QR per variant**: Verifisert at `/items/{id}/qr-images` lager payload `{item_id}#{size}` per størrelse. ViewQrDialog sorterer QR-grid naturlig.
- **Testing**: iteration_11.json – 13/13 backend pytest + 11/11 UI-elementer verifisert. 2 LOW-priority fixet: (a) manual-adjust 400 ved klær uten size, (b) React duplicate-key fix i Varemottak.

### Feb 2026 – Kategori-hierarki, Excel-preview, Varemottak-vs-bestilling (iter 12)
- **Kategori-hierarki**: Nytt `/app/frontend/src/components/TaxonomyPicker.jsx` – 3 cascading dropdowns (Kategori → Hovedgruppe → Undergruppe) basert på `GET /api/items/taxonomy`. «+»-knapp pr nivå bytter til tekstfelt for ny verdi, «x» tilbake til dropdown. For tomme tenants returneres `DEFAULT_TAXONOMY_SEEDS` (Klær, Baller, Utstyr m/ underkategorier) så dialogen aldri er tom.
- **Excel-import-mal + preview**: Ny `GET /api/items/import/template` returnerer stilet .xlsx med header-fargekoding, datavalidering på Type-kolonne, 12 kolonner (ny: `Leverandørnr`), eget Instruksjoner-ark m/ feltbeskrivelser og liste over klubbens eksisterende leverandører. Ny `POST /api/items/import/preview` parser + validerer uten å commit. Ny `/app/frontend/src/components/ImportPreviewDialog.jsx` viser statistikk-cards, feil-tabell og items-tabell m/ supplier-match (f.eks. «#00001 Select Sport AS») FØR brukeren bekrefter. `POST /api/items/import` endret til `upsert`-modus (oppdaterer eksisterende varer med samme navn+kategori) + `mode=insert` for feile ved duplikater + `strict=true` for 400-respons ved valideringsfeil. Returnerer `{created, updated, errors}`.
- **Varemottak vs bestilling**: Nytt `GET /api/items/{item_id}/open-orders` returnerer åpne bestillinger (status ∉ {levert, arkivert, annullert}) m/ bestilt/mottatt/gjenstår per linje. Varemottak.jsx viser nytt gult «📦 Åpne bestillinger»-panel når bruker velger en vare, filtrert på picked størrelse. Klikkbart `po_number` → kopierer til Bestillingsreferanse-feltet.
- **Testing**: iteration_12.json – 10/10 backend pytest + alle UI-testids. Fikset: duplicate-item-creation ved re-import, empty-tenant UX, duplicate React-nøkler på Inventory grouped-rader.

### Feb 2026 – Mappe-visning Utstyr & Beholdning (iter 13)
- **DataTable nøstet gruppering**: `/app/frontend/src/components/DataTable.jsx` – `groupBy` er nå array (`["category","main_group"]`), støtter nøstede foldere med farge-kodet venstrebord (rød=Kategori nivå 0, gul=Hovedgruppe nivå 1, blå=Undergruppe nivå 2). Innrykk per nivå. Ny «chip»-selector lar brukeren klikke på/av gruppe-nivåer og se rekkefølge (#1, #2…). Ny prop `initialGroupBy`.
- **Inventory folder-view**: `/app/frontend/src/pages/Inventory.jsx` – kolonner `category`, `main_group`, `sub_group` er alle `groupable:true`. `initialGroupBy={["category","main_group"]}` gir mappe-visning som default. Brukeren kan klikke chips for å endre gruppering eller «Flatt» for å få tilbake flat tabell.

### Feb 2026 – Behovsskjema import tilbake + rediger + bekreft (iter 14)
- **Importer utfylt behovsskjema**: Ny `POST /api/behovsskjema/{sid}/import` tar imot utfylt .xlsx fra lagleder, parser alle linjer, validerer mot katalog + NEED_RULES, og lagrer som `draft_lines` på skjemaet. Status→`importert`. Blokkerer re-import hvis status=bekreftet (409).
- **Rediger linjer**: Ny `PUT /api/behovsskjema/{sid}/lines` erstatter draft_lines. Validerer varer eksisterer, antall innenfor regler, påkrevd str/draktnr. Returnerer `{lines, errors_count}`. Ny `EditBehovLinesDialog.jsx` med inline-redigering (varetype dropdown, vare-dropdown, str-dropdown fra kataloget, antall, draktnr, kommentar, slett linje, legg til ny linje).
- **Bekreft som behov**: Ny `POST /api/behovsskjema/{sid}/confirm` låser skjemaet (status=bekreftet) og oppretter team_needs-rad knyttet til `behovsskjema_id` + `behovsskjema_po`. Krever 0 feilrader. Ny `POST /api/behovsskjema/{sid}/unlock` for admin som vil re-redigere.
- **Behov.jsx UI**: Ny gul «Importer utfylt»-knapp per rad (kun hvis status != bekreftet). Åpner EditBehovLinesDialog automatisk etter import. «Rediger linjer» (indigo) vises hvis draft_lines finnes. «Lås opp» (grå) på bekreftede skjemaer. Verifisert end-to-end: fylte Excel-mal → import → 2 linjer med 1 valideringsfeil → PUT fjerner feilraden → confirm = 200 → team_needs opprettet.
- **QR per varelinje (iter 13.5)**: `/items/{id}/generate-qr` blokkerer re-generering per variant/vare (409 «QR-kode finnes allerede»). Auto-mark på vareopprettelse fjernet. Inventory-tabellen har ny «Generer QR»-knapp (rød) per varelinje som blir «✓ QR laget» (grønn, disabled) etter første klikk.
- **Testing**: Manuell e2e-verifisering via curl (import 2 linjer, confirm med feil=400, PUT fjerner feil, confirm=200, team_need opprettet).

### Feb 2026 – Quick-order per leverandør + PDF-action-modal (iter 15)
- **Hurtigknapp per leverandør**: `Leverandorer.jsx` har ny grønn «Bestill varer»-knapp (ShoppingCart-ikon) per rad. Åpner `StockOrderDialog` med `lockedSupplierId` prop som låser leverandør-feltet og automatisk filtrerer varelisten til kun denne leverandøren. Varer uten supplier_id = grå/disabled.
- **StockOrderDialog utvidet**: Ny prop `lockedSupplierId` – når satt vises leverandørnavn i tittelen, Select-feltet er disabled, og AddLineDialog filtrerer kun matching varer.
- **OrderActionDialog**: Nytt komponent `/app/frontend/src/components/OrderActionDialog.jsx` som vises etter at bestilling er opprettet. Tilbyr 3 valg: (1) Lagre lokalt (last ned PDF), (2) Skriv ut (åpner PDF i ny fane + trigger print), (3) Send e-post til leverandør med PDF-vedlegg. Pre-utfyller leverandørens e-post hvis registrert.
- **Backend uendret**: Gjenbruker eksisterende endepunkter `POST /api/orders` (allerede støtter is_stock_order=true), `GET /api/orders/{id}/pdf` (PDF-generering via `_build_order_pdf`), `POST /api/orders/{id}/send` (sender PDF som vedlegg via Resend/send_tenant_email med CC til brukeren).
- **Verifisert**: curl-flyt bekreftet: POST /orders → 200, GET /pdf → 2355 bytes PDF-fil, POST /send → 200 (med dummy e-post).

## Backlog
- P1: **Server-refaktor** – Splitt `/app/backend/server.py` (5256 linjer) i routers (items, loans, orders, stock_audit, behovsskjema, admin). Krever først å flytte shared deps (db, require_tenant, require_perm, _log_activity, now_iso, new_id, _xlsx_response, BALL_SIZES, _parse_import_rows) til `/app/backend/deps.py`. Dir `/app/backend/routers/` opprettet som placeholder. KRITISK før flere features for å unngå search_replace-mismatch og lastetid.
- P2: Punkt 4 (iter11-restpost) – Full-featured strict-mode UI der bruker kan velge «Avbryt hvis feil» på import.
- P2: Dangling refs – `DELETE /items` sjekker ikke behovsskjema-linjer.
- P2: ImportPreviewDialog laster filen 2 ganger – kan optimaliseres med `/items/import/commit` som bruker preview-token.
- P2: Punkt 4 – Dedikert Excel-import for lagerbeholdning med forhåndsvisning + leverandør-dropdown-matching (nåværende import-template fungerer, men kan utvides).
- P2: Punkt 1 – Streng hierarki Kategori → Hovedgruppe → Undergruppe (cascading dropdowns). Nåværende er fri tekst.
- P2: Splitt /app/backend/server.py (5063 linjer) i routers (items, loans, orders, stock_audit, behovsskjema, admin). KRITISK før flere features.
- P2: Dangling refs – `DELETE /items` sjekker ikke behovsskjema-linjer.
- P1: Excel Import for Teams og People
- P1: E-postpåminnelse 3 dager før utlåns-forfall
- P2: Cache subscription-status, KID MOD10/11, Faktura GridFS, TTL login_history
