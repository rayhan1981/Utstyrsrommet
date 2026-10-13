import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, CreditCard, UserPlus, FileText, Download, AlertTriangle, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

const PLANS_LABEL = { basic: "Klubb Basic", pro: "Klubb Pro", deluxe: "Klubb Premium" };

export default function Subscription() {
  const { customer, plan: currentPlan, refresh } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState("");
  const [cycle, setCycle] = useState("monthly");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [seatsOpen, setSeatsOpen] = useState(false);
  const [seatQty, setSeatQty] = useState(1);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelSeatsOpen, setCancelSeatsOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    api.get("/plans").then((r) => setPlans(r.data));
    api.get("/subscription/invoices").then((r) => setInvoices(r.data)).catch(() => {});
  }, [customer]);

  const checkout = async (planKey) => {
    if (!acceptTerms) { toast.error("Du må godta bruksvilkårene"); return; }
    setLoading(planKey);
    try {
      const { data } = await api.post("/subscription/checkout", {
        plan: planKey, origin_url: window.location.origin,
        billing_cycle: cycle, accept_terms: true,
      });
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

  const confirmCancel = async () => {
    try {
      const { data } = await api.post("/subscription/cancel", { reason: cancelReason });
      toast.success(`Oppsigelse registrert. Abonnementet avsluttes ${new Date(data.cancel_at).toLocaleDateString("nb-NO")}`);
      setCancelOpen(false); await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const resumeSubscription = async () => {
    try { await api.post("/subscription/resume"); toast.success("Oppsigelsen er angret"); await refresh(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const confirmCancelSeats = async () => {
    try { await api.post("/subscription/seats/cancel"); toast.success("Ekstra bruker-seter er avsluttet umiddelbart"); setCancelSeatsOpen(false); await refresh(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const statusLabel = {
    trial: "Gratis prøveperiode", active: "Aktivt abonnement",
    past_due: "Betaling forfalt - oppdater kort", canceled: "Avsluttet",
    canceling: "Avsluttes snart (3 mnd oppsigelse)",
  };

  const trialDays = customer?.trial_ends_at ? Math.max(0, Math.ceil((new Date(customer.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))) : 0;
  const extraSeats = customer?.extra_user_seats || 0;
  const inclSeats = currentPlan?.max_users;
  const totalSeats = inclSeats == null ? "ubegrenset" : inclSeats + extraSeats;
  const canBuySeats = currentPlan?.allow_user_addon;
  const isOwnerWs = customer?.is_owner_workspace;

  const yearlyFirst = (p) => Math.round(p.price * 12 * 0.5);
  const yearlyLoyal = (p) => Math.round(p.price * 12 * 0.9);

  const selectDeferred = async (planKey) => {
    try {
      await api.post("/subscription/select-plan", { plan: planKey });
      toast.success(`Du beholder Premium-tilgangen ut prøveperioden. ${planKey} starter etter at prøveperioden avsluttes.`);
      await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6" data-testid="subscription-page">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Abonnement</h1>
        <p className="text-slate-600 text-sm mt-1">Administrer pakke, betaling, fakturaer og oppsigelse</p>
      </div>

      {customer && (
        <Card className="p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase font-semibold text-slate-500">Nåværende pakke</div>
              <div className="font-display text-2xl font-bold mt-1">{currentPlan?.name} <span className="text-sm font-normal text-slate-500">· kr {currentPlan?.price}/mnd {customer.billing_cycle === "yearly" && "(faktureres årlig)"}</span></div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-1 rounded ${customer.status === "active" ? "bg-red-100 text-red-800" : customer.status === "trial" ? "bg-blue-100 text-blue-800" : customer.status === "canceling" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                  {statusLabel[customer.status] || customer.status}
                </span>
                {customer.status === "trial" && <span className="text-sm text-slate-600">{trialDays} dager igjen</span>}
                {customer.cancel_at && <span className="text-sm text-slate-600">Avsluttes {new Date(customer.cancel_at).toLocaleDateString("nb-NO")}</span>}
              </div>
              <div className="text-sm text-slate-500 mt-2">Kundenummer: <span className="font-mono font-semibold text-slate-800">{customer.customer_number}</span></div>
              {customer.status === "trial" && customer.selected_plan && (
                <div className="mt-2 text-sm bg-red-50 border border-red-200 rounded-md p-2 inline-block">
                  <strong>Valgt abonnement:</strong> {PLANS_LABEL[customer.selected_plan] || customer.selected_plan} – aktiveres når prøveperioden avsluttes
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(customer.status === "trial" || customer.status === "past_due") && !isOwnerWs && (
                <Button className="bg-red-900 hover:bg-red-800" onClick={() => { setAcceptTerms(true); checkout(customer.plan); }} disabled={loading === customer.plan} data-testid="activate-billing-btn">
                  <CreditCard className="h-4 w-4 mr-2" />{customer.status === "trial" ? "Legg til kort" : "Oppdater kort"}
                </Button>
              )}
              {customer.status === "active" && !isOwnerWs && (
                <Button variant="outline" onClick={() => setCancelOpen(true)} data-testid="cancel-sub-btn" className="text-red-700 hover:text-red-800"><XCircle className="h-4 w-4 mr-2" />Si opp (3 mnd)</Button>
              )}
              {customer.status === "canceling" && (
                <Button variant="outline" onClick={resumeSubscription} data-testid="resume-sub-btn">Angre oppsigelse</Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {canBuySeats && !isOwnerWs && (
        <Card className="p-5" data-testid="user-seats-card">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-red-700" />
                <h3 className="font-display text-lg font-bold">Bruker-seter</h3>
              </div>
              <p className="text-sm text-slate-600 mt-1">Inkludert i {currentPlan?.name}: <strong>{inclSeats} brukere</strong>. Du har kjøpt <strong>{extraSeats} ekstra</strong>. Totalt: <strong>{totalSeats} brukere</strong>.</p>
              <p className="text-xs text-slate-500 mt-1">Pris: kr 199,-/mnd per ekstra bruker. Kan sies opp umiddelbart.</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setSeatsOpen(true)} data-testid="buy-seats-btn"><UserPlus className="h-4 w-4 mr-2" />Kjøp flere</Button>
              {extraSeats > 0 && (
                <Button variant="outline" onClick={() => setCancelSeatsOpen(true)} className="text-red-700" data-testid="cancel-seats-btn"><XCircle className="h-4 w-4 mr-2" />Avslutt {extraSeats} seter</Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {!isOwnerWs && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg font-bold">Bytt pakke</h3>
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
              <button type="button" onClick={() => setCycle("monthly")} className={`px-3 py-1.5 rounded ${cycle === "monthly" ? "bg-red-900 text-white" : "text-slate-600"}`} data-testid="cycle-monthly">Månedlig</button>
              <button type="button" onClick={() => setCycle("yearly")} className={`px-3 py-1.5 rounded ${cycle === "yearly" ? "bg-red-900 text-white" : "text-slate-600"}`} data-testid="cycle-yearly">Årlig · spar 50% første år</button>
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs mb-3 cursor-pointer">
            <Checkbox checked={acceptTerms} onCheckedChange={setAcceptTerms} data-testid="sub-accept-terms" />
            <span>Jeg godtar <Link to="/vilkar" target="_blank" className="text-red-800 underline">bruksvilkårene</Link> inkludert oppsigelsestid på 3 måneder for hovedabonnementet.</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p) => {
              const isCurrent = customer?.plan === p.key && customer?.billing_cycle === cycle;
              return (
                <Card key={p.key} className={`p-5 ${isCurrent ? "border-red-700 border-2" : ""}`}>
                  {isCurrent && <div className="text-xs font-bold text-red-800 uppercase mb-1">Din pakke</div>}
                  <h4 className="font-display text-xl font-bold">{p.name}</h4>
                  {cycle === "monthly" ? (
                    <div className="font-display text-2xl font-extrabold text-red-900 my-2">kr {p.price}<span className="text-sm font-normal text-slate-500">/mnd</span></div>
                  ) : (
                    <>
                      <div className="font-display text-2xl font-extrabold text-red-900 mt-2">kr {yearlyFirst(p)}<span className="text-sm font-normal text-slate-500">/år</span></div>
                      <div className="text-xs text-slate-500 mb-2">Første år (-50%). Deretter kr {yearlyLoyal(p)}/år (-10%)</div>
                    </>
                  )}
                  <ul className="space-y-1 text-xs">
                    {p.features.map((f) => <li key={f} className="flex gap-1.5"><Check className="h-3 w-3 text-red-700 shrink-0 mt-0.5" />{f}</li>)}
                  </ul>
                  {customer?.subscription_status === "trial" ? (
                    <>
                      <Button
                        className={`w-full mt-4 ${p.key === "pro" ? "bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold" : "bg-red-900 hover:bg-red-800"}`}
                        disabled={customer?.selected_plan === p.key}
                        onClick={() => selectDeferred(p.key)}
                        data-testid={`select-${p.key}`}
                      >
                        {customer?.selected_plan === p.key ? "Valgt" : p.key === "pro" ? "⭐ Velg Pro" : `Velg ${p.name.replace('Klubb ','')}`}
                      </Button>
                      <p className="text-[10px] text-slate-500 mt-1 text-center">Aktiveres etter prøveperioden</p>
                    </>
                  ) : (
                    <Button className="w-full mt-4" variant={isCurrent ? "outline" : "default"} disabled={isCurrent || loading === p.key || !acceptTerms} onClick={() => checkout(p.key)} data-testid={`checkout-${p.key}`}>
                      {isCurrent ? "Nåværende pakke" : loading === p.key ? "Åpner Stripe…" : "Velg pakke"}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {invoices.length > 0 && (
        <Card className="p-5" data-testid="invoices-card">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-5 w-5 text-red-700" />
            <h3 className="font-display text-lg font-bold">Faktura-historikk</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {invoices.map((i) => (
              <div key={i.id} className="py-3 flex items-center justify-between flex-wrap gap-2 text-sm">
                <div>
                  <div className="font-semibold">{i.number || i.id.slice(-8)} · kr {i.amount_paid?.toLocaleString("nb-NO")} {i.currency}</div>
                  <div className="text-xs text-slate-500">{new Date(i.created).toLocaleDateString("nb-NO")} · {i.status}</div>
                </div>
                <div className="flex gap-2">
                  {i.hosted_url && <a href={i.hosted_url} target="_blank" rel="noreferrer"><Button variant="outline" size="sm">Se faktura</Button></a>}
                  {i.pdf_url && <a href={i.pdf_url} target="_blank" rel="noreferrer" download><Button variant="outline" size="sm"><Download className="h-3 w-3 mr-1" />PDF</Button></a>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={seatsOpen} onOpenChange={setSeatsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kjøp ekstra bruker-seter</DialogTitle>
            <DialogDescription>Hvert ekstra sete koster 199,-/mnd. Kan sies opp umiddelbart.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Antall ekstra brukere</Label><Input type="number" min="1" value={seatQty} onChange={(e) => setSeatQty(parseInt(e.target.value) || 1)} data-testid="seat-qty-input" /></div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm">
              <div className="flex justify-between"><span>Antall:</span><strong>{seatQty}</strong></div>
              <div className="flex justify-between"><span>Pris pr sete:</span><span>199,-/mnd</span></div>
              <div className="flex justify-between border-t border-slate-200 mt-2 pt-2 font-bold text-red-900"><span>Totalt pr måned:</span><span>kr {seatQty * 199},-</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeatsOpen(false)}>Avbryt</Button>
            <Button onClick={buySeats} disabled={loading === "seats"} className="bg-red-900 hover:bg-red-800" data-testid="confirm-seats-btn">{loading === "seats" ? "Åpner Stripe…" : "Fortsett til betaling"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />Si opp hovedabonnement</DialogTitle>
            <DialogDescription>
              Hovedabonnementet har <strong>3 måneders oppsigelsestid</strong>. Du beholder full tilgang og faktureres i oppsigelsesperioden. Du kan angre oppsigelsen når som helst.
            </DialogDescription>
          </DialogHeader>
          <div><Label>Grunn (valgfritt)</Label><Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="F.eks. bytter leverandør…" data-testid="cancel-reason-input" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Avbryt</Button>
            <Button onClick={confirmCancel} className="bg-red-700 hover:bg-red-800 text-white" data-testid="confirm-cancel-btn">Bekreft oppsigelse</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelSeatsOpen} onOpenChange={setCancelSeatsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />Avslutt ekstra bruker-seter</DialogTitle>
            <DialogDescription>Ekstra bruker-seter avsluttes <strong>umiddelbart</strong>. Allerede opprettede brukere utover inkluderte seter mister tilgang.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelSeatsOpen(false)}>Avbryt</Button>
            <Button onClick={confirmCancelSeats} className="bg-red-700 hover:bg-red-800 text-white" data-testid="confirm-cancel-seats-btn">Bekreft - avslutt {extraSeats} seter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
