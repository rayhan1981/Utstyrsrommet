import React, { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { CheckCircle2 } from "lucide-react";

export default function SubscriptionSuccess() {
  const [params] = useSearchParams();
  const session_id = params.get("session_id");
  const nav = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    let tries = 0;
    const poll = async () => {
      try {
        const { data } = await api.get(`/subscription/status/${session_id}`);
        if (data.payment_status === "paid") { await refresh(); return; }
      } catch {}
      if (tries++ < 10) setTimeout(poll, 2000);
    };
    if (session_id) poll();
  }, [session_id, refresh]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="max-w-md p-8 text-center">
        <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto mb-4" />
        <h1 className="font-display text-2xl font-extrabold">Takk for abonnementet!</h1>
        <p className="text-slate-600 text-sm mt-2">Betalingen er bekreftet og pakken er aktivert.</p>
        <Button className="mt-6 bg-emerald-900 hover:bg-emerald-800" onClick={() => nav("/app")}>Åpne appen</Button>
      </Card>
    </div>
  );
}
