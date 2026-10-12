import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Play, ArrowLeft, AlertCircle } from "lucide-react";

const STATUS_PILL = {
  sendt: "bg-slate-200 text-slate-700",
  under_behandling: "bg-blue-100 text-blue-800",
  behandlet_ma_bestilles: "bg-amber-100 text-amber-800",
  behandlet_dellevering: "bg-orange-100 text-orange-900",
  kan_leveres_omgaende: "bg-green-100 text-green-800",
  avsluttet: "bg-slate-100 text-slate-600",
  trukket_tilbake: "bg-slate-100 text-slate-500 line-through",
};

export default function NeedsRequests() {
  const { id } = useParams();
  const { hasPerm } = useAuth();
  const [list, setList] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadList = async () => {
    try { const { data } = await api.get("/needs-requests"); setList(data); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };
  const loadDetail = async (nid) => {
    try { const { data } = await api.get(`/needs-requests/${nid}`); setDetail(data); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  useEffect(() => { loadList(); }, []);
  useEffect(() => { if (id) loadDetail(id); else setDetail(null); }, [id]);

  const startProcessing = async () => {
    if (!detail) return;
    if (!window.confirm(`Starte behandling av ${detail.number}?`)) return;
    setBusy(true);
    try {
      await api.post(`/needs-requests/${detail.id}/start-processing`);
      toast.success("Behandling startet");
      loadDetail(detail.id); loadList();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (detail) {
    return (
      <div className="space-y-5">
        <Button asChild variant="ghost" size="sm"><Link to="/app/innmeldte-behov"><ArrowLeft className="h-4 w-4 mr-1" />Tilbake til listen</Link></Button>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-slate-500 uppercase">Behovsmelding fra lagsportalen</div>
              <div className="text-2xl font-mono font-bold">{detail.number}</div>
              <div className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${STATUS_PILL[detail.status] || "bg-slate-100 text-slate-600"}`}>{detail.status_label}</div>
            </div>
            {detail.status === "sendt" && hasPerm("teams", "write") && (
              <Button onClick={startProcessing} disabled={busy} className="bg-red-900 hover:bg-red-800" data-testid="start-processing-btn">
                <Play className="h-4 w-4 mr-2" />Start Behandling
              </Button>
            )}
            {detail.status !== "sendt" && detail.started_processing_by_name && (
              <div className="text-xs text-slate-500 flex items-center gap-1 bg-blue-50 border border-blue-100 px-2 py-1 rounded">
                <AlertCircle className="h-3.5 w-3.5" />
                Behandling startet av <strong>{detail.started_processing_by_name}</strong>
                {detail.started_processing_at && ` (${new Date(detail.started_processing_at).toLocaleString("nb-NO")})`}
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-500">Lag:</span> <strong>{detail.team_name}</strong></div>
            <div><span className="text-slate-500">Ønsket dato:</span> <strong>{detail.wanted_date}</strong></div>
            <div><span className="text-slate-500">Kontakt:</span> {detail.contact_name}</div>
            <div><span className="text-slate-500">Telefon / e-post:</span> {detail.contact_phone} · {detail.contact_email}</div>
            {detail.comment && <div className="sm:col-span-2"><span className="text-slate-500">Kommentar:</span> {detail.comment}</div>}
            <div><span className="text-slate-500">Mottatt:</span> {new Date(detail.created_at).toLocaleString("nb-NO")}</div>
            <div><span className="text-slate-500">Sist oppdatert:</span> {new Date(detail.last_update_at || detail.created_at).toLocaleString("nb-NO")}</div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-bold text-sm mb-3">Varelinjer ({(detail.lines || []).length})</h2>
          <div className="space-y-2">
            {(detail.lines || []).map((l) => (
              <div key={l.id} className="border border-slate-200 rounded p-3" data-testid={`admin-line-${l.id}`}>
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
                {l.note && <div className="text-xs text-slate-500 mt-1 italic">Notat: {l.note}</div>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-3 italic">
            Behandling per varelinje (delvis antall, utlevering, utlån, utgått) legges til i neste fase.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Innmeldte behov (lagsportal)</h1>
      <p className="text-sm text-slate-500">Behovsmeldinger innsendt via portal.utstyrsrommet.no.</p>
      <Card className="p-0 overflow-hidden">
        {list.length === 0 ? (
          <div className="text-center text-slate-500 py-8">Ingen innmeldte behov.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((n) => (
              <li key={n.id} data-testid={`needs-row-${n.id}`}>
                <Link to={`/app/innmeldte-behov/${n.id}`} className="flex items-center gap-3 flex-wrap px-4 py-3 hover:bg-red-50/40">
                  <span className="font-mono text-sm font-bold">{n.number}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${STATUS_PILL[n.status] || "bg-slate-100 text-slate-600"}`}>{n.status_label}</span>
                  <span className="font-semibold">{n.team_name}</span>
                  <span className="text-sm text-slate-600">Ønsket: {n.wanted_date}</span>
                  <span className="text-xs text-slate-400 ml-auto">{new Date(n.created_at).toLocaleString("nb-NO")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
