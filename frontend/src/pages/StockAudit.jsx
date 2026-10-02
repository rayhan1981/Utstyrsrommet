import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function StockAudit() {
  const { hasPerm } = useAuth();
  const [counts, setCounts] = useState([]);
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState({}); // line_id -> input value

  const load = async () => {
    const { data } = await api.get("/stock-counts");
    setCounts(data);
    if (active) setActive(data.find((x) => x.id === active.id) || null);
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
          <Button onClick={start} data-testid="start-count-btn" className="bg-emerald-900 hover:bg-emerald-800">
            <Plus className="h-4 w-4 mr-2" />Start ny varetelling
          </Button>
        )}
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2 text-sm">Tidligere varetellinger</h3>
        <div className="divide-y divide-slate-100">
          {counts.length === 0 && <div className="text-sm text-slate-500 py-3">Ingen varetellinger ennå.</div>}
          {counts.map((c) => (
            <div key={c.id} className={`w-full flex items-center justify-between py-3 text-sm px-2 rounded ${active?.id === c.id ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
              <button onClick={() => setActive(c)} className="flex-1 text-left" data-testid={`count-row-${c.id}`}>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {new Date(c.created_at).toLocaleString("nb-NO")} • {c.lines?.length || 0} linjer
                  • {c.lines?.filter((l) => l.counted_quantity != null).length || 0} talt
                </div>
              </button>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-1 rounded ${c.status === "applied" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
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
              {active.status === "open" && hasPerm("stock_audit", "write") && (
                <Button onClick={apply} data-testid="apply-count-btn" className="bg-emerald-900 hover:bg-emerald-800"><Check className="h-4 w-4 mr-1" />Anvend og juster beholdning</Button>
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
                      <TableCell className={`text-right font-semibold ${diff == null ? "text-slate-400" : diff === 0 ? "" : diff > 0 ? "text-emerald-700" : "text-red-700"}`}>
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
    </div>
  );
}
