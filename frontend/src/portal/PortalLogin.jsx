import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi, setPortalToken, formatPortalError } from "./portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { LogIn, ShieldAlert } from "lucide-react";

export default function PortalLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await portalApi.post("/auth/login", { email, password });
      setPortalToken(data.token);
      toast.success("Logget inn");
      nav("/");
    } catch (err) {
      toast.error(formatPortalError(err.response?.data?.detail));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Sportslig stripebakgrunn */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, #7f1d1d 0 2px, transparent 2px 24px)" }}
      />
      {/* Topplinje med klubbfarge */}
      <div aria-hidden className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-900 via-amber-300 to-red-900" />

      <Card className="w-full max-w-md p-6 relative border-t-4 border-t-red-900 shadow-lg">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-red-900 text-white font-black px-4 py-2 rounded-md tracking-[0.2em] text-sm">
            <ShieldAlert className="h-4 w-4 text-amber-300" />
            LAGSPORTAL
          </div>
          <p className="text-xs text-slate-500 mt-2">UTSTYRSROMMET · portal.utstyrsrommet.no</p>
          <p className="text-xs text-slate-400 mt-1 italic">Logg inn med e-posten klubben din har registrert.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>E-postadresse</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus data-testid="portal-login-email" />
          </div>
          <div>
            <Label>Passord</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="portal-login-password" />
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-red-900 hover:bg-red-800" data-testid="portal-login-submit">
            <LogIn className="h-4 w-4 mr-2" />{busy ? "Logger inn…" : "Logg inn"}
          </Button>
        </form>
        <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
          <div>
            Tilgang til lagsportalen opprettes av klubbens administrator. Hvis du ikke har mottatt invitasjon på e-post, kontakt klubben din.
          </div>
        </div>
      </Card>
    </div>
  );
}
