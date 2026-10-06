import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="min-h-screen bg-[#0a0a0a] text-white relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true"
           style={{ background: "radial-gradient(1200px 700px at 50% -10%, rgba(220,38,38,0.18) 0%, transparent 60%), radial-gradient(900px 500px at 10% 110%, rgba(220,38,38,0.12) 0%, transparent 60%)" }} />
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Link to="/" className="flex items-center gap-3 justify-center mb-8">
            <img src="/logo.png" alt="UTSTYRSROMMET" className="h-16 w-16 object-contain" style={{ filter: "drop-shadow(0 0 12px rgba(220,38,38,0.4))" }} />
            <div className="font-display text-2xl font-black tracking-tight">
              <span className="chrome-text">UTSTYRS</span><span className="red-gloss-text">ROMMET</span>
            </div>
          </Link>
          <div className="lux-dark rounded-2xl p-8">
            <h1 className="font-display text-3xl font-black mb-1">Logg inn</h1>
            <p className="text-sm text-zinc-400 mb-6">Tilgang til klubbens lagerstyring</p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="email" className="text-zinc-300">E-post</Label>
                <Input id="email" data-testid="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                       className="bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:border-red-500/60 focus-visible:ring-red-500/20" />
              </div>
              <div>
                <Label htmlFor="password" className="text-zinc-300">Passord</Label>
                <Input id="password" data-testid="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                       className="bg-black/40 border-white/10 text-white placeholder:text-zinc-600 focus-visible:border-red-500/60 focus-visible:ring-red-500/20" />
              </div>
              <Button type="submit" data-testid="login-submit" disabled={loading} className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold">
                {loading ? "Logger inn…" : "Logg inn"}
              </Button>
            </form>
            <p className="text-xs text-zinc-500 text-center mt-6">
              Har du ikke konto? <Link to="/registrer" className="text-red-400 font-semibold hover:text-red-300">Start gratis</Link>
            </p>
          </div>
        </div>
      </div>
      <Toaster richColors position="top-right" theme="dark" />
    </div>
  );
}
