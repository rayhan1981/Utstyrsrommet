import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Package, ShieldCheck, Zap, Sparkles } from "lucide-react";
import { api } from "@/lib/api";

export default function Landing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [plans, setPlans] = useState([]);

  useEffect(() => { api.get("/plans").then((r) => setPlans(r.data)).catch(() => {}); }, []);

  const trialCard = {
    key: "trial",
    name: "Prøveversjon",
    price: 0,
    priceLabel: "Gratis",
    duration: "7 dager",
    features: [
      "Full Deluxe-tilgang i 7 dager",
      "Ingen betalingskort kreves",
      "Ubegrenset antall lag og personer",
      "Varer, drakter, baller, QR, varetelling",
      "Avslutt når som helst",
    ],
    cta: "Start gratis",
    highlight: true,
  };

  const paid = (plans || []).map((p) => ({ ...p, priceLabel: `kr ${p.price}`, duration: "pr måned" }));
  const all = [trialCard, ...paid];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Subtle red radial glow background */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true"
           style={{ background: "radial-gradient(1200px 600px at 70% -10%, rgba(220,38,38,0.18) 0%, transparent 60%), radial-gradient(900px 500px at 10% 110%, rgba(220,38,38,0.12) 0%, transparent 60%)" }} />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0a0a0a]/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="UTSTYRSROMMET" className="h-11 w-11 object-contain shrink-0" style={{ filter: "drop-shadow(0 0 10px rgba(220,38,38,0.35))" }} />
            <div className="font-display text-xl sm:text-2xl font-black tracking-tight">
              <span className="chrome-text">UTSTYRS</span><span className="red-gloss-text">ROMMET</span>
            </div>
          </div>
          {user ? (
            <Button
              className="bg-transparent border border-red-500 text-red-500 hover:bg-red-500/10 hover:text-red-400"
              onClick={() => nav("/app")}
              data-testid="go-app-btn"
            >
              Åpne app
            </Button>
          ) : (
            <Button
              variant="outline"
              className="bg-transparent border border-red-500 text-red-500 hover:bg-red-500/10 hover:text-red-400"
              onClick={() => nav("/innlogging")}
              data-testid="header-login"
            >
              Logg inn
            </Button>
          )}
        </div>
      </header>

      <section className="relative z-10 pt-24 pb-24">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-200 mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            Laget for norsk klubbdrift
          </div>
          <h1 className="font-display text-5xl sm:text-7xl font-black leading-[1.05] mb-5 tracking-tight">
            <span className="chrome-text">Lagerstyring</span>
            <br />
            <span>for </span><span className="red-gloss-text">klubber &amp; idrettslag</span>
          </h1>
          <p className="text-zinc-300 text-lg max-w-2xl mx-auto">
            Full kontroll på utstyr, utlån, lag og skyldig beløp. Mobilvennlig, elegant og bygget for å skalere med klubben din.
          </p>
          <div className="mt-10 flex justify-center">
            <Button
              variant="outline"
              className="border-white/20 text-white bg-white/5 hover:bg-white/10 hover:text-white backdrop-blur"
              size="lg"
              onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}
              data-testid="hero-see-plans-btn"
            >
              Se pakker &amp; priser
            </Button>
          </div>

          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto text-left">
            {[
              { icon: Package, title: "Drakter, baller & utstyr", desc: "Håndter størrelser, lokasjon og draktnummer." },
              { icon: Zap, title: "Automatisk skyldig beløp", desc: "Beløp påføres og slettes ved retur." },
              { icon: ShieldCheck, title: "Isolert per klubb", desc: "Hver kunde har sin egen database." },
            ].map((f) => (
              <div key={f.title} className="lux-dark lux-ring rounded-xl p-5 transition">
                <div className="h-9 w-9 rounded-md bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-3">
                  <f.icon className="h-5 w-5 text-red-400" />
                </div>
                <div className="font-semibold">{f.title}</div>
                <div className="text-zinc-400 text-sm mt-1">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="chrome-hr" />

      <section id="pricing" className="relative z-10 max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="font-display text-4xl sm:text-5xl font-black">
            <span className="chrome-text">Velg pakken </span><span className="red-gloss-text">som passer</span>
          </h2>
          <p className="text-zinc-400 mt-3">Start gratis i 7 dager med full Deluxe. Oppgrader eller avbryt når som helst.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {all.map((p) => {
            const isTrial = p.key === "trial";
            return (
              <Card
                key={p.key}
                className={`relative p-6 rounded-xl transition flex flex-col text-white ${isTrial ? "lux-dark lux-ring border-red-500/40" : "bg-zinc-900/70 border-white/10 hover:border-red-500/40"}`}
                data-testid={`plan-card-${p.key}`}
              >
                {isTrial && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-wider uppercase px-3 py-1 rounded-full bg-red-600 text-white shadow-lg">
                    7 dager gratis
                  </div>
                )}
                {p.key === "pro" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-wider uppercase px-3 py-1 rounded-full bg-white text-black shadow-lg">
                    Mest populær
                  </div>
                )}
                <h3 className="font-display text-2xl font-black">{p.name}</h3>
                <div className="my-4">
                  <span className="font-display text-4xl font-black">{p.priceLabel}</span>
                  <span className="text-zinc-400 ml-1 text-sm">/ {p.duration}</span>
                </div>
                <ul className="space-y-2 text-sm text-zinc-200 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className={`w-full mt-6 ${isTrial ? "bg-red-600 hover:bg-red-500 text-white" : "bg-white text-black hover:bg-zinc-200"}`}
                  onClick={() => nav(isTrial ? "/registrer" : `/registrer?plan=${p.key}`)}
                  data-testid={`select-plan-${p.key}`}
                >
                  {isTrial ? p.cta : `Velg ${p.name}`}
                </Button>
              </Card>
            );
          })}
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="UTSTYRSROMMET" className="h-8 w-8 object-contain" />
            <div className="font-display text-white font-black">
              <span className="chrome-text">UTSTYRS</span><span className="red-gloss-text">ROMMET</span>
            </div>
          </div>
          <div className="text-xs text-zinc-500">© 2026 Hansen Logistikk · Lagerstyring for idrettsklubber</div>
          <a href="mailto:kontakt@utstyrsrommet.no" className="text-xs text-zinc-400 hover:text-white">kontakt@utstyrsrommet.no</a>
        </div>
      </footer>
    </div>
  );
}
