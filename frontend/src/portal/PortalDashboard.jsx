import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { portalApi, formatPortalError } from "./portalApi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, Clock, Coins, PackageCheck, ArrowRight, FilePlus2 } from "lucide-react";

const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

const STATUS_PILL = {
  sendt: "bg-slate-200 text-slate-700",
  under_behandling: "bg-blue-100 text-blue-800",
  behandlet_ma_bestilles: "bg-amber-100 text-amber-800",
  behandlet_dellevering: "bg-orange-100 text-orange-900",
  kan_leveres_omgaende: "bg-green-100 text-green-800",
  avsluttet: "bg-slate-100 text-slate-600",
  trukket_tilbake: "bg-slate-100 text-slate-500 line-through",
};

export default function PortalDashboard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    portalApi.get("/dashboard")
      .then((r) => setData(r.data))
      .catch((e) => toast.error(formatPortalError(e.response?.data?.detail)));
  }, []);

  if (!data) return <div className="text-center text-slate-500 py-8">Laster…</div>;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Toppvisning: skyldig + forfalt */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4" data-testid="portal-debt">
          <div className="flex items-center gap-2 text-xs text-slate-500 uppercase font-semibold"><Coins className="h-3.5 w-3.5" />Skyldig beløp</div>
          <div className={`mt-1 text-2xl font-bold ${data.debt > 0 ? "text-red-800" : "text-slate-900"}`}>{nok(data.debt)}</div>
        </Card>
        <Card className="p-4" data-testid="portal-active-loans">
          <div className="flex items-center gap-2 text-xs text-slate-500 uppercase font-semibold"><PackageCheck className="h-3.5 w-3.5" />Aktive lån</div>
          <div className="mt-1 text-2xl font-bold">{data.active_loans.length}</div>
        </Card>
        <Card className={`p-4 ${data.overdue.length > 0 ? "border-red-300 bg-red-50/40" : ""}`} data-testid="portal-overdue">
          <div className="flex items-center gap-2 text-xs text-slate-500 uppercase font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Forfalte linjer</div>
          <div className={`mt-1 text-2xl font-bold ${data.overdue.length > 0 ? "text-red-800" : "text-slate-900"}`}>{data.overdue.length}</div>
        </Card>
      </div>

      {/* CTA: Meld utstyrsbehov */}
      <Card className="p-5 bg-red-50/60 border-red-200">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-bold text-red-900">Trenger laget nytt utstyr?</h2>
            <p className="text-sm text-slate-700">Send inn en behovsmelding, så tar klubben kontakt.</p>
          </div>
          <Button asChild className="bg-red-900 hover:bg-red-800" data-testid="portal-cta-new-need">
            <Link to="/behov/nytt"><FilePlus2 className="h-4 w-4 mr-2" />Meld utstyrsbehov</Link>
          </Button>
        </div>
      </Card>

      {/* Behovsmeldinger */}
      <Card className="p-5">
        <h2 className="font-bold text-sm text-slate-700 mb-3">Mine behovsmeldinger ({data.needs.length})</h2>
        {data.needs.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-2">Ingen behovsmeldinger ennå.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.needs.map((n) => (
              <li key={n.id} className="py-2 flex items-center gap-3" data-testid={`portal-need-row-${n.id}`}>
                <Link to={`/behov/${n.id}`} className="font-mono text-sm font-semibold hover:underline">{n.number}</Link>
                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${STATUS_PILL[n.status] || "bg-slate-100 text-slate-600"}`}>{n.status_label}</span>
                <span className="text-xs text-slate-500 flex-1">Ønsket: {n.wanted_date} · {n.lines_count} linje{n.lines_count === 1 ? "" : "r"}</span>
                <Link to={`/behov/${n.id}`} className="text-slate-400 hover:text-red-800"><ArrowRight className="h-4 w-4" /></Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Aktive lån */}
      <Card className="p-5">
        <h2 className="font-bold text-sm text-slate-700 mb-3">Utstyr laget har lånt ({data.active_loans.length})</h2>
        {data.active_loans.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-2">Ingen aktive lån.</div>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.active_loans.map((l) => (
              <li key={l.id} className="py-2 flex items-center gap-2 flex-wrap">
                {l.full_number && <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{l.full_number}</span>}
                <span className="font-semibold">{l.item_name}</span>
                {l.size && <span className="text-slate-500">({l.size})</span>}
                <span className="ml-auto text-slate-500 text-xs">{l.quantity} stk</span>
                {l.due_date && (
                  <span className={`text-xs ml-2 ${l.due_date.slice(0,10) < today ? "text-red-700 font-bold" : "text-slate-500"}`}>Frist: {l.due_date.slice(0,10)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Utleveringer */}
      <Card className="p-5">
        <h2 className="font-bold text-sm text-slate-700 mb-3">Utlevert utstyr ({data.handouts.length})</h2>
        {data.handouts.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-2">Ingen utleveringer ennå.</div>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.handouts.map((h) => (
              <li key={h.id} className="py-2 flex items-center gap-2 flex-wrap">
                {h.full_number && <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{h.full_number}</span>}
                <span className="font-semibold">{h.item_name}</span>
                {h.size && <span className="text-slate-500">({h.size})</span>}
                <span className="ml-auto text-slate-500 text-xs">{h.quantity} stk</span>
                <span className="text-xs text-slate-400">{(h.handout_date || "").slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
