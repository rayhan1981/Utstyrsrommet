# UTSTYRSROMMET - Product Requirements Document

## Original Problem
Komplett lagerstyrings- og administrasjonssystem for idrettsklubb som fungerer på mobil og PC. Multi-tenant SaaS med Stripe-betaling, 3 pakker (Basic/Pro/Deluxe), plattformeier-impersonering, QR-skanning, varsler, faktura-generering og 7-dagers gratis prøveperiode.

## Architecture
- Backend: FastAPI + Motor (MongoDB), JWT, Emergent email, reportlab (PDF), qrcode + PIL
- Frontend: React 19 + shadcn/ui + Tailwind, Sonner
- Multi-tenancy: `tenant_id` på alle data

## Users
- Platform Owner: raymond.d.hansen@gmail.com
- Admin per kunde: full tilgang + role_title fritekst
- Standard brukere: rettigheter per modul

## Branding
- Tittel: UTSTYRSROMMET, favicon shield-logo (16/32/48/180/192/512 + ICO), manifest.json

## Varenummersystem (iter 22) ✅ FASE 1 KOMPLETT
- **Hovedvarenummer**: Fritekst (bokstaver+tall), bevarer innledende nuller, brukerstyrt. Påkrevd ved save.
- **Automatisk komplett varenummer**: Format `Hovedvarenummer-Størrelse-Draktnummer`. Ensifret draktnr nullpaddes (8→08). Bokstavstørrelser i STORE bokstaver (XS/M/XL). Numeriske størrelser beholdes (164). Tomme deler hoppes over.
  - Eksempler: `HJEM100-M-08`, `HJEM100-164-03`, `BORTE100-164`, `HJEM100`
- **Backend-validering**: Unikt komplett varenummer per tenant. Backend-helpere `_compute_full_number()`, `_validate_full_number_uniqueness()`.
- **Idempotent migrering** på backend-oppstart: Backfiller `main_item_number` + `full_number` på alle items. Legacy fallback: slugified navn.
- **Import gjenbruker variant**: Hvis identisk (size+jersey) finnes under samme hovedvare, økes antall – ingen duplikatlinje.
- **Excel-mal**: `Hovedvarenummer` som første kolonne. Tekst-format på varenr-kolonner. Legacy-mal (uten Hovedvarenummer) fortsatt lesbar.
- **Excel-eksport**: Varenummer første kolonne.
- **Varetelling export/import**: Varenummer første kolonne (etter skjult Linje-ID), importen leser Talt antall fra ny posisjon.
- **Bestillings-PDF**: Varenr første kolonne.
- **Frontend Inventory-dialog**: Hovedvarenummer-input (fritekst, påkrevd) + live-forhåndsvisning av komplette varenummer for alle varianter i grønn boks.
- **Frontend Inventory-liste**: Ny «Varenr»-kolonne (etter bilde) med rødt mono-badge med full_number.

## Webshop-style kategoribar (iter 22b) ✅
- Over varetabellen: «Vis alle varer (N)»-knapp + én knapp per unike kategori med antall (N).
- Aktiv knapp får rødt fyll. Package-ikon på kategoriknapper, LayoutGrid på «Vis alle».
- Filtrering: Klikk kategoriknapp → tabellen filtreres til kun varer i den kategorien. «Vis alle» → nullstiller.

## Soft-delete + role_title + Email-signatur (iter 20) ✅
- Soft-delete leverandører med Angre-toast + Papirkurv-dialog.
- Deaktiver/Aktiver-knapp på leverandører (iter 21).
- role_title-fritekstfelt på brukere (admin-styrt).
- Automatisk HTML-signatur på alle brukerutløste e-poster.

## Backlog
- **P0 (igjen fra iter 22)**: FASE 2 – Varenr første kolonne i Behovsskjema-PDF, Varemottak-PDF, Utlån/Retur-PDF, Team-utstyrsliste-PDF.
- **P0**: QR-etikett tekst oppdateres med full_number.
- **P1 Server-refaktor**: Splitt `/app/backend/server.py` (nå 5760+ linjer) i routers.
- P1: Excel Import for Teams og People.
- P1: E-postpåminnelse 3 dager før utlåns-forfall.
- P2: Konflikt-UI for duplikat-varianter ved import (dagens: 400 med beskjed).
- P2: Auto-purge soft-slettede leverandører etter 30 dager (cron).
- P2: Klubb-logo i e-postsignatur når klubben har lastet opp.
