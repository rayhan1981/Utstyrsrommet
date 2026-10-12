import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { portalApi, formatPortalError } from "./portalApi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, X, Clock } from "lucide-react";

const STATUS_PILL = {
  sendt: "bg-slate-200 text-slate-700",
  under_behandling: "bg-blue-100 text-blue-800",
  behandlet_ma_bestilles: "bg-amber-100 text-amber-800",
  behandlet_dellevering: "bg-orange-100 text-orange-900",
  kan_leveres_omgaende: "bg-green-100 text-green-800",
  avsluttet: "bg-slate-100 text-slate-600",
  trukket_tilbake: "bg-slate-100 text-slate-500 line-through",
};

const LINE_STATUS_LABEL = {
  sendt: "Sendt",
  kan_leveres_omgaende: "Kan leveres omgående",
  ma_bestilles: "Må bestilles",
  utlevert: "Utlevert",
  utlant: "Utlånt",
  ikke_godkjent: "Ikke godkjent",
  utgatt: "Utgått – kan ikke leveres",
};

export default function PortalNeedsDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [n, setN] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    portalApi.get(`/needs/${id}`)
      .then((r) => setN(r.data))
      .catch((e) => toast.error(formatPortalError(e.response?.data?.detail)));
  };
  useEffect(load, [id]);

  const withdraw = async () => {
    if (!window.confirm("Vil du trekke tilbake denne behovsmeldingen? Du kan sende en ny senere.")) return;
    setBusy(true);
    try {
      await portalApi.post(`/needs/${id}/withdraw`);
      toast.success("Behovsmelding trukket tilbake");
      load();
    } catch (e) { toast.error(formatPortalError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (!n) return <div className="text-center text-slate-500 py-8">Laster…</div>;

  const hasDiscontinued = (n.lines || []).some((l) => l.line_status === "utgatt");

  return (
    <div className="space-y-5" data-testid="portal-need-detail">
      <div>
        <Button asChild variant="ghost" size="sm"><Link to="/"><ArrowLeft className="h-4 w-4 mr-1" />Tilbake</Link></Button>
      </div>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Behovsmelding</div>
            <div className="text-2xl font-mono font-bold">{n.number}</div>
            <div className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${STATUS_PILL[n.status] || "bg-slate-100 text-slate-600"}`}>{n.status_label}</div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>Opprettet: {new Date(n.created_at).toLocaleString("nb-NO")}</div>
            <div>Sist oppdatert: {new Date(n.last_update_at || n.created_at).toLocaleString("nb-NO")}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">Lag:</span> <strong>{n.team_name}</strong></div>
          <div><span className="text-slate-500">Ønsket dato:</span> <strong>{n.wanted_date}</strong></div>
          <div><span className="text-slate-500">Kontaktperson:</span> {n.contact_name}</div>
          <div><span className="text-slate-500">Telefon / e-post:</span> {n.contact_phone} · {n.contact_email}</div>
          {n.comment && <div className="sm:col-span-2"><span className="text-slate-500">Kommentar:</span> {n.comment}</div>}
        </div>

        {n.status === "sendt" && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={withdraw} disabled={busy} className="text-red-700 border-red-200" data-testid="portal-withdraw-btn">
              <X className="h-3.5 w-3.5 mr-1" />Trekk tilbake behovsmelding
            </Button>
            <p className="text-[11px] text-slate-500 mt-1">
              Du kan trekke tilbake behovsmeldingen frem til klubben starter behandlingen. Etter det må du ta kontakt med klubben for endringer.
            </p>
          </div>
        )}

        {n.status === "behandlet_dellevering" && (
          <div className="mt-4 pt-3 border-t border-slate-100 bg-orange-50 -mx-5 -mb-5 px-5 py-3 rounded-b">
            <div className="font-semibold text-orange-900">Behandlet – Dellevering</div>
            <p className="text-sm text-slate-700 mt-1">
              Noen varer kan leveres omgående, mens andre må bestilles. Se status per varelinje under for hva som gjelder for ditt behov.
            </p>
          </div>
        )}
      </Card>

      {hasDiscontinued && (
        <Card className="p-4 border-amber-300 bg-amber-50/60">
          <div className="font-semibold text-amber-900">Behovsmeldingen inneholder utgåtte varer som ikke kan leveres</div>
          <p className="text-xs text-slate-700 mt-1">Se oversikten under for hvilke linjer det gjelder. Ta kontakt med klubben hvis du har spørsmål.</p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-bold text-sm mb-3">Varelinjer ({(n.lines || []).length})</h2>
        <div className="space-y-2">
          {(n.lines || []).map((l) => (
            <div key={l.id} className="border border-slate-200 rounded p-3" data-testid={`portal-line-detail-${l.id}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{l.item_name}</div>
                  <div className="text-xs text-slate-500">
                    {[l.category, l.main_group, l.sub_group].filter(Boolean).join(" · ")}
                    {l.size && ` · Størrelse ${l.size}`}
                    {l.jersey_number && l.jersey_number !== "X" && ` · #${l.jersey_number}`}
                    {l.full_number && ` · ${l.full_number}`}
                  </div>
                </div>
                <div className="text-sm text-right">
                  <div className="font-mono font-bold">{l.quantity_requested} stk</div>
                  <div className="text-[10px] text-slate-500">Bedt om</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                <span className={`px-1.5 py-0.5 rounded uppercase font-bold ${
                  l.line_status === "utgatt" ? "bg-red-100 text-red-800"
                  : l.line_status === "kan_leveres_omgaende" ? "bg-green-100 text-green-800"
                  : l.line_status === "ma_bestilles" ? "bg-amber-100 text-amber-800"
                  : l.line_status === "utlevert" ? "bg-blue-100 text-blue-800"
                  : l.line_status === "utlant" ? "bg-purple-100 text-purple-800"
                  : l.line_status === "ikke_godkjent" ? "bg-slate-100 text-slate-600"
                  : "bg-slate-200 text-slate-700"
                }`}>{LINE_STATUS_LABEL[l.line_status] || l.line_status}</span>
                {l.quantity_immediate > 0 && <span className="text-slate-600">{l.quantity_immediate} omgående</span>}
                {l.quantity_to_order > 0 && <span className="text-slate-600">{l.quantity_to_order} bestilles</span>}
                {l.quantity_handed_out > 0 && <span className="text-slate-600">{l.quantity_handed_out} utlevert</span>}
                {l.quantity_loaned > 0 && <span className="text-slate-600">{l.quantity_loaned} utlånt</span>}
                {l.quantity_rejected > 0 && <span className="text-slate-600">{l.quantity_rejected} ikke godkjent</span>}
                {l.quantity_discontinued > 0 && <span className="text-red-700 font-semibold">{l.quantity_discontinued} utgått</span>}
              </div>
              {l.note && <div className="text-xs text-slate-500 mt-1 italic">Notat: {l.note}</div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
