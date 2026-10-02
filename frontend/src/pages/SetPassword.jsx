import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast, Toaster } from "sonner";

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!token) { setErr("Mangler invitasjonstoken"); return; }
    api.get(`/auth/invitation/${token}`).then((r) => setInfo(r.data)).catch((e) => setErr(formatError(e.response?.data?.detail)));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return toast.error("Passordene er ikke like");
    if (pw.length < 6) return toast.error("Passord må være minst 6 tegn");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/set-password", { token, password: pw });
      if (data.token) localStorage.setItem("utr_token", data.token);
      setUser(data.user);
      toast.success("Passord satt - du er innlogget");
      nav("/app");
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <Card className="w-full max-w-md p-8">
        <div className="font-display text-2xl font-extrabold text-emerald-900 mb-1">Velkommen!</div>
        <p className="text-sm text-slate-600 mb-6">Opprett ditt passord for Utstyrsrommet</p>
        {err && <div className="text-red-600 text-sm mb-4">{err}</div>}
        {info && (
          <form onSubmit={submit} className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-sm">
              <div className="text-slate-500">Konto</div>
              <div className="font-semibold">{info.name} • {info.email}</div>
            </div>
            <div>
              <Label>Nytt passord</Label>
              <Input type="password" data-testid="set-pw-1" required value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <div>
              <Label>Bekreft passord</Label>
              <Input type="password" data-testid="set-pw-2" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <Button type="submit" data-testid="set-pw-submit" disabled={loading} className="w-full bg-emerald-900 hover:bg-emerald-800">
              {loading ? "Lagrer…" : "Opprett passord og logg inn"}
            </Button>
          </form>
        )}
      </Card>
      <Toaster richColors position="top-right" />
    </div>
  );
}
