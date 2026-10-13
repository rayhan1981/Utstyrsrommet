import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, Check } from "lucide-react";
import { toast, Toaster } from "sonner";

export default function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState(null);
  const [form, setForm] = useState({ club_name: "", owner_name: "", owner_email: "", owner_phone: "", postal_code: "", city: "", password: "" });

  // Automatisk oppslag av poststed via Kartverket (geonorge) når 4-sifret postnr er fylt inn
  useEffect(() => {
    const zip = (form.postal_code || "").trim();
    if (!/^\d{4}$/.test(zip)) return;
    let cancelled = false;
    fetch(`https://ws.geonorge.kartverket.no/adresser/v1/sok?postnummer=${zip}&treffPerSide=1`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const sted = data?.adresser?.[0]?.poststed || "";
        if (sted) setForm((f) => ({ ...f, city: sted }));
      })
      .catch(() => { /* stille – brukeren kan taste manuelt */ });
    return () => { cancelled = true; };
  }, [form.postal_code]);

  const submit = async (e) => {
    e.preventDefault();
    if (!acceptTerms) { toast.error("Du må godta bruksvilkårene"); return; }
    setLoading(true);
    try {
      const res = await signup({ ...form, accept_terms: true });
      setWelcome(res);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const closeWelcome = () => { setWelcome(null); nav("/app"); };

  const inputCls = "bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:border-red-500/60 focus-visible:ring-red-500/20";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white py-10 px-4 relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true"
           style={{ background: "radial-gradient(1200px 700px at 70% -10%, rgba(220,38,38,0.18) 0%, transparent 60%), radial-gradient(900px 500px at 10% 110%, rgba(220,38,38,0.12) 0%, transparent 60%)" }} />
      <div className="relative z-10 max-w-5xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-3 mb-6">
          <img src="/logo.png" alt="UTSTYRSROMMET" className="h-12 w-12 object-contain" style={{ filter: "drop-shadow(0 0 10px rgba(220,38,38,0.35))" }} />
          <div className="font-display text-xl font-black tracking-tight">
            <span className="chrome-text">UTSTYRS</span><span className="red-gloss-text">ROMMET</span>
          </div>
        </Link>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 lux-dark rounded-2xl p-7">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-200 mb-3">
              <Sparkles className="h-3 w-3" /> 7 dager gratis Premium
            </div>
            <h1 className="font-display text-3xl font-black">Opprett klubbkonto</h1>
            <p className="text-zinc-400 text-sm mt-1">Få full tilgang til Utstyrsrommet Premium i 7 dager. Ingen betalingskort. Ingen bindingstid.</p>
            <form onSubmit={submit} className="space-y-3 mt-6">
              <div><Label className="text-zinc-300">Klubbnavn</Label><Input required value={form.club_name} onChange={(e) => setForm({ ...form, club_name: e.target.value })} data-testid="signup-club" className={inputCls} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label className="text-zinc-300">Ditt fulle navn</Label><Input required value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} data-testid="signup-name" className={inputCls} /></div>
                <div><Label className="text-zinc-300">Telefon</Label><Input value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} data-testid="signup-phone" className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><Label className="text-zinc-300">Postnummer</Label><Input inputMode="numeric" maxLength={4} value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value.replace(/\D/g, "").slice(0, 4) })} data-testid="signup-postal-code" className={inputCls} /></div>
                <div className="sm:col-span-2"><Label className="text-zinc-300">Sted</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="signup-city" className={inputCls} /></div>
              </div>
              <div><Label className="text-zinc-300">E-post</Label><Input type="email" required value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} data-testid="signup-email" className={inputCls} /></div>
              <div><Label className="text-zinc-300">Passord (min 6 tegn)</Label><Input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="signup-password" className={inputCls} /></div>

              <label className="flex items-start gap-2 text-sm pt-2 cursor-pointer text-zinc-300">
                <Checkbox checked={acceptTerms} onCheckedChange={setAcceptTerms} data-testid="signup-accept-terms" className="border-white/30 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600" />
                <span>Jeg har lest og godtar <Link to="/vilkar" target="_blank" className="text-red-400 font-semibold underline hover:text-red-300">bruksvilkårene</Link>.</span>
              </label>

              <Button type="submit" disabled={loading || !acceptTerms} className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold" data-testid="signup-submit">
                {loading ? "Oppretter…" : "Start 7 dagers gratis prøveperiode"}
              </Button>
              <p className="text-xs text-zinc-500 text-center">Har du allerede konto? <Link to="/innlogging" className="text-red-400 font-semibold hover:text-red-300">Logg inn</Link></p>
            </form>
          </div>

          <div className="lg:col-span-2 lux-dark rounded-2xl p-7">
            <h3 className="font-display text-xl font-black mb-3">Dette får du i prøveperioden</h3>
            <ul className="space-y-2 text-sm text-zinc-200">
              {[
                "Full Premium-tilgang i 7 dager",
                "Ubegrenset antall lag og personer",
                "Varer, drakter, baller med størrelse+lokasjon",
                "Utlån, retur og automatisk skyldig beløp",
                "QR-koder for lyn-raskt utlån via mobil",
                "Varetelling og Excel-import",
                "Fakturaer og klubblogo",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500 mt-4">Når prøveperioden avsluttes velger du mellom Basic, Pro eller Premium – eller lar kontoen hvile i read-only.</p>
          </div>
        </div>
      </div>

      <Dialog open={!!welcome} onOpenChange={(o) => !o && closeWelcome()}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-red-500" />Velkommen til Utstyrsrommet!</DialogTitle>
            <DialogDescription>
              Du har nå fått full tilgang til Utstyrsrommet Premium i 7 dager.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-slate-600 space-y-2">
            <p>Utforsk alle funksjoner og se hvordan Utstyrsrommet kan gi klubben full kontroll på utstyr, drakter og lager.</p>
            <p className="font-semibold">Ingen betalingskort. Ingen bindingstid.</p>
            {welcome?.customer_number && <p className="text-xs text-slate-500">Kundenummer: <span className="font-mono font-bold">{welcome.customer_number}</span></p>}
          </div>
          <DialogFooter>
            <Button onClick={closeWelcome} className="w-full bg-red-700 hover:bg-red-600 text-white" data-testid="welcome-start-btn">Start med Utstyrsrommet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster richColors position="top-right" theme="dark" />
    </div>
  );
}
