import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Download, Upload, AlertTriangle, CheckCircle2, Package, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function TeamNeedsTab({ teamId, teamName }) {
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState("");
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [filter, setFilter] = useState("all");
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = async (s) => {
    const { data } = await api.get(`/teams/${teamId}/needs${s ? `?season=${s}` : ""}`);
    setData(data);
    if (!seasons.length) setSeasons(data.seasons);
    if (!s && data.seasons?.length) setSeason(data.seasons[0]);
  };
  useEffect(() => { load(); }, [teamId]);
  useEffect(() => { if (season) load(season); }, [season]);

  const downloadTemplate = () => {
    const token = localStorage.getItem("utr_token");
    fetch(`${BASE}/api/teams/${teamId}/needs/template`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob()).then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a"); a.href = u; a.download = `behov_${teamName}.xlsx`; a.click(); URL.revokeObjectURL(u);
      });
  };

  const upload = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post(`/teams/${teamId}/needs/import`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview({ ...data, strategy: data.has_existing ? "replace" : "append" });
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const confirmImport = async () => {
    try {
      const validLines = preview.lines.filter((l) => !l.errors || l.errors.length === 0);
      await api.post(`/teams/${teamId}/needs/confirm`, {
        season: preview.season,
        lines: validLines,
        strategy: preview.strategy,
        filename: preview.filename,
      });
      toast.success(`Importert: ${validLines.length} linjer`);
      setPreview(null);
      setSeason(preview.season);
      await load(preview.season);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const deleteNeed = async (needId) => {
    if (!window.confirm("Slette dette behovs-settet?")) return;
    try { await api.delete(`/teams/${teamId}/needs/${needId}`); await load(season); toast.success("Slettet"); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const lines = data?.lines_computed || [];
  const filtered = lines.filter((l) => {
    if (filter === "covered") return l.can_cover === l.quantity && l.quantity > 0;
    if (filter === "must_order") return l.must_order > 0;
    if (filter === "has_alt") return !!l.alternative;
    if (filter === "missing_price") return l.missing_price && l.must_order > 0;
    return true;
  });

  const totals = lines.reduce((a, l) => ({
    lines: a.lines + 1, qty: a.qty + l.quantity, covered: a.covered + l.can_cover,
    order: a.order + l.must_order, cost: a.cost + (l.line_cost || 0),
    missing: a.missing || (l.missing_price && l.must_order > 0),
  }), { lines: 0, qty: 0, covered: 0, order: 0, cost: 0, missing: false });

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const errorCount = preview?.lines.filter((l) => l.errors?.length).length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={season} onValueChange={setSeason}>
          <SelectTrigger className="w-40" data-testid="needs-season-select"><SelectValue placeholder="Sesong" /></SelectTrigger>
          <SelectContent>{seasons.map((s) => <SelectItem key={s} value={s}>Sesong {s}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={downloadTemplate} data-testid="dl-needs-template"><Download className="h-4 w-4 mr-1" />Last ned Excel-mal</Button>
        <label className="inline-flex">
          <Button variant="outline" asChild data-testid="import-needs-btn">
            <span className="cursor-pointer">
              <Upload className="h-4 w-4 mr-1" />Importer behov
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </span>
          </Button>
        </label>
        <Button variant="ghost" size="icon" onClick={() => load(season)} title="Oppdater"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        <Card className="p-3"><div className="text-xs text-slate-500">Sesong</div><div className="font-bold">{season || "-"}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">Linjer</div><div className="font-bold">{totals.lines}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">Totalt ønsket</div><div className="font-bold">{totals.qty}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">Dekkes fra lager</div><div className="font-bold text-emerald-700">{totals.covered}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">Må bestilles</div><div className="font-bold text-amber-700">{totals.order}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">Innkjøpskost</div>
          <div className="font-bold text-red-700">{nok(totals.cost)}{totals.missing ? "*" : ""}</div>
          {totals.missing && <div className="text-[10px] text-amber-700">* Ufullstendig – mangler innkjøpspris</div>}
        </Card>
      </div>

      <div className="flex flex-wrap gap-1">
        {[["all","Alle"],["covered","Dekkes"],["must_order","Må bestilles"],["has_alt","Har alternativ"],["missing_price","Mangler pris"]].map(([k,l]) => (
          <Button key={k} size="sm" variant={filter===k?"default":"outline"} className={filter===k?"bg-red-700 hover:bg-red-800":""} onClick={() => setFilter(k)}>{l}</Button>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Vare / Str / #</TableHead><TableHead className="text-right">Ønsket</TableHead>
            <TableHead className="text-right">Dekkes</TableHead><TableHead className="text-right">Må bestilles</TableHead>
            <TableHead className="text-right">Innkjøpspris</TableHead><TableHead className="text-right">Linje-kost</TableHead>
            <TableHead>Alternativ</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-6">Ingen behov registrert. Last ned malen, fyll ut og importer.</TableCell></TableRow>}
            {filtered.map((l, idx) => (
              <TableRow key={`${l.line_id}-${idx}`}>
                <TableCell><div className="font-semibold">{l.item_name}</div>
                  <div className="text-xs text-slate-500">{l.item_type}{l.size ? ` · ${l.size}` : ""}{l.jersey_number ? ` · #${l.jersey_number}` : ""}</div>
                </TableCell>
                <TableCell className="text-right">{l.quantity}</TableCell>
                <TableCell className="text-right text-emerald-700">{l.can_cover}</TableCell>
                <TableCell className="text-right text-amber-700 font-semibold">{l.must_order}</TableCell>
                <TableCell className="text-right text-xs">{l.missing_price ? <span className="text-amber-700">Mangler</span> : nok(l.unit_purchase_price)}</TableCell>
                <TableCell className="text-right font-semibold">{l.line_cost === null ? "–" : nok(l.line_cost)}</TableCell>
                <TableCell className="text-xs">
                  {l.alternative ? (
                    <div className="text-slate-700">
                      <div className="font-semibold">{l.alternative.name}{l.alternative.size ? ` (${l.alternative.size})` : ""}</div>
                      <div className="text-[10px] text-slate-500">Disp: {l.alternative.quantity_available} · {l.alternative.reason}</div>
                    </div>
                  ) : l.must_order > 0 ? <span className="text-slate-400">Ingen passende alternativ</span> : "–"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <h4 className="font-semibold text-sm mb-2">Tidligere importer</h4>
        <Table>
          <TableHeader><TableRow><TableHead>Dato</TableHead><TableHead>Sesong</TableHead><TableHead>Fil</TableHead><TableHead>Linjer</TableHead><TableHead>Importert av</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {(data?.needs || []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-4">Ingen importer</TableCell></TableRow>}
            {(data?.needs || []).map((n) => (
              <TableRow key={n.id}>
                <TableCell className="text-xs">{new Date(n.created_at).toLocaleString("nb-NO")}</TableCell>
                <TableCell>{n.season}</TableCell>
                <TableCell className="text-xs truncate max-w-[200px]">{n.filename}</TableCell>
                <TableCell>{(n.lines || []).length}</TableCell>
                <TableCell className="text-xs">{n.imported_by}</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => deleteNeed(n.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Forhåndsvisning: {preview?.filename}</DialogTitle>
            <DialogDescription>
              Lag: {preview?.team_name} · Sesong: {preview?.season} ·
              {errorCount > 0 ? <span className="text-red-700 font-semibold"> {errorCount} feil</span> : <span className="text-emerald-700 font-semibold"> Alle linjer gyldige</span>}
            </DialogDescription>
          </DialogHeader>
          {preview?.has_existing && (
            <div className="border border-amber-300 bg-amber-50 rounded-md p-3 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
              <div className="flex-1 text-sm">Behov finnes allerede for denne sesongen.</div>
              <Select value={preview?.strategy} onValueChange={(v) => setPreview({ ...preview, strategy: v })}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace">Erstatt eksisterende behov</SelectItem>
                  <SelectItem value="append">Legg til som nytt behov</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="max-h-[400px] overflow-y-auto border rounded-md">
            <Table>
              <TableHeader><TableRow><TableHead>Rad</TableHead><TableHead>Varetype</TableHead><TableHead>Vare</TableHead><TableHead>Str</TableHead><TableHead>#</TableHead><TableHead>Antall</TableHead><TableHead>Feil</TableHead></TableRow></TableHeader>
              <TableBody>
                {(preview?.lines || []).map((l) => (
                  <TableRow key={l.row} className={l.errors?.length ? "bg-red-50" : ""}>
                    <TableCell className="text-xs">{l.row}</TableCell>
                    <TableCell>{l.item_type}</TableCell>
                    <TableCell>{l.item_name}</TableCell>
                    <TableCell>{l.size || "-"}</TableCell>
                    <TableCell>{l.jersey_number || "-"}</TableCell>
                    <TableCell>{l.quantity}</TableCell>
                    <TableCell className="text-xs text-red-700">{l.errors?.join(", ") || <CheckCircle2 className="h-4 w-4 text-emerald-600" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Avbryt</Button>
            <Button onClick={confirmImport} disabled={errorCount > 0} className="bg-red-700 hover:bg-red-800" data-testid="confirm-import-needs">
              <Package className="h-4 w-4 mr-1" />Bekreft import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
