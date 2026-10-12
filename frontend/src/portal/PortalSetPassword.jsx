import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { portalRootApi, setPortalToken, formatPortalError } from "./portalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export default function PortalSetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!token) toast.error("Mangler invitasjons-token");
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6">
        <div className="text-center mb-6">
          <KeyRound className="h-10 w-10 mx-auto text-red-900" />
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
