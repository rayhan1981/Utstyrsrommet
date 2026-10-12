import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import {
  BookOpen, Rocket, Package, ArrowLeftRight, Users as UsersIcon, QrCode,
  PackagePlus, FileSpreadsheet, CreditCard, Download, HelpCircle,
} from "lucide-react";

// Innholdet er speilet 1:1 i backend-PDF-en (HELP_MANUAL_SECTIONS i server.py).
// Oppdater begge steder hvis du endrer teksten.
const SECTIONS = [
  {
    id: "kom-i-gang", icon: Rocket, title: "Kom i gang",
    paragraphs: [
      "Velkommen til UTSTYRSROMMET – klubbens komplette system for utstyr, lager og lagstyring.",
      "Første gang du logger inn blir du bedt om å fullføre klubbinformasjonen under «Klubbinnstillinger → Klubb (logo/info)». Last opp klubblogo, kontaktinformasjon og signaturdetaljer slik at e-poster og PDF-er får riktig avsender.",
      "Legg deretter til lag under «Klubbinnstillinger → Lag», opprett varer under «Utstyr», og registrer støtteapparat (trenere, lagledere, foreldrekontakter) direkte på hvert lag.",
      "Sidepanelet grupperer funksjoner i tre bolker: driftsmoduler (Dashboard, Utstyr, Utlån osv.), Klubbinnstillinger (Lag, Personer, Klubb-info) og admin (Brukere, Abonnement).",
    ],
  },
  {
    id: "utstyr", icon: Package, title: "Utstyr og lagerstyring",
    paragraphs: [
      "Alle varer forvaltes under «Utstyr». Hver vare har et hovedvarenummer (f.eks. HJEM100) og auto-genererte varianter som får varenummer sammensatt av hovednummer + størrelse + eventuelt draktnummer (f.eks. HJEM100-M-10).",
      "Taksonomien er tre-delt: Kategori → Hovedgruppe → Undergruppe. Treffer du «Vis alle varer» får du et foldet hierarkisk tre; klikk på en kategoriknapp for å få en flat produktliste for den kategorien.",
      "For klær og baller legges hver størrelse som egen varelinje med egen lokasjon og eget lager. Draktnummer kan knyttes per linje for sporing på enkeltspiller.",
      "Lav-lager-advarsel vises automatisk når antall faller til 3 eller lavere.",
    ],
  },
  {
    id: "utlan", icon: ArrowLeftRight, title: "Lån ut og returner",
    paragraphs: [
      "Trykk «Nytt utlån» (fra lag-detalj eller fra «Utlån & Retur») for å registrere utlevering. Velg lag, person (fra lagets støtteapparat eller egne personer), vare og størrelse.",
      "Størrelsesvelgeren er søkbar: skriv f.eks. «M 10» for å finne M-størrelse med draktnummer 10. Lokasjon vises også i hver rad.",
      "Modus kan være «Lån» (med skyldig beløp hvis ikke returnert) eller «Utlevering» (forbruksvare uten returkrav).",
      "Ved retur: Åpne utlånet og trykk «Returner». Angi antall returnert, eventuell skade og om det skal faktureres eller avskrives.",
      "Lag-utstyrs-PDF kan sendes til lagleder/hovedtrener med ett klikk fra lag-detaljer – inkluderer varenummer, størrelse, pris og frist.",
    ],
  },
  {
    id: "lag", icon: UsersIcon, title: "Lag",
    paragraphs: [
      "Opprett lag under «Klubbinnstillinger → Lag». Bruk «Nytt lag»-knappen og velg lagsnavn + aldersklasse fra forhåndsdefinerte alternativer.",
      "Legg til støtteapparat med knappen «+ Legg til støtteapparat». Velg rolle (Hovedtrener, Lagleder, Trener, Dugnadsansvarlig, Foreldrekontakt, Kasserer, Annet), fyll ut navn, kontaktinformasjon og eventuelle notater.",
      "Postnummer gir automatisk oppslag av stedsnavn via Kartverket.",
      "En person kan tilhøre flere lag med ulik rolle i hvert lag. I personinformasjons-dialogen kan du trykke «+ Legg til i annet lag» for å knytte samme kontaktinformasjon til et nytt lag med egen rolle.",
      "På lag-detaljvisning vises hver person med rolle (øverst i mindre font), navn og telefon på neste linje, og fire kompakte knapper: Vis info, Rediger, Send e-post og Slett (eller Fjern fra lag dersom personen er på flere lag).",
    ],
  },
  {
    id: "qr", icon: QrCode, title: "QR-koder",
    paragraphs: [
      "QR-koder genereres per varenummer / varelinje – aldri én QR per enhet. Dette gjelder uavhengig av beholdningen.",
      "«Generer QR» på rad-nivå aktiverer QR-kode for den varelinjen. «Generer QR for alle» aktiverer alle manglende QR-koder i hele lageret.",
      "«Vis QR» på en varelinje åpner QR-dialogen med nøyaktig én QR-kode. Her kan du velge: 1 kopi, antall = beholdning, eller antall = beholdning + 2 hyllemerker. Deretter kan du skrive ut, laste ned PDF med flere kopier, eller laste ned enkelt PNG.",
      "Utskriftsstørrelsen kan være Liten (2 cm), Medium (6 cm) eller Stor (10 cm). Varenummer står i fete typer under hver QR, med varenavn/størrelse som sekundærlinje.",
      "Slett QR-kode per linje med «Slett QR»-knappen, eller nullstill alle QR-koder i klubben med «Slett alle QR» (admin). Alle sletteoperasjoner bekreftes med popup.",
    ],
  },
  {
    id: "varemottak", icon: PackagePlus, title: "Varemottak",
    paragraphs: [
      "Når bestilte varer kommer inn registreres de under «Varemottak». Skann QR-koden fra pakkseddelen (hvis tilgjengelig) eller velg vare + størrelse manuelt.",
      "Oppgi antall mottatt, eventuell bestillingsreferanse (PO-nummer) og kommentar. Lageret oppdateres umiddelbart.",
      "«Åpne bestillinger»-tabellen viser hva som er bestilt men ikke mottatt ennå, med varenummer som første kolonne.",
      "«Siste varemottak» viser en logg over alle registrerte mottak. Du kan filtrere på dato og laste ned en Varemottak-PDF (med varenummer som første kolonne) direkte fra UI-et.",
    ],
  },
  {
    id: "excel", icon: FileSpreadsheet, title: "Excel import/eksport",
    paragraphs: [
      "Last ned mal under «Utstyr → Last ned mal». Malen har varenummer som første kolonne, og egne rader per varelinje (størrelse + draktnummer).",
      "Fyll ut malen i Excel / LibreOffice, og last opp igjen under «Importer Excel». Du får en forhåndsvisning som viser hva som vil bli opprettet, oppdatert eller hoppet over – ingen endringer før du bekrefter.",
      "«Eksporter Excel» laster ned hele dagens lager som en ferdig fil – nyttig for backup, revisjon eller å dele med regnskap.",
      "Både import og eksport bruker samme kolonnerekkefølge: Varenummer, Varenavn, Kategori, Hovedgruppe, Undergruppe, Type, Størrelse, Draktnr, Antall, Pris, Lokasjon, m.m.",
    ],
  },
  {
    id: "abonnement", icon: CreditCard, title: "Abonnement",
    paragraphs: [
      "UTSTYRSROMMET tilbys i tre nivåer: Basis, Pro og Deluxe. Alle planer har 14 dagers gratis prøveperiode der du får Deluxe-funksjoner.",
      "Du finner din gjeldende plan under «Abonnement» i sidepanelet – kun admin og klubb-eier ser denne.",
      "Oppgradering og nedgradering gjøres via Stripe. Faktura, betalingsinformasjon og historikk administreres i Stripe-kundeportalen – klikk «Administrer abonnement» for å åpne denne.",
      "QR-koder og Varetelling er inkludert kun i Deluxe-planen. Alle andre moduler (Lag, Utstyr, Utlån, Varemottak, Behov, Bestillinger, Leverandører) er tilgjengelige på alle planer.",
      "Spørsmål om fakturering eller plan? Kontakt support via «Hjelpesenter → Kontakt» eller send e-post til support-adressen i klubbinformasjonen.",
    ],
  },
];

