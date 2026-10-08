import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Package } from "lucide-react";
import { toast } from "sonner";

const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

export default function StockOrderDialog({ open, onClose, suppliers, items, onDone, lockedSupplierId }) {
  const [supplierId, setSupplierId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [lines, setLines] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) { setSupplierId(""); setLines([]); setDeliveryDate(""); setNotes(""); }
    else if (lockedSupplierId) { setSupplierId(lockedSupplierId); }
  }, [open, lockedSupplierId]);

  const addLine = (item) => {
    if (!item) return;
    setLines((prev) => [...prev, {
      _key: `${item.id}-${Date.now()}`,
      item_id: item.id, item_name: item.name,
      size: "", jersey_number: "",
      quantity: 1,
      unit_price: item.purchase_price || 0,
    }]);
    setAddOpen(false);
  };

  const total = lines.reduce((a, l) => a + (l.quantity || 0) * (l.unit_price || 0), 0);

  const submit = async () => {
    if (!supplierId) { toast.error("Velg leverandør"); return; }
    if (!lines.length) { toast.error("Legg til minst én vare"); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post("/orders", {
        supplier_id: supplierId, is_stock_order: true,
        delivery_date: deliveryDate || null,
        lines: lines.map((l) => ({
          item_id: l.item_id, item_name: l.item_name,
          size: l.size || null, jersey_number: l.jersey_number || null,
          quantity: parseInt(l.quantity, 10) || 0,
          unit_price: parseFloat(l.unit_price) || 0,
        })),
        notes,
      });
      toast.success(`Lagerordre opprettet – ${data.po_number}`);
      onDone?.(data); onClose();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="stock-order-dialog">
        <DialogHeader>
          <DialogTitle>+ Opprett ny lagerordre{lockedSupplierId ? ` for #${suppliers.find((s) => s.id === lockedSupplierId)?.supplier_number || ""} ${suppliers.find((s) => s.id === lockedSupplierId)?.name || ""}` : ""}</DialogTitle>
          <DialogDescription>{lockedSupplierId ? "Kun varer knyttet til denne leverandøren kan velges." : "Lagerbestilling – ikke knyttet til et lag"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Leverandør{lockedSupplierId && " (låst)"}</Label>
              <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); setLines([]); }} disabled={!!lockedSupplierId}>
                <SelectTrigger data-testid="stock-supplier-select"><SelectValue placeholder="Velg leverandør" /></SelectTrigger>
                <SelectContent>
                  {suppliers.filter((s) => s.active !== false).map((s) => (
                    <SelectItem key={s.id} value={s.id}>#{s.supplier_number} · {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ønsket leveringsdato</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} data-testid="stock-delivery-date" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label>Varelinjer ({lines.length})</Label>
            <Button type="button" size="sm" onClick={() => setAddOpen(true)} disabled={!supplierId} className="bg-red-700 hover:bg-red-800" data-testid="add-stock-line-btn"><Plus className="h-3 w-3 mr-1" />Legg til vare</Button>
          </div>

          {lines.length > 0 ? (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Vare</TableHead><TableHead>Str</TableHead><TableHead className="text-right">Antall</TableHead><TableHead className="text-right">Innkjøpspris</TableHead><TableHead className="text-right">Sum</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {lines.map((l, idx) => (
                    <TableRow key={l._key}>
                      <TableCell className="font-semibold">{l.item_name}</TableCell>
                      <TableCell><Input className="w-20" placeholder="Str" value={l.size} onChange={(e) => { const u = [...lines]; u[idx].size = e.target.value; setLines(u); }} /></TableCell>
                      <TableCell className="text-right"><Input type="number" className="w-20 inline-block" value={l.quantity} onChange={(e) => { const u = [...lines]; u[idx].quantity = parseInt(e.target.value) || 0; setLines(u); }} /></TableCell>
                      <TableCell className="text-right"><Input type="number" step="0.01" className="w-24 inline-block" value={l.unit_price} onChange={(e) => { const u = [...lines]; u[idx].unit_price = e.target.value; setLines(u); }} /></TableCell>
                      <TableCell className="text-right font-semibold">{nok(l.quantity * l.unit_price)}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, i) => i !== idx))}><Trash2 className="h-3 w-3 text-red-600" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <div className="text-center text-slate-500 py-6 text-sm border border-dashed rounded-md">Ingen varer lagt til ennå. Velg leverandør og trykk «Legg til vare».</div>}

          <div><Label>Notat (valgfri)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          <div className="flex items-center justify-between bg-slate-50 border rounded-md p-3">
            <div className="text-sm">{lines.length} linjer</div>
            <div className="font-bold">{nok(total)} <span className="text-xs text-slate-500">eks. mva</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={submit} disabled={submitting || !supplierId || lines.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="confirm-stock-order">
            <Package className="h-4 w-4 mr-1" />Utfør bestilling
          </Button>
        </DialogFooter>
      </DialogContent>

      <AddLineDialog open={addOpen} onClose={() => setAddOpen(false)} items={items} supplierId={supplierId} onPick={addLine} />
    </Dialog>
  );
}

function AddLineDialog({ open, onClose, items, supplierId, onPick }) {
  const [q, setQ] = useState("");
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const filtered = items.filter((i) => {
    if (!q) return true;
    const t = q.toLowerCase();
    return (i.name || "").toLowerCase().includes(t) || (i.category || "").toLowerCase().includes(t);
  }).slice(0, 100);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="add-line-dialog">
        <DialogHeader><DialogTitle>Legg til vare</DialogTitle><DialogDescription>Kun varer fra valgt leverandør er aktivert. Andre vises grå.</DialogDescription></DialogHeader>
        <Input placeholder="Søk vare…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
        <div className="max-h-[460px] overflow-y-auto border rounded-md">
          <Table>
            <TableHeader><TableRow><TableHead>Vare</TableHead><TableHead>Kategori</TableHead><TableHead>Leverandør</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-500 py-4">Ingen treff</TableCell></TableRow>}
              {filtered.map((i) => {
                const matches = i.supplier_id === supplierId;
                return (
                  <TableRow key={i.id} className={matches ? "" : "opacity-40 bg-slate-50"}>
                    <TableCell className="font-semibold">{i.name}</TableCell>
                    <TableCell className="text-xs">{i.category || "-"}</TableCell>
                    <TableCell className="text-xs">{i.supplier_name ? `#${i.supplier_number} · ${i.supplier_name}` : <span className="text-red-700">Mangler</span>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" disabled={!matches} onClick={() => onPick(i)} className={matches ? "bg-red-700 hover:bg-red-800" : ""} data-testid={`pick-item-${i.id}`}>
                        {matches ? "Velg" : "Annen lev."}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Lukk</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
