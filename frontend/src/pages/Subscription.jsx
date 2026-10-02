import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, CreditCard, UserPlus } from "lucide-react";

export default function Subscription() {
  const { customer, plan: currentPlan, refresh } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState("");
  const [seatsOpen, setSeatsOpen] = useState(false);
  const [seatQty, setSeatQty] = useState(1);

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

  const buySeats = async () => {
    if (seatQty < 1) return;
    setLoading("seats");
    try {
      const { data } = await api.post("/subscription/seats/checkout", { quantity: Number(seatQty), origin_url: window.location.origin });
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
  const extraSeats = customer?.extra_user_seats || 0;
  const inclSeats = currentPlan?.max_users;
  const totalSeats = inclSeats === null || inclSeats === undefined ? "ubegrenset" : (inclSeats + extraSeats);

  return (
    <div className="space-y-6" data-testid="subscription-page">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Abonnement</h1>
        <p className="text-slate-600 text-sm mt-1">Administrer pakke, bruker-seter og betaling</p>
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

      {currentPlan?.allow_user_addon && (
        <Card className="p-5" data-testid="user-seats-card">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-emerald-700" />
                <h3 className="font-display text-lg font-bold">Bruker-seter</h3>
              </div>
              <p className="text-sm text-slate-600 mt-1">Inkludert i {currentPlan.name}: <strong>{inclSeats} brukere</strong> i tillegg til admin. Du har kjøpt <strong>{extraSeats} ekstra</strong>. Totalt: <strong>{totalSeats} brukere</strong>.</p>
              <p className="text-xs text-slate-500 mt-1">Ekstra bruker-sete: kr 199,-/mnd per bruker</p>
            </div>
            <Button variant="outline" onClick={() => setSeatsOpen(true)} data-testid="buy-seats-btn"><UserPlus className="h-4 w-4 mr-2" />Kjøp flere brukere</Button>
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

      <Dialog open={seatsOpen} onOpenChange={setSeatsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kjøp ekstra bruker-seter</DialogTitle>
            <DialogDescription>Hvert ekstra sete koster 199,-/mnd og legges til som eget abonnement i Stripe. Du kan si opp når som helst.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Antall ekstra brukere</Label>
              <Input type="number" min="1" value={seatQty} onChange={(e) => setSeatQty(parseInt(e.target.value) || 1)} data-testid="seat-qty-input" />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm">
              <div className="flex justify-between"><span>Antall:</span><strong>{seatQty}</strong></div>
              <div className="flex justify-between"><span>Pris pr sete:</span><span>199,-/mnd</span></div>
              <div className="flex justify-between border-t border-slate-200 mt-2 pt-2 font-bold text-emerald-900"><span>Totalt pr måned:</span><span>kr {seatQty * 199},-</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeatsOpen(false)}>Avbryt</Button>
            <Button onClick={buySeats} disabled={loading === "seats"} className="bg-emerald-900 hover:bg-emerald-800" data-testid="confirm-seats-btn">
              {loading === "seats" ? "Åpner Stripe…" : "Fortsett til betaling"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
