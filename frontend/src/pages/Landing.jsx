import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Package, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Landing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [plans, setPlans] = useState([]);

  useEffect(() => { api.get("/plans").then((r) => setPlans(r.data)).catch(() => {}); }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="brand-gradient text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-display text-2xl font-extrabold">UTSTYRS<span className="text-emerald-200">ROMMET</span></div>
          <div className="flex gap-2">
            {user ? (
              <Button variant="secondary" onClick={() => nav("/app")} data-testid="go-app-btn">Åpne app</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => nav("/innlogging")} data-testid="header-login">Logg inn</Button>
                <Button className="bg-white text-emerald-900 hover:bg-emerald-50" onClick={() => nav("/registrer")} data-testid="header-signup">Start gratis</Button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="brand-gradient text-white pb-20 pt-6">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h1 className="font-display text-5xl sm:text-6xl font-extrabold leading-tight mb-4">Lagerstyring for klubber og idrettslag</h1>
          <p className="text-emerald-100 text-lg max-w-2xl mx-auto">Få full kontroll på utstyr, utlån, lag og skyldig beløp. Mobilvennlig, enkelt og laget for norsk klubbdrift.</p>
          <div className="mt-8 flex gap-3 justify-center flex-wrap">
            <Button className="bg-white text-emerald-900 hover:bg-emerald-50" size="lg" onClick={() => nav("/registrer")} data-testid="hero-signup-btn">Start 14 dager gratis</Button>
            <Button variant="outline" className="border-white text-white hover:bg-white/10" size="lg" onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}>Se priser</Button>
          </div>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto text-left">
            {[
              { icon: Package, title: "Drakter, baller & utstyr", desc: "Håndter størrelser, lokasjon og draktnummer" },
              { icon: Zap, title: "Automatisk skyldig beløp", desc: "Beløp legges på og slettes ved retur" },
              { icon: ShieldCheck, title: "Isolert pr klubb", desc: "Hver kunde har sin egen database" },
            ].map((f) => (
              <div key={f.title} className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
                <f.icon className="h-6 w-6 mb-2 text-emerald-200" />
                <div className="font-semibold">{f.title}</div>
                <div className="text-emerald-100 text-sm mt-1">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="font-display text-4xl font-extrabold text-center">Velg pakken som passer</h2>
        <p className="text-slate-600 text-center mt-2">14 dagers gratis prøve. Ingen kort nødvendig.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
          {plans.map((p, idx) => (
            <Card key={p.key} className={`p-6 ${idx === 1 ? "border-emerald-700 border-2 shadow-lg" : ""}`} data-testid={`plan-card-${p.key}`}>
              {idx === 1 && <div className="text-xs font-bold text-emerald-800 uppercase mb-2">Mest populær</div>}
              <h3 className="font-display text-2xl font-bold">{p.name}</h3>
              <div className="my-4">
                <span className="font-display text-4xl font-extrabold">kr {p.price}</span>
                <span className="text-slate-500">/mnd</span>
              </div>
              <ul className="space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />{f}</li>
                ))}
              </ul>
              <Button className="w-full mt-6 bg-emerald-900 hover:bg-emerald-800" onClick={() => nav(`/registrer?plan=${p.key}`)} data-testid={`select-plan-${p.key}`}>Velg {p.name}</Button>
            </Card>
          ))}
        </div>
      </section>

      <footer className="bg-slate-900 text-slate-400 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between flex-wrap gap-4">
          <div className="font-display text-white font-bold">UTSTYRSROMMET</div>
          <div className="text-sm">© 2026 Utstyrsrommet · Lagerstyring for idrettsklubber</div>
          <Link to="/innlogging" className="text-sm hover:text-white">Logg inn →</Link>
        </div>
      </footer>
    </div>
  );
}
