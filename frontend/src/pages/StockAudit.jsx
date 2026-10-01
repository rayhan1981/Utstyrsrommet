import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function StockAudit() {
  const { hasPerm } = useAuth();
  const [counts, setCounts] = useState([]);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [line, setLine] = useState({ item_id: "", size: "", counted_quantity: 0 });

  const load = async () => {
    const [c, i] = await Promise.all([api.get("/stock-counts"), api.get("/items")]);
    setCounts(c.data); setItems(i.data);
    if (active) setActive(c.data.find((x) => x.id === active.id) || null);
  };
  useEffect(() => { load(); }, []);

  const start = async () => {
    try { const { data } = await api.post("/stock-counts", { name: "" }); toast.success("Ny varetelling startet"); setActive(data); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const addLine = async () => {
    try {
      await api.post(`/stock-counts/${active.id}/lines`, { ...line, counted_quantity: parseInt(line.counted_quantity) || 0, size: line.size || null });
      toast.success("Linje lagt til"); setAddOpen(false); setLine({ item_id: "", size: "", counted_quantity: 0 }); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const apply = async () => {
    if (!window.confirm("Oppdatere systemets beholdning med tellerresultatene?")) return;
    try { await api.post(`/stock-counts/${active.id}/apply`); toast.success("Beholdning oppdatert"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const selectedItem = items.find((i) => i.id === line.item_id);

  return (
    <div className="space-y-6" data-testid="stock-audit-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Varetelling</h1>
          <p className="text-slate-600 text-sm mt-1">Årlig telling og justering av faktisk beholdning</p>
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
            <button key={c.id} onClick={() => setActive(c)} className={`w-full flex items-center justify-between py-3 text-sm text-left hover:bg-slate-50 px-2 rounded ${active?.id === c.id ? "bg-emerald-50" : ""}`}>
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-slate-500">{new Date(c.created_at).toLocaleString("nb-NO")} • {c.lines?.length || 0} linjer</div>
              </div>
              <span className={`text-xs font-semibold px-2 py-1 rounded ${c.status === "applied" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {c.status === "applied" ? "Anvendt" : "Åpen"}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {active && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-display text-lg font-bold">{active.name}</h3>
            <div className="flex gap-2">
              {active.status === "open" && hasPerm("stock_audit", "write") && (
                <>
                  <Button variant="outline" onClick={() => setAddOpen(true)} data-testid="add-count-line-btn"><Plus className="h-4 w-4 mr-1" />Legg til linje</Button>
                  <Button onClick={apply} data-testid="apply-count-btn" className="bg-emerald-900 hover:bg-emerald-800"><Check className="h-4 w-4 mr-1" />Anvend og juster beholdning</Button>
                </>
              )}
            </div>
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Vare</TableHead><TableHead>Str</TableHead><TableHead>System</TableHead><TableHead>Talt</TableHead><TableHead>Differanse</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(active.lines || []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-6">Ingen linjer ennå.</TableCell></TableRow>}
              {(active.lines || []).map((ln) => (
                <TableRow key={ln.line_id}>
                  <TableCell>{ln.item_name}</TableCell>
                  <TableCell>{ln.size || "-"}</TableCell>
                  <TableCell>{ln.system_quantity}</TableCell>
                  <TableCell className="font-semibold">{ln.counted_quantity}</TableCell>
                  <TableCell className={ln.diff === 0 ? "" : ln.diff > 0 ? "text-emerald-700 font-semibold" : "text-red-700 font-semibold"}>{ln.diff > 0 ? `+${ln.diff}` : ln.diff}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Legg til tellerlinje</DialogTitle>
            <DialogDescription>Registrer faktisk antall for en vare.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Vare</Label>
              <Select value={line.item_id} onValueChange={(v) => setLine({ ...line, item_id: v, size: "" })}>
                <SelectTrigger><SelectValue placeholder="Velg vare" /></SelectTrigger>
                <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {selectedItem?.is_clothing && (
              <div>
                <Label>Størrelse</Label>
                <Select value={line.size} onValueChange={(v) => setLine({ ...line, size: v })}>
                  <SelectTrigger><SelectValue placeholder="Velg str" /></SelectTrigger>
                  <SelectContent>{(selectedItem.sizes || []).map((s) => <SelectItem key={s.size} value={s.size}>{s.size}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Faktisk antall talt</Label><Input type="number" value={line.counted_quantity} onChange={(e) => setLine({ ...line, counted_quantity: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Avbryt</Button>
            <Button onClick={addLine} className="bg-emerald-900 hover:bg-emerald-800">Legg til</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
