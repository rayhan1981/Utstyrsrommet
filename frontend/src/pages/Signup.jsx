import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Check } from "lucide-react";
import { toast, Toaster } from "sonner";

export default function Signup() {
  const [params] = useSearchParams();
  const { signup } = useAuth();
  const nav = useNavigate();
  const [plans, setPlans] = useState([]);
  const [plan, setPlan] = useState(params.get("plan") || "pro");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ club_name: "", owner_name: "", owner_email: "", owner_phone: "", password: "" });

  useEffect(() => { api.get("/plans").then((r) => setPlans(r.data)); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await signup({ ...form, plan });
      toast.success(`Konto opprettet! Kundenummer: ${res.customer_number}`);
      nav("/app");
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <Link to="/" className="font-display text-2xl font-extrabold text-emerald-900 inline-block mb-6">UTSTYRSROMMET</Link>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Card className="lg:col-span-3 p-6">
            <h1 className="font-display text-3xl font-extrabold">Opprett klubbkonto</h1>
            <p className="text-slate-600 text-sm mt-1">14 dagers gratis prøve. Ingen kort kreves nå.</p>
            <form onSubmit={submit} className="space-y-3 mt-6">
              <div><Label>Klubbnavn</Label><Input required value={form.club_name} onChange={(e) => setForm({ ...form, club_name: e.target.value })} data-testid="signup-club" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>Ditt fulle navn</Label><Input required value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} data-testid="signup-name" /></div>
                <div><Label>Telefon</Label><Input value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} /></div>
              </div>
              <div><Label>E-post</Label><Input type="email" required value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} data-testid="signup-email" /></div>
              <div><Label>Passord (min 6 tegn)</Label><Input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="signup-password" /></div>
              <Button type="submit" disabled={loading} className="w-full bg-emerald-900 hover:bg-emerald-800" data-testid="signup-submit">
                {loading ? "Oppretter…" : "Start 14 dagers gratis prøve"}
              </Button>
              <p className="text-xs text-slate-500 text-center">Har du allerede konto? <Link to="/innlogging" className="text-emerald-800 font-semibold hover:underline">Logg inn</Link></p>
            </form>
          </Card>
          <div className="lg:col-span-2 space-y-3">
            <div className="font-display text-lg font-bold">Velg pakke</div>
            {plans.map((p) => (
              <Card key={p.key} onClick={() => setPlan(p.key)} className={`p-4 cursor-pointer transition ${plan === p.key ? "border-emerald-700 border-2 bg-emerald-50" : "hover:border-slate-300"}`} data-testid={`signup-plan-${p.key}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display font-bold text-lg">{p.name}</div>
                    <div className="font-display text-2xl font-extrabold text-emerald-900">kr {p.price}<span className="text-sm font-normal text-slate-500">/mnd</span></div>
                  </div>
                  {plan === p.key && <Check className="h-6 w-6 text-emerald-700" />}
                </div>
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {p.features.slice(0, 4).map((f) => <li key={f}>• {f}</li>)}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  );
}
