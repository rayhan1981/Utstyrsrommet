import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check, Trash2, Download, Upload, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { sortSizesNatural } from "@/lib/sizeSort";

export default function StockAudit() {
  const { hasPerm } = useAuth();
  const [counts, setCounts] = useState([]);
  const [items, setItems] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState({}); // line_id -> input value
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ item_id: "", size: "", new_quantity: "", reason: "" });
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = async () => {
    const [c, i, a] = await Promise.all([
      api.get("/stock-counts"),
      api.get("/items").catch(() => ({ data: [] })),
      api.get("/stock/adjustments").catch(() => ({ data: [] })),
    ]);
    setCounts(c.data); setItems(i.data || []); setAdjustments(a.data || []);
    if (active) setActive(c.data.find((x) => x.id === active.id) || null);
  };
  useEffect(() => { load(); }, []);

  const start = async () => {
    try {
      const { data } = await api.post("/stock-counts", { name: "" });
      toast.success(`Ny varetelling startet (${data.lines?.length || 0} varelinjer forhåndsutfylt)`);
      setActive(data);
      setDraft({});
      await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const saveLine = async (line) => {
    const raw = draft[line.line_id];
    if (raw === undefined || raw === "" || isNaN(parseInt(raw))) return;
    try {
      await api.put(`/stock-counts/${active.id}/lines/${line.line_id}`, {
        item_id: line.item_id, size: line.size || null, counted_quantity: parseInt(raw)
      });
      setDraft((d) => { const n = { ...d }; delete n[line.line_id]; return n; });
      await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delLine = async (line) => {
    if (!window.confirm("Slette denne tellerlinjen?")) return;
    try { await api.delete(`/stock-counts/${active.id}/lines/${line.line_id}`); toast.success("Linje slettet"); await load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const apply = async () => {
    if (!window.confirm("Oppdatere systemets beholdning med tellerresultatene? Uttalte linjer ignoreres.")) return;
    try { await api.post(`/stock-counts/${active.id}/apply`); toast.success("Beholdning oppdatert"); await load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delCount = async (id) => {
    if (!window.confirm("Slette hele varetellingen?")) return;
    try { await api.delete(`/stock-counts/${id}`); toast.success("Varetelling slettet"); if (active?.id === id) setActive(null); await load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const exportTelledokument = (count) => {
    const token = localStorage.getItem("utr_token");
    fetch(`${BASE}/api/stock-counts/${count.id}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a"); a.href = u;
        a.download = `telledokument_${(count.name || "varetelling").replace(/\s+/g, "_")}.xlsx`;
        a.click(); URL.revokeObjectURL(u);
      });
  };

  const importTelledokument = async (count, file) => {
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post(`/stock-counts/${count.id}/import`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.errors && data.errors.length) {
        toast.warning(`${data.updated} linjer oppdatert, ${data.errors.length} feil`);
        console.warn("Importfeil:", data.errors);
      } else {
        toast.success(`${data.updated} tellelinjer importert`);
      }
      await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const openAdjust = () => {
    setAdjustForm({ item_id: "", size: "", new_quantity: "", reason: "" });
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    if (!adjustForm.item_id) { toast.error("Velg vare"); return; }
    if (adjustForm.new_quantity === "" || isNaN(parseInt(adjustForm.new_quantity))) { toast.error("Angi nytt antall"); return; }
    if (!adjustForm.reason || adjustForm.reason.trim().length < 3) { toast.error("Begrunnelse er påkrevd (min 3 tegn)"); return; }
    try {
      const payload = {
        item_id: adjustForm.item_id,
        size: adjustForm.size || null,
        new_quantity: parseInt(adjustForm.new_quantity),
        reason: adjustForm.reason.trim(),
      };
      const { data } = await api.post("/stock/manual-adjust", payload);
      toast.success(`Justert: ${data.before} → ${data.after}`);
      setAdjustOpen(false); await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const selectedAdjustItem = items.find((i) => i.id === adjustForm.item_id);
  const needsSize = !!(selectedAdjustItem?.is_clothing || selectedAdjustItem?.is_ball);
  const availableSizes = needsSize ? sortSizesNatural((selectedAdjustItem?.sizes || []), (s) => s.size) : [];

  const filteredLines = useMemo(() => {
    const lines = active?.lines || [];
    if (!filter.trim()) return lines;
    const q = filter.toLowerCase();
    return lines.filter((ln) => (ln.item_name || "").toLowerCase().includes(q) || (ln.location || "").toLowerCase().includes(q) || (ln.size || "").toLowerCase().includes(q));
  }, [active, filter]);

  const countedCount = (active?.lines || []).filter((l) => l.counted_quantity != null).length;

  return (
    <div className="space-y-6" data-testid="stock-audit-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Varetelling</h1>
          <p className="text-slate-600 text-sm mt-1">Alle varer forhåndsutfylt – sortert på lokasjon og varenavn</p>
        </div>
        {hasPerm("stock_audit", "write") && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={openAdjust} data-testid="manual-adjust-btn">
              <SlidersHorizontal className="h-4 w-4 mr-2" />Manuell justering
            </Button>
            <Button onClick={start} data-testid="start-count-btn" className="bg-red-900 hover:bg-red-800">
              <Plus className="h-4 w-4 mr-2" />Start ny varetelling
            </Button>
          </div>
        )}
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2 text-sm">Tidligere varetellinger</h3>
        <div className="divide-y divide-slate-100">
          {counts.length === 0 && <div className="text-sm text-slate-500 py-3">Ingen varetellinger ennå.</div>}
          {counts.map((c) => (
            <div key={c.id} className={`w-full flex items-center justify-between py-3 text-sm px-2 rounded ${active?.id === c.id ? "bg-red-50" : "hover:bg-slate-50"}`}>
              <button onClick={() => setActive(c)} className="flex-1 text-left" data-testid={`count-row-${c.id}`}>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {new Date(c.created_at).toLocaleString("nb-NO")} • {c.lines?.length || 0} linjer
                  • {c.lines?.filter((l) => l.counted_quantity != null).length || 0} talt
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => exportTelledokument(c)} data-testid={`export-count-${c.id}`} className="flex items-center gap-1">
                  <Download className="h-3 w-3" /><span className="text-xs">Eksporter</span>
                </Button>
                {c.status === "open" && hasPerm("stock_audit", "write") && (
                  <label className="inline-flex">
                    <Button variant="outline" size="sm" asChild data-testid={`import-count-${c.id}`}>
                      <span className="cursor-pointer flex items-center gap-1">
                        <Upload className="h-3 w-3" /><span className="text-xs">Importer</span>
                        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importTelledokument(c, e.target.files[0])} />
                      </span>
                    </Button>
                  </label>
                )}
                <span className={`text-xs font-semibold px-2 py-1 rounded ${c.status === "applied" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  {c.status === "applied" ? "Anvendt" : "Åpen"}
                </span>
                {hasPerm("stock_audit", "admin") && (
                  <Button variant="ghost" size="icon" onClick={() => delCount(c.id)} data-testid={`del-count-${c.id}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {active && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="font-display text-lg font-bold">{active.name}</h3>
              <p className="text-xs text-slate-500">{countedCount} av {active.lines?.length || 0} linjer talt</p>
            </div>
            <div className="flex gap-2">
              <Input placeholder="Søk vare, lokasjon, str…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" data-testid="count-filter" />
              <Button variant="outline" onClick={() => exportTelledokument(active)} data-testid="export-active-btn">
                <Download className="h-4 w-4 mr-1" />Eksporter telledokument
              </Button>
              {active.status === "open" && hasPerm("stock_audit", "write") && (
                <>
                  <label className="inline-flex">
                    <Button variant="outline" asChild data-testid="import-active-btn">
                      <span className="cursor-pointer"><Upload className="h-4 w-4 mr-1" />Importer varetelling
                        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importTelledokument(active, e.target.files[0])} />
                      </span>
                    </Button>
                  </label>
                  <Button onClick={apply} data-testid="apply-count-btn" className="bg-red-900 hover:bg-red-800"><Check className="h-4 w-4 mr-1" />Anvend og juster beholdning</Button>
                </>
              )}
            </div>
          </div>
          <div className="border border-slate-200 rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Lokasjon</TableHead>
                <TableHead>Vare</TableHead>
                <TableHead>Str</TableHead>
                <TableHead className="text-right">System</TableHead>
                <TableHead className="text-right">Talt</TableHead>
                <TableHead className="text-right">Diff</TableHead>
                <TableHead>Telt dato/tid</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredLines.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-6">Ingen linjer.</TableCell></TableRow>}
                {filteredLines.map((ln) => {
                  const counted = ln.counted_quantity;
                  const diff = counted == null ? null : counted - (ln.system_quantity || 0);
                  return (
                    <TableRow key={ln.line_id} data-testid={`count-line-${ln.line_id}`}>
                      <TableCell className="text-sm">{ln.location || "-"}</TableCell>
                      <TableCell className="font-semibold">{ln.item_name}</TableCell>
                      <TableCell>{ln.size || "-"}</TableCell>
                      <TableCell className="text-right">{ln.system_quantity}</TableCell>
                      <TableCell className="text-right">
                        {active.status === "open" ? (
                          <Input
                            type="number"
                            className="w-20 text-right inline-block"
                            value={draft[ln.line_id] !== undefined ? draft[ln.line_id] : (counted ?? "")}
                            onChange={(e) => setDraft((d) => ({ ...d, [ln.line_id]: e.target.value }))}
                            onBlur={() => saveLine(ln)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.target.blur(); } }}
                            data-testid={`count-input-${ln.line_id}`}
                          />
                        ) : (counted ?? "-")}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${diff == null ? "text-slate-400" : diff === 0 ? "" : diff > 0 ? "text-red-700" : "text-red-700"}`}>
                        {diff == null ? "-" : (diff > 0 ? `+${diff}` : diff)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {ln.counted_at ? new Date(ln.counted_at).toLocaleString("nb-NO") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {active.status === "open" && hasPerm("stock_audit", "write") && (
                          <Button variant="ghost" size="icon" onClick={() => delLine(ln)} data-testid={`del-line-${ln.line_id}`}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Justeringshistorikk */}
      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-red-700" />
          Siste manuelle justeringer
        </h3>
        {adjustments.length === 0 ? (
          <div className="text-sm text-slate-500 py-2">Ingen manuelle justeringer ennå.</div>
        ) : (
          <div className="border border-slate-200 rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dato</TableHead>
                  <TableHead>Vare</TableHead>
                  <TableHead>Str</TableHead>
                  <TableHead className="text-right">Før</TableHead>
                  <TableHead className="text-right">Etter</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead>Begrunnelse</TableHead>
                  <TableHead>Bruker</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.slice(0, 25).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.created_at).toLocaleString("nb-NO")}</TableCell>
                    <TableCell className="font-semibold">{a.item_name}</TableCell>
                    <TableCell>{a.size || "-"}</TableCell>
                    <TableCell className="text-right">{a.before}</TableCell>
                    <TableCell className="text-right">{a.after}</TableCell>
                    <TableCell className={`text-right font-semibold ${a.diff === 0 ? "" : "text-red-700"}`}>{a.diff > 0 ? `+${a.diff}` : a.diff}</TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate" title={a.reason}>{a.reason}</TableCell>
                    <TableCell className="text-xs">{a.user_name || a.user_email}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Manuell justering-dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manuell justering av beholdning</DialogTitle>
            <DialogDescription>Begrunnelse er påkrevd og lagres i justeringshistorikken.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Vare *</Label>
              <Select value={adjustForm.item_id} onValueChange={(v) => setAdjustForm({ ...adjustForm, item_id: v, size: "" })}>
                <SelectTrigger data-testid="adjust-item-select"><SelectValue placeholder="Velg vare" /></SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name}{i.category ? ` – ${i.category}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsSize && (
              <div>
                <Label>Størrelse *</Label>
                <Select value={adjustForm.size} onValueChange={(v) => setAdjustForm({ ...adjustForm, size: v })}>
                  <SelectTrigger data-testid="adjust-size-select"><SelectValue placeholder="Velg størrelse" /></SelectTrigger>
                  <SelectContent>
                    {availableSizes.map((s) => (
                      <SelectItem key={s.size} value={s.size}>
                        {s.size} (nå: {s.quantity}){s.jersey_number && s.jersey_number !== "X" ? ` – #${s.jersey_number}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Nytt antall *</Label>
              <Input type="number" min="0" value={adjustForm.new_quantity} onChange={(e) => setAdjustForm({ ...adjustForm, new_quantity: e.target.value })} data-testid="adjust-qty-input" />
            </div>
            <div>
              <Label>Begrunnelse * (min 3 tegn)</Label>
              <textarea
                className="w-full border rounded-md p-2 min-h-[80px] text-sm"
                placeholder="F.eks. svinn, skadet vare, ekstern donasjon…"
                value={adjustForm.reason}
                onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                data-testid="adjust-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Avbryt</Button>
            <Button onClick={submitAdjust} className="bg-red-900 hover:bg-red-800" data-testid="confirm-adjust-btn">Utfør justering</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
