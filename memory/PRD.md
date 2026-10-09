# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe), plattformeier-impersonering, QR-skanning, varsler, faktura-generering og 7-dagers gratis prøveperiode.

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT, Emergent email, reportlab (PDF), qrcode + PIL
- Frontend: React 19 + shadcn/ui + Tailwind, Sonner, html5-qrcode
- Multi-tenancy: `tenant_id` på alle data
- Stripe Billing: Checkout, add-on seats, 50% kupong første år

## Users
- Platform Owner: raymond.d.hansen@gmail.com (deluxe-workspace)
- Admin per kunde: full tilgang
- Standard brukere: rettigheter per modul
- role_title (fritekst): admin-styrt tittel/rolle som vises i brukerlisten og i e-postsignaturer. Bruker kan ikke endre dette selv.

## Branding (Feb 2026)
- Tittel: UTSTYRSROMMET på alle sider
- Favicon: UTSTYRSROMMET shield-logo i alle størrelser (16/32/48/180/192/512 + ICO)
- Manifest.json med name/short_name=UTSTYRSROMMET, theme_color=#991b1b
- Open Graph + Twitter card tags, html lang="nb"

## Implemented (seneste iterasjoner)

### Feb 2026 – iter 11-18 (tidligere)
11-punkts forbedring, Excel-preview, Varemottak-vs-bestilling, mappe-visning, Behovsskjema import+rediger+bekreft, Quick-order per leverandør, taxonomy-fix, drag-and-drop, routers-ekstraksjon startet.

### Feb 2026 – iter 19: 3-nivå hierarki + Mobilvennlig + Hierarki-søk ✅
- 3-nivå kategorihierarki, kompakt mobil, auto-ekspander ved søk.

### Feb 2026 – iter 20: Soft-delete leverandører + role_title + Email-signatur ✅
- Soft-delete leverandører med Angre-toast + Papirkurv-dialog.
- role_title-fritekstfelt på brukere (admin-styrt).
- Automatisk HTML-signatur på alle brukerutløste e-poster.

### Feb 2026 – iter 21: Deaktiver/Aktiver leverandører ✅
- **Nytt endpoint**: `POST /api/suppliers/{sid}/toggle-active` (admin-only). Veksler `active`-bool. Lagrer `active_changed_at` og `active_changed_by` for sporbarhet. 400 hvis leverandøren er soft-slettet (må gjenopprettes først).
- **Frontend**: Ny amber "Deaktiver"-knapp (PowerOff-ikon) på hver leverandør-rad. Ved deaktivering endres til grønn "Aktiver"-knapp (Power-ikon). Confirm-dialog forklarer at historikk beholdes.
- Deaktiverte leverandører: skjules fra "Bestill varer"-hurtighandling + lagerbestillinger (`/items/by-supplier`), men vises fortsatt i leverandørlisten med gråtone og "Deaktivert"-badge. All ordrehistorikk beholdes.
- Testing: Verifisert via curl (toggle begge veier + 400 på deleted) + screenshot (3 av 3 knapper vises).

## Backlog
- **P1: Server-refaktor** – Splitt `/app/backend/server.py` (nå 5575+ linjer) i routers.
- P1: Excel Import for Teams og People.
- P1: E-postpåminnelse 3 dager før utlåns-forfall.
- P2: `/api/email-settings/test` returnerer 502 fra Cloudflare på provider-feil; endre til 200 + `{ok:false,error}` så UI kan vise årsak.
- P2: Dangling refs – `DELETE /items` sjekker ikke behovsskjema-linjer.
- P2: Dedikert Excel-import for lagerbeholdning m/ forhåndsvisning + leverandør-dropdown-matching.
- P2: Cache subscription-status, KID MOD10/11, Faktura GridFS, TTL login_history.
- P2: Auto-purge soft-slettede leverandører etter 30 dager (cron).
- P2: Klubb-logo i e-postsignaturen når klubben har lastet opp.
