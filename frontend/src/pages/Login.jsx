import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast, Toaster } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Innlogget");
      nav("/app");
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Innlogging feilet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 brand-gradient items-center justify-center p-12">
        <div className="text-white max-w-md">
          <div className="font-display text-5xl font-extrabold leading-tight mb-4">
            UTSTYRS<br />ROMMET
          </div>
          <p className="text-emerald-100 text-lg leading-relaxed">
            Komplett lagerstyring og administrasjon for idrettsklubber. Hold styr på utstyr, lag og utlån - alt på ett sted.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-4 text-sm">
            <div className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
              <div className="font-semibold">Automatisk</div>
              <div className="text-emerald-100 text-xs mt-1">Skyldig beløp beregnes</div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
              <div className="font-semibold">Excel-eksport</div>
              <div className="text-emerald-100 text-xs mt-1">Alt per lag eller totalt</div>
            </div>
          </div>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 border-slate-200 shadow-sm">
          <div className="lg:hidden text-center mb-6">
            <div className="font-display text-3xl font-extrabold text-emerald-900">UTSTYRSROMMET</div>
          </div>
          <h1 className="font-display text-2xl font-bold mb-1">Logg inn</h1>
          <p className="text-sm text-slate-600 mb-6">Tilgang til klubbens lagerstyring</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">E-post</Label>
              <Input id="email" data-testid="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Passord</Label>
              <Input id="password" data-testid="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" data-testid="login-submit" disabled={loading} className="w-full bg-emerald-900 hover:bg-emerald-800">
              {loading ? "Logger inn…" : "Logg inn"}
            </Button>
          </form>
        </Card>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  );
}
