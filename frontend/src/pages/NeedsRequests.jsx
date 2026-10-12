import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Play, ArrowLeft, AlertCircle, CheckCircle2, PackagePlus, ShoppingCart, Handshake, XCircle, Ban, Save, Lock, LockOpen, Mail } from "lucide-react";

const STATUS_PILL = {
  sendt: "bg-slate-200 text-slate-700",
  under_behandling: "bg-blue-100 text-blue-800",
  behandlet_ma_bestilles: "bg-amber-100 text-amber-800",
  behandlet_dellevering: "bg-orange-100 text-orange-900",
  kan_leveres_omgaende: "bg-green-100 text-green-800",
  avsluttet: "bg-slate-100 text-slate-600",
  trukket_tilbake: "bg-slate-100 text-slate-500 line-through",
};

const LINE_STATUS = {
  pending: { label: "Venter", cls: "bg-slate-100 text-slate-700" },
  immediate: { label: "Kan leveres omgående", cls: "bg-green-100 text-green-800" },
  to_order: { label: "Må bestilles", cls: "bg-amber-100 text-amber-800" },
  loaned: { label: "Lånes ut", cls: "bg-blue-100 text-blue-800" },
  rejected: { label: "Avvist", cls: "bg-rose-100 text-rose-800" },
  discontinued: { label: "Utgått", cls: "bg-slate-200 text-slate-700" },
  mixed: { label: "Dellevering", cls: "bg-orange-100 text-orange-900" },
};

const BUCKETS = [
  { key: "quantity_immediate", label: "Omgående", short: "Omg.", icon: PackagePlus, color: "text-green-700" },
  { key: "quantity_to_order", label: "Bestilles", short: "Best.", icon: ShoppingCart, color: "text-amber-700" },
  { key: "quantity_loaned", label: "Lånes ut", short: "Lån", icon: Handshake, color: "text-blue-700" },
  { key: "quantity_rejected", label: "Avvist", short: "Avv.", icon: XCircle, color: "text-rose-700" },
  { key: "quantity_discontinued", label: "Utgått", short: "Utg.", icon: Ban, color: "text-slate-600" },
];

