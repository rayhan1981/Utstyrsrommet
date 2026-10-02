import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, CreditCard } from "lucide-react";

export default function Subscription() {
  const { customer, plan: currentPlan, refresh } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState("");

  useEffect(() => { api.get("/plans").then((r) => setPlans(r.data)); }, []);

  const checkout = async (planKey) => {
    setLoading(planKey);
    try {
      const { data } = await api.post("/subscription/checkout", { plan: planKey, origin_url: window.location.origin });
      window.location.href = data.checkout_url;
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
      setLoading("");
    }
  };

  const statusLabel = {
    trial: "Gratis prøveperiode",
    active: "Aktivt abonnement",
    past_due: "Betaling forfalt - oppdater kort",
    canceled: "Avsluttet",
  };

  const trialDays = customer?.trial_ends_at ? Math.max(0, Math.ceil((new Date(customer.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))) : 0;

  return (
    <div className="space-y-6" data-testid="subscription-page">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Abonnement</h1>
        <p className="text-slate-600 text-sm mt-1">Administrer pakke og betaling</p>
      </div>

      {customer && (
        <Card className="p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase font-semibold text-slate-500">Nåværende pakke</div>
              <div className="font-display text-2xl font-bold mt-1">{currentPlan?.name} <span className="text-sm font-normal text-slate-500">· kr {currentPlan?.price}/mnd</span></div>
              <div className="mt-2">
                <span className={`text-xs font-semibold px-2 py-1 rounded ${customer.status === "active" ? "bg-emerald-100 text-emerald-800" : customer.status === "trial" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>
                  {statusLabel[customer.status] || customer.status}
                </span>
                {customer.status === "trial" && <span className="text-sm text-slate-600 ml-2">{trialDays} dager igjen av prøveperioden</span>}
              </div>
              <div className="text-sm text-slate-500 mt-2">Kundenummer: <span className="font-mono font-semibold text-slate-800">{customer.customer_number}</span></div>
            </div>
            {(customer.status === "trial" || customer.status === "past_due") && (
              <Button className="bg-emerald-900 hover:bg-emerald-800" onClick={() => checkout(customer.plan)} disabled={loading === customer.plan} data-testid="activate-billing-btn">
                <CreditCard className="h-4 w-4 mr-2" />
                {customer.status === "trial" ? "Legg til kort nå" : "Oppdater betalingskort"}
              </Button>
            )}
          </div>
        </Card>
      )}

      <div>
        <h3 className="font-display text-lg font-bold mb-3">Bytt pakke</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => {
            const isCurrent = customer?.plan === p.key;
            return (
              <Card key={p.key} className={`p-5 ${isCurrent ? "border-emerald-700 border-2" : ""}`}>
                {isCurrent && <div className="text-xs font-bold text-emerald-800 uppercase mb-1">Din pakke</div>}
                <h4 className="font-display text-xl font-bold">{p.name}</h4>
                <div className="font-display text-2xl font-extrabold text-emerald-900 my-2">kr {p.price}<span className="text-sm font-normal text-slate-500">/mnd</span></div>
                <ul className="space-y-1 text-xs">
                  {p.features.map((f) => <li key={f} className="flex gap-1.5"><Check className="h-3 w-3 text-emerald-700 shrink-0 mt-0.5" />{f}</li>)}
                </ul>
                <Button className="w-full mt-4" variant={isCurrent ? "outline" : "default"} disabled={isCurrent || loading === p.key} onClick={() => checkout(p.key)} data-testid={`checkout-${p.key}`}>
                  {isCurrent ? "Nåværende pakke" : loading === p.key ? "Åpner Stripe…" : "Velg pakke"}
                </Button>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
