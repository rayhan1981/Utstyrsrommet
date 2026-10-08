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
- role_title (fritekst): admin-styrt tittel/rolle som vises i brukerlisten og i e-postsignaturer. Bruker kan ikke endre dette selv.

## Branding (Feb 2026)
- Tittel: UTSTYRSROMMET (på alle sider)
- Favicon: UTSTYRSROMMET shield-logo i alle størrelser (16/32/48/180/192/512 + ICO)
- Manifest.json med name/short_name=UTSTYRSROMMET, theme_color=#991b1b
- Open Graph + Twitter card tags
- html lang="nb"

## Implemented (seneste iterasjoner)

### Feb 2026 – iter 11-18 (tidligere)
11-punkts forbedring, Excel-preview, Varemottak-vs-bestilling, mappe-visning, Behovsskjema import+rediger+bekreft, Quick-order per leverandør, taxonomy-fix, drag-and-drop, routers-ekstraksjon startet.

### Feb 2026 – iter 19: 3-nivå hierarki + Mobilvennlig + Hierarki-søk ✅
- Fullt 3-nivå kategorihierarki i Inventory (Kategori → Hovedgruppe → Undergruppe → Vare).
- `(Uten kategori)` / `(Uten hovedgruppe)` / `(Uten undergruppe)` bucket per nivå.
- Antall i parentes = deep count.
- Responsive Tailwind-klasser skjuler mindre viktige kolonner på mobil, null horisontal scroll på 390px.
- getRowId=_id fjerner React duplicate-key warning for variants.
- "Søk på tvers av hierarki": auto-ekspander alle mapper under aktivt søk/filter, med hint-banner.
- Deployment: live på utstyrsrommet.no med ny tittel og favicon.

### Feb 2026 – iter 20: Soft-delete leverandører + role_title + Email-signatur ✅
- **Soft-delete leverandører med undo**:
  - `DELETE /api/suppliers/{sid}` – soft-delete alltid (setter `deleted_at`, `deleted_by_user_id`, `deleted_by_name`, `active:false`)
  - `GET /api/suppliers` – filtrerer ut slettede automatisk
  - `GET /api/suppliers/trash` – lister slettede siste 30 dager (admin-only)
  - `POST /api/suppliers/{sid}/restore` – gjenoppretter en soft-slettet leverandør (admin-only)
  - Frontend: Toast med "Angre"-knapp (10s) rett etter sletting + "Papirkurv (N)"-knapp som åpner dialog med gjenopprettings-knapp per rad
- **Rolle/Tittel-fritekstfelt på brukere** (admin-styrt):
  - `UserCreateIn.role_title: Optional[str] = ""`, `UserUpdateIn.role_title: Optional[str] = None`
  - `MyProfileIn` har IKKE `role_title` → brukere kan ikke endre sitt eget via `/auth/me/profile`
  - Vises som egen kolonne i brukerlisten
  - Admin-dialog: eget felt med "Kun admin kan endre"-badge + helpertekst
  - Backfill: `role_title=""` på legacy users
- **Automatisk e-postsignatur på alle brukerutløste e-poster**:
  - Helper `_build_user_signature_html(user)` genererer HTML-signatur med Navn + Rolle/Tittel + Tlf + E-post
  - `send_tenant_email(... sender_user=user)` og `_send_email_with_attachment(... sender_user=user)` appender signaturen til HTML-body
  - Oppdaterte endpoints: `POST /orders/{oid}/send`, `POST /behovsskjema/{sid}/send`, `POST /teams/{team_id}/send-equipment-list`, `POST /orders/{oid}/notify-lagleder`, `POST /invoices/{invoice_id}/send`, `POST /email-settings/test`
- Testing: iteration_20.json – 100% backend (7/7 pytest), 100% frontend (full Playwright flow).

## Backlog
- **P1: Server-refaktor** – Splitt `/app/backend/server.py` (nå 5560+ linjer) i routers.
- P1: Excel Import for Teams og People.
- P1: E-postpåminnelse 3 dager før utlåns-forfall.
- P2: `/api/email-settings/test` returnerer 502 fra Cloudflare på provider-feil; endre til 200 + `{ok:false,error}` så UI kan vise årsak.
- P2: Dangling refs – `DELETE /items` sjekker ikke behovsskjema-linjer.
- P2: ImportPreviewDialog laster filen 2 ganger – optimaliser med `/items/import/commit` preview-token.
- P2: Dedikert Excel-import for lagerbeholdning m/ forhåndsvisning + leverandør-dropdown-matching.
- P2: Cache subscription-status, KID MOD10/11, Faktura GridFS, TTL login_history.
- P2: Auto-purge soft-slettede leverandører etter 30 dager (cron).
