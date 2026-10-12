import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { portalApi, portalRootApi, setPortalToken, formatPortalError } from "./portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

function clubInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "KL";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PortalSetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!token) { toast.error("Mangler invitasjons-token"); return; }
    portalApi.get("/branding", { params: { token } })
      .then((r) => setBrand(r.data))
      .catch(() => {/* ignorer – viser generisk UI */});
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Passord må være minst 8 tegn"); return; }
    if (password !== password2) { toast.error("Passordene er ikke like"); return; }
    setBusy(true);
    try {
      const { data } = await portalRootApi.post("/portal/auth/set-password", { token, password });
      setPortalToken(data.token);
      toast.success("Passord satt. Du er nå logget inn.");
      nav("/");
    } catch (err) {
      toast.error(formatPortalError(err.response?.data?.detail));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, #7f1d1d 0 2px, transparent 2px 24px)" }}
      />
      <Card className="w-full max-w-md p-6 relative border-t-4 border-t-red-900">
        <div className="text-center mb-6">
          {brand?.logo_url ? (
            <img
              src={brand.logo_url}
              alt={brand.name}
              className="h-16 w-16 mx-auto rounded-full bg-white object-contain p-1 ring-2 ring-amber-300"
              data-testid="portal-setpw-logo"
            />
          ) : brand?.name ? (
            <div className="h-16 w-16 mx-auto rounded-full bg-red-900 text-white font-black flex items-center justify-center ring-2 ring-amber-300 text-xl" data-testid="portal-setpw-initials">
              {clubInitials(brand.name)}
            </div>
          ) : (
            <KeyRound className="h-10 w-10 mx-auto text-red-900" />
          )}
          {brand?.name && (
            <div className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">Lagsportal</div>
          )}
          {brand?.name && (
            <div className="font-bold text-red-900" data-testid="portal-setpw-club">{brand.name}</div>
          )}
          <h2 className="text-xl font-bold mt-3">Sett passord</h2>
          <p className="text-sm text-slate-500 mt-1">Velg et passord for din lagspålogging.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Nytt passord (minst 8 tegn)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} data-testid="portal-set-pw" />
          </div>
          <div>
            <Label>Gjenta passord</Label>
            <Input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} required data-testid="portal-set-pw2" />
          </div>
          <Button type="submit" disabled={busy || !token} className="w-full bg-red-900 hover:bg-red-800" data-testid="portal-set-pw-submit">
            {busy ? "Lagrer…" : "Lagre passord og logg inn"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