export default function HelpCenter() {
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await api.get("/help/manual-pdf", { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = `hjelpesenter_${stamp}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Klarte ikke å generere PDF");
    } finally { setDownloading(false); }
  };

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-red-900" />
            Hjelpesenter
          </h1>
          <p className="text-sm text-slate-500">Alt du trenger å vite for å bruke UTSTYRSROMMET effektivt.</p>
        </div>
        <Button
          onClick={downloadPdf}
          disabled={downloading}
          className="bg-red-900 hover:bg-red-800"
          data-testid="download-help-pdf-btn"
        >
          <Download className="h-4 w-4 mr-2" />
          {downloading ? "Lager PDF…" : "Last ned som PDF"}
        </Button>
      </div>

      {/* Innholdsfortegnelse */}
      <Card className="p-5" data-testid="help-toc">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <HelpCircle className="h-4 w-4" />
          Innhold
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollTo(s.id)}
              className="text-left px-3 py-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-red-50 hover:border-red-200 transition-colors flex items-center gap-2 text-sm"
              data-testid={`help-toc-${s.id}`}
            >
              <s.icon className="h-4 w-4 text-red-900 shrink-0" />
              <span className="truncate">
                <span className="text-slate-400 mr-1">{i + 1}.</span>
                {s.title}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Seksjonene */}
      {SECTIONS.map((s, i) => (
        <Card key={s.id} id={s.id} className="p-6 scroll-mt-6" data-testid={`help-section-${s.id}`}>
          <div className="flex items-start gap-3 mb-4 pb-3 border-b border-slate-100">
            <div className="bg-red-50 border border-red-100 rounded-lg p-2">
              <s.icon className="h-5 w-5 text-red-900" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                Seksjon {i + 1}
              </div>
              <h2 className="text-xl font-bold text-slate-900">{s.title}</h2>
            </div>
          </div>
          <ul className="space-y-3">
            {s.paragraphs.map((p, idx) => (
              <li key={idx} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                <span className="text-red-900 font-bold shrink-0 mt-0.5">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card className="p-5 bg-slate-50 border-slate-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-slate-600">
            Fant du ikke svaret? Spør administrator i klubben eller send en e-post til support-adressen i klubbinformasjonen.
          </div>
          <Button variant="outline" onClick={downloadPdf} disabled={downloading} data-testid="download-help-pdf-btn-bottom">
            <Download className="h-4 w-4 mr-2" />
            {downloading ? "Lager PDF…" : "Last ned som PDF"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
