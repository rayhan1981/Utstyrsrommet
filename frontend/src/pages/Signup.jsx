import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
  const [form, setForm] = useState({ club_name: "", owner_name: "", owner_email: "", owner_phone: "", password: "" });

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

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-3 mb-6">
          <img src="/logo.png" alt="UTSTYRSROMMET" className="h-12 w-auto" />
        </Link>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Card className="lg:col-span-3 p-6">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 text-amber-800 mb-3">
              <Sparkles className="h-3 w-3" /> 7 dager gratis Deluxe
            </div>
            <h1 className="font-display text-3xl font-extrabold">Opprett klubbkonto</h1>
            <p className="text-slate-600 text-sm mt-1">Få full tilgang til Utstyrsrommet Deluxe i 7 dager. Ingen betalingskort. Ingen bindingstid.</p>
            <form onSubmit={submit} className="space-y-3 mt-6">
              <div><Label>Klubbnavn</Label><Input required value={form.club_name} onChange={(e) => setForm({ ...form, club_name: e.target.value })} data-testid="signup-club" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>Ditt fulle navn</Label><Input required value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} data-testid="signup-name" /></div>
                <div><Label>Telefon</Label><Input value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} /></div>
              </div>
              <div><Label>E-post</Label><Input type="email" required value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} data-testid="signup-email" /></div>
              <div><Label>Passord (min 6 tegn)</Label><Input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="signup-password" /></div>

              <label className="flex items-start gap-2 text-sm pt-2 cursor-pointer">
                <Checkbox checked={acceptTerms} onCheckedChange={setAcceptTerms} data-testid="signup-accept-terms" />
                <span>Jeg har lest og godtar <Link to="/vilkar" target="_blank" className="text-emerald-800 font-semibold underline">bruksvilkårene</Link>.</span>
              </label>

              <Button type="submit" disabled={loading || !acceptTerms} className="w-full bg-emerald-900 hover:bg-emerald-800" data-testid="signup-submit">
                {loading ? "Oppretter…" : "Start 7 dagers gratis prøveperiode"}
              </Button>
              <p className="text-xs text-slate-500 text-center">Har du allerede konto? <Link to="/innlogging" className="text-emerald-800 font-semibold hover:underline">Logg inn</Link></p>
            </form>
          </Card>

          <Card className="lg:col-span-2 p-6 bg-gradient-to-br from-emerald-900 to-emerald-700 text-white">
            <h3 className="font-display text-xl font-extrabold mb-3">Dette får du i prøveperioden</h3>
            <ul className="space-y-2 text-sm">
              {[
                "Full Deluxe-tilgang i 7 dager",
                "Ubegrenset antall lag og personer",
                "Varer, drakter, baller med størrelse+lokasjon",
                "Utlån, retur og automatisk skyldig beløp",
                "QR-koder for lyn-raskt utlån via mobil",
                "Varetelling og Excel-import",
                "Fakturaer og klubblogo",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-200 flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-emerald-100 mt-4">Når prøveperioden avsluttes velger du mellom Basic, Pro eller Deluxe – eller lar kontoen hvile i read-only.</p>
          </Card>
        </div>
      </div>

      <Dialog open={!!welcome} onOpenChange={(o) => !o && closeWelcome()}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-500" />Velkommen til Utstyrsrommet!</DialogTitle>
            <DialogDescription>
              Du har nå fått full tilgang til Utstyrsrommet Deluxe i 7 dager.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-slate-600 space-y-2">
            <p>Utforsk alle funksjoner og se hvordan Utstyrsrommet kan gi klubben full kontroll på utstyr, drakter og lager.</p>
            <p className="font-semibold">Ingen betalingskort. Ingen bindingstid.</p>
            {welcome?.customer_number && <p className="text-xs text-slate-500">Kundenummer: <span className="font-mono font-bold">{welcome.customer_number}</span></p>}
          </div>
          <DialogFooter>
            <Button onClick={closeWelcome} className="w-full bg-emerald-900 hover:bg-emerald-800" data-testid="welcome-start-btn">Start med Utstyrsrommet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster richColors position="top-right" />
    </div>
  );
}
