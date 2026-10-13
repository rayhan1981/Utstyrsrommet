import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 md:p-12 shadow-sm" data-testid="terms-page">
        <Link to="/" className="font-display text-2xl font-extrabold text-red-900 inline-block mb-6">UTSTYRSROMMET</Link>
        <h1 className="font-display text-3xl font-extrabold mb-2">Bruksvilkår</h1>
        <p className="text-sm text-slate-500 mb-8">Sist oppdatert: februar 2026 · Versjon 1.0</p>

        <div className="prose prose-slate max-w-none space-y-5 text-slate-800">

          <section>
            <h2 className="font-display text-xl font-bold">1. Avtalens parter</h2>
            <p>Disse bruksvilkårene («Vilkårene») inngås mellom <strong>Hansen Logistikk</strong>, org.nr. [org.nr.], Norge («Leverandøren», «vi») og den juridiske enheten («Kunden», «du») som registrerer en konto i Utstyrsrommet. Ved å krysse av for aksept og/eller gjennomføre betaling bekrefter Kunden å ha lest, forstått og godtatt Vilkårene.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">2. Tjenesten</h2>
            <p>«Utstyrsrommet» er en skybasert lagerstyrings- og administrasjonsløsning for idrettsklubber. Tjenesten leveres som Software-as-a-Service og tilgjengeliggjøres via nettleser på PC og mobil.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">3. Kontoopprettelse og brukeransvar</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Kunden må oppgi korrekte opplysninger ved registrering.</li>
              <li>Kunden er ansvarlig for all aktivitet som skjer under egen konto og egne tilleggsbrukere.</li>
              <li>Innloggingsinformasjon skal holdes konfidensiell. Mistanke om misbruk skal varsles umiddelbart til <a href="mailto:support@utstyrsrommet.no" className="text-red-800 underline">support@utstyrsrommet.no</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">4. Abonnement og priser</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Tjenesten tilbys i tre pakker med <strong>Introduksjonspris 2026</strong>: Klubb Basic (kr 249/mnd), Klubb Pro (kr 449/mnd) og Klubb Premium (kr 849/mnd). Alle priser er oppgitt eks. mva.</li>
              <li>Ved valg av årlig fakturering gis <strong>50 % rabatt det første året</strong> og deretter <strong>10 % lojalitetsrabatt</strong> så lenge Kunden fortsetter med årlig betaling.</li>
              <li>Premium-pakken inkluderer 5 brukere i tillegg til administrator. Flere brukere kan kjøpes som tillegg til <strong>kr 199,- per bruker per måned</strong>.</li>
              <li>Alle nye kunder får 14 dagers gratis prøveperiode uten krav om betalingskort.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">5. Betaling</h2>
            <p>Betaling skjer via Stripe. Fakturaer og kvitteringer er tilgjengelige i Kundens kontrollpanel. Ved manglende betaling kan Leverandøren suspendere tilgang til Tjenesten etter forutgående varsel.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">6. Oppsigelse</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Hovedabonnementet</strong> kan sies opp når som helst med <strong>3 måneders oppsigelsesfrist</strong> fra og med inneværende betalingsperiode. Tjenesten er aktiv og faktureres i oppsigelsesperioden.</li>
              <li><strong>Tilleggsbestillinger (ekstra brukere)</strong> kan sies opp med <strong>umiddelbar virkning</strong>. Rabatterte perioder refunderes ikke.</li>
              <li>Oppsigelse gjøres fra Abonnement-siden i appen eller ved skriftlig henvendelse til Leverandøren.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">7. Dataeierskap og personvern</h2>
            <p>Kunden eier all data som legges inn i Tjenesten. Leverandøren behandler personopplysninger i tråd med GDPR. Data lagres innenfor EU/EØS. Ved opphør av abonnement vil Kunden ha 30 dagers tilgang til å laste ned data før de slettes.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">8. Tilgjengelighet</h2>
            <p>Leverandøren tilstreber 99,5 % oppetid målt per kalendermåned. Planlagt vedlikehold varsles minst 48 timer i forveien.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">9. Ansvarsbegrensning</h2>
            <p>Leverandørens erstatningsansvar er under enhver omstendighet begrenset til et beløp tilsvarende de siste 12 månedenes abonnementsavgift. Leverandøren er ikke ansvarlig for indirekte tap, herunder tapt fortjeneste.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">10. Endringer i Vilkårene</h2>
            <p>Leverandøren kan endre Vilkårene med minst 30 dagers skriftlig varsel. Fortsatt bruk av Tjenesten etter at endringene har trådt i kraft anses som aksept.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">11. Lovvalg og tvister</h2>
            <p>Vilkårene reguleres av norsk rett. Tvister skal først forsøkes løst i minnelighet. Oslo tingrett er avtalt verneting.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold">12. Kontakt</h2>
            <p>Hansen Logistikk<br />Kontaktperson: Raymond Dalgård Hansen<br />Generell kontakt: <a href="mailto:kontakt@utstyrsrommet.no" className="text-red-800 underline">kontakt@utstyrsrommet.no</a><br />Support: <a href="mailto:support@utstyrsrommet.no" className="text-red-800 underline">support@utstyrsrommet.no</a><br />Admin/eier: <a href="mailto:Raymond@utstyrsrommet.no" className="text-red-800 underline">Raymond@utstyrsrommet.no</a><br />Telefon: 90 96 70 88</p>
          </section>
        </div>

        <div className="mt-10 flex justify-between items-center">
          <Link to="/"><Button variant="outline">Tilbake</Button></Link>
          <div className="text-xs text-slate-400">© 2026-2036 Hansen Logistikk</div>
        </div>
      </div>
    </div>
  );
}