function LineProcessor({ line, canWrite, onSave }) {
  const qr = Number(line.quantity_requested || 0);
  const [vals, setVals] = useState({
    quantity_immediate: Number(line.quantity_immediate || 0),
    quantity_to_order: Number(line.quantity_to_order || 0),
    quantity_loaned: Number(line.quantity_loaned || 0),
    quantity_rejected: Number(line.quantity_rejected || 0),
    quantity_discontinued: Number(line.quantity_discontinued || 0),
  });
  const [note, setNote] = useState(line.admin_note || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVals({
      quantity_immediate: Number(line.quantity_immediate || 0),
      quantity_to_order: Number(line.quantity_to_order || 0),
      quantity_loaned: Number(line.quantity_loaned || 0),
      quantity_rejected: Number(line.quantity_rejected || 0),
      quantity_discontinued: Number(line.quantity_discontinued || 0),
    });
    setNote(line.admin_note || "");
  }, [line.id, line.line_updated_at]);

  const sum = Object.values(vals).reduce((a, b) => a + Number(b || 0), 0);
  const remaining = qr - sum;
  const over = sum > qr;
  const dirty =
    vals.quantity_immediate !== Number(line.quantity_immediate || 0) ||
    vals.quantity_to_order !== Number(line.quantity_to_order || 0) ||
    vals.quantity_loaned !== Number(line.quantity_loaned || 0) ||
    vals.quantity_rejected !== Number(line.quantity_rejected || 0) ||
    vals.quantity_discontinued !== Number(line.quantity_discontinued || 0) ||
    note !== (line.admin_note || "");

  const setVal = (key, v) => {
    const n = Math.max(0, Number.isFinite(Number(v)) ? parseInt(v, 10) || 0 : 0);
    setVals({ ...vals, [key]: n });
  };

  const quickFill = (key) => {
    const other = Object.keys(vals).reduce((s, k) => (k === key ? s : s + Number(vals[k] || 0)), 0);
    setVals({ ...vals, [key]: Math.max(0, qr - other) });
  };

  const save = async () => {
    if (over) { toast.error("Summen kan ikke overstige bestilt antall"); return; }
    setSaving(true);
    try {
      await onSave({ ...vals, admin_note: note });
    } finally { setSaving(false); }
  };

  const status = line.line_status || "pending";
  const statusInfo = LINE_STATUS[status] || LINE_STATUS.pending;

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white" data-testid={`admin-line-${line.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-sm flex items-center gap-2">
            {line.full_number && <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">{line.full_number}</span>}
            {line.item_name}
          </div>
          <div className="text-xs text-slate-500">
            {[line.category, line.main_group, line.sub_group].filter(Boolean).join(" · ")}
            {line.size && ` · Størrelse ${line.size}`}
            {line.jersey_number && line.jersey_number !== "X" && ` · #${line.jersey_number}`}
          </div>
          {line.note && <div className="text-xs text-slate-500 mt-1 italic">Fra laget: {line.note}</div>}
        </div>
        <div className="text-right">
          <div className="font-mono font-bold text-lg">{qr} stk</div>
          <div className="text-[10px] text-slate-500 uppercase">Bedt om</div>
          <div className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${statusInfo.cls}`}>{statusInfo.label}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        {BUCKETS.map((b) => (
          <div key={b.key} className="relative">
            <Label className={`text-[10px] uppercase font-bold ${b.color} flex items-center gap-1`}>
              <b.icon className="h-3 w-3" />
              <span className="hidden sm:inline">{b.label}</span>
              <span className="sm:hidden">{b.short}</span>
            </Label>
            <Input
              type="number"
              min="0"
              max={qr}
              value={vals[b.key]}
              onChange={(e) => setVal(b.key, e.target.value)}
              disabled={!canWrite}
              className={`h-9 text-sm ${vals[b.key] > 0 ? "font-bold" : ""}`}
              data-testid={`line-${line.id}-${b.key}`}
              onDoubleClick={() => quickFill(b.key)}
              title="Dobbeltklikk for å fylle rest-antall"
            />
          </div>
        ))}
      </div>

      <div className={`mt-2 flex items-center justify-between flex-wrap gap-2 text-xs ${over ? "text-rose-700" : remaining > 0 ? "text-amber-700" : "text-green-700"}`}>
        <div>
          Sum: <strong>{sum}</strong> / {qr}
          {over && <span className="ml-1 font-bold">· {sum - qr} over!</span>}
          {!over && remaining > 0 && <span className="ml-1">· {remaining} igjen</span>}
          {!over && remaining === 0 && <span className="ml-1 font-bold">· Fullt fordelt ✓</span>}
        </div>
        {line.line_updated_by && (
          <div className="text-slate-400">Sist endret av {line.line_updated_by}</div>
        )}
      </div>

      <div className="mt-2">
        <Input
          placeholder="Internt notat (valgfritt)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!canWrite}
          className="h-8 text-xs"
          data-testid={`line-${line.id}-note`}
        />
      </div>

      {canWrite && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={save} disabled={saving || !dirty || over} className="bg-red-900 hover:bg-red-800" data-testid={`line-${line.id}-save`}>
            <Save className="h-3.5 w-3.5 mr-1" />{saving ? "Lagrer…" : "Lagre linje"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function NeedsRequests() {
  const { id } = useParams();
  const { hasPerm } = useAuth();
  const [list, setList] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const canWrite = hasPerm("teams", "write");

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

  const saveLine = async (lineId, patch) => {
    try {
      const { data } = await api.put(`/needs-requests/${detail.id}/lines/${lineId}`, patch);
      setDetail(data);
      loadList();
      toast.success("Linje oppdatert");
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
      throw e;
    }
  };

  const closeNeeds = async () => {
    setBusy(true);
    try {
      await api.post(`/needs-requests/${detail.id}/close`);
      toast.success(`${detail.number} avsluttet`);
      loadDetail(detail.id); loadList();
      setConfirmClose(false);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!window.confirm("Åpne behovsmeldingen for behandling igjen?")) return;
    setBusy(true);
    try {
      await api.post(`/needs-requests/${detail.id}/reopen`);
      toast.success(`${detail.number} åpnet igjen`);
      loadDetail(detail.id); loadList();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (detail) {
    const lines = detail.lines || [];
    const inProcessable = ["under_behandling", "behandlet_ma_bestilles", "behandlet_dellevering", "kan_leveres_omgaende"].includes(detail.status);
    const isClosed = detail.status === "avsluttet";
    const emailOk = detail.notifications?.new_need_email_sent;

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
            <div className="flex flex-col items-end gap-2">
              {detail.status === "sendt" && canWrite && (
                <Button onClick={startProcessing} disabled={busy} className="bg-red-900 hover:bg-red-800" data-testid="start-processing-btn">
                  <Play className="h-4 w-4 mr-2" />Start Behandling
                </Button>
              )}
              {inProcessable && canWrite && (
                <Button onClick={() => setConfirmClose(true)} disabled={busy} variant="outline" data-testid="close-needs-btn">
                  <Lock className="h-4 w-4 mr-2" />Avslutt behovsmelding
                </Button>
              )}
              {isClosed && canWrite && (
                <Button onClick={reopen} disabled={busy} variant="outline" data-testid="reopen-needs-btn">
                  <LockOpen className="h-4 w-4 mr-2" />Åpne igjen
                </Button>
              )}
              {detail.started_processing_by_name && detail.status !== "sendt" && (
                <div className="text-xs text-slate-500 flex items-center gap-1 bg-blue-50 border border-blue-100 px-2 py-1 rounded">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Startet av <strong>{detail.started_processing_by_name}</strong>
                </div>
              )}
            </div>
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

          {detail.notifications && (
            <div className={`mt-3 text-xs flex items-center gap-1.5 ${emailOk ? "text-green-700" : "text-amber-700"}`}>
              <Mail className="h-3.5 w-3.5" />
              {emailOk
                ? <span>E-postvarsel sendt til klubbens brukere {detail.notifications.new_need_email_at ? `(${new Date(detail.notifications.new_need_email_at).toLocaleString("nb-NO")})` : ""}</span>
                : detail.notifications.new_need_email_error
                  ? <span>E-postvarsel feilet: {detail.notifications.new_need_email_error}</span>
                  : <span>E-postvarsel ikke sendt enda</span>}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-bold text-sm mb-1">Varelinjer ({lines.length})</h2>
          <p className="text-xs text-slate-500 mb-3">
            Fordel «Bedt om»-antallet mellom bøttene nedenfor. <em>Dobbeltklikk</em> i en boks for å autofylle resten.
            Når alle linjer er fullt fordelt, oppdateres overordnet status automatisk.
          </p>
          {detail.status === "sendt" && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Trykk <strong>«Start Behandling»</strong> for å låse opp linjene for behandling.
            </div>
          )}
          <div className="space-y-3">
            {lines.map((l) => (
              <LineProcessor
                key={l.id}
                line={l}
                canWrite={canWrite && inProcessable}
                onSave={(patch) => saveLine(l.id, patch)}
              />
            ))}
          </div>
        </Card>

        <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />Avslutt behovsmelding</DialogTitle>
              <DialogDescription>
                Setter {detail.number} som <strong>avsluttet</strong>. Du kan åpne meldingen igjen senere hvis det kommer endringer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmClose(false)}>Avbryt</Button>
              <Button onClick={closeNeeds} disabled={busy} className="bg-red-900 hover:bg-red-800" data-testid="confirm-close-needs">
                <CheckCircle2 className="h-4 w-4 mr-1" />Avslutt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
