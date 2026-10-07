import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

export default function OrderDialog({ open, onClose, schema, suppliers, onDone }) {
  const [udekket, setUdekket] = useState(null);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !schema) { setUdekket(null); setLines([]); setSupplierId(""); return; }
    api.get(`/behovsskjema/${schema.id}/udekket`).then(({ data }) => {
      setUdekket(data);
      const initial = (data.lines || []).filter((l) => l.remaining_to_order > 0)
        .map((l) => ({
          _key: `${l.item_id}|${l.size || ""}|${l.jersey_number || ""}`,
          item_id: l.item_id, item_name: l.item_name,
          size: l.size, jersey_number: l.jersey_number,
          quantity: l.remaining_to_order,
          unit_price: l.unit_purchase_price || 0,
          original_quantity: l.remaining_to_order,
          stock_order_candidates: l.stock_order_candidates || [],
          reserved_from_po: null, reserved_qty: 0,
          include: true,
        }));
      setLines(initial);
    }).catch((e) => toast.error(formatError(e.response?.data?.detail)));
  }, [open, schema]);

  const total = lines.filter((l) => l.include).reduce((a, l) => a + (l.quantity || 0) * (l.unit_price || 0), 0);
  const validLineCount = lines.filter((l) => l.include && l.quantity > 0).length;

  const reserveStock = async (lineIdx, candidate, qty) => {
    try {
      await api.post("/stock-reservations", {
        stock_order_id: candidate.order_id,
        stock_line_id: candidate.line_id,
        behovsskjema_id: schema.id,
        quantity: qty,
      });
      const upd = [...lines];
      upd[lineIdx].reserved_from_po = candidate.po_number;
      upd[lineIdx].reserved_qty = qty;
      upd[lineIdx].quantity = Math.max(0, upd[lineIdx].quantity - qty);
      setLines(upd);
      toast.success(`Reservert ${qty} fra lagerbestilling ${candidate.po_number}`);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const submit = async () => {
    if (!supplierId) { toast.error("Velg leverandør"); return; }
    const payload = {
      supplier_id: supplierId,
      behovsskjema_id: schema.id,
      is_stock_order: false,
      lines: lines.filter((l) => l.include && l.quantity > 0).map((l) => ({
        item_id: l.item_id, item_name: l.item_name,
        size: l.size, jersey_number: l.jersey_number,
        quantity: parseInt(l.quantity, 10) || 0,
        unit_price: parseFloat(l.unit_price) || 0,
      })),
      notes,
    };
    if (!payload.lines.length) { toast.error("Minst én varelinje"); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post("/orders", payload);
      toast.success(`Bestilling opprettet – ${data.po_number}`);
      onDone?.(data);
      onClose();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setSubmitting(false); }
  };

  const downloadPdf = async (orderId) => {
    const token = localStorage.getItem("utr_token");
    const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/orders/${orderId}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = `bestilling.pdf`; a.click(); URL.revokeObjectURL(u);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="order-dialog">
        <DialogHeader>
          <DialogTitle>Bestill behovsvarer: {schema?.po_number} · {schema?.team_name}</DialogTitle>
          <DialogDescription>Sesong {schema?.season} · Udekket behov med forslag til reservasjoner fra åpne lagerbestillinger</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Leverandør</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger data-testid="order-supplier-select"><SelectValue placeholder="Velg leverandør" /></SelectTrigger>
              <SelectContent>{suppliers.filter((s) => s.active !== false).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {lines.length === 0 && udekket && <div className="text-center text-slate-500 py-6">Alt behov er dekket. Ingenting å bestille.</div>}

          {lines.length > 0 && (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Inkl.</TableHead>
                  <TableHead>Vare / Str / #</TableHead>
                  <TableHead className="text-right">Antall</TableHead>
                  <TableHead className="text-right">Innkjøpspris</TableHead>
                  <TableHead className="text-right">Linje-sum</TableHead>
                  <TableHead>Reservasjon fra lager</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {lines.map((l, idx) => (
                    <TableRow key={l._key}>
                      <TableCell><input type="checkbox" checked={l.include} onChange={(e) => { const u = [...lines]; u[idx].include = e.target.checked; setLines(u); }} data-testid={`order-line-include-${idx}`} /></TableCell>
                      <TableCell><div className="font-semibold">{l.item_name}</div><div className="text-xs text-slate-500">{l.size || ""}{l.jersey_number && l.jersey_number !== "X" ? ` #${l.jersey_number}` : ""}</div></TableCell>
                      <TableCell className="text-right"><Input type="number" min="0" className="w-20 inline-block" value={l.quantity} onChange={(e) => { const u = [...lines]; u[idx].quantity = parseInt(e.target.value) || 0; setLines(u); }} /></TableCell>
                      <TableCell className="text-right"><Input type="number" step="0.01" className="w-24 inline-block" value={l.unit_price} onChange={(e) => { const u = [...lines]; u[idx].unit_price = e.target.value; setLines(u); }} /></TableCell>
                      <TableCell className="text-right font-semibold">{nok(l.quantity * l.unit_price)}</TableCell>
                      <TableCell className="text-xs">
                        {l.reserved_from_po ? (
                          <span className="text-emerald-700 font-semibold">✓ Reservert {l.reserved_qty} fra {l.reserved_from_po}</span>
                        ) : l.stock_order_candidates.length > 0 ? (
                          <div className="space-y-1">
                            {l.stock_order_candidates.map((c) => (
                              <div key={c.line_id} className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                <AlertTriangle className="h-3 w-3 text-amber-700" />
                                <span>Åpen LB {c.po_number} ({c.remaining} tilgj.)</span>
                                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => reserveStock(idx, c, Math.min(c.remaining, l.quantity))} data-testid={`reserve-btn-${idx}`}>Reserver</Button>
                              </div>
                            ))}
                          </div>
                        ) : "–"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div><Label>Notat til leverandør (valgfri)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          <div className="flex items-center justify-between bg-slate-50 border rounded-md p-3">
            <div className="text-sm text-slate-600">{validLineCount} linjer</div>
            <div className="font-bold text-lg">{nok(total)} <span className="text-xs text-slate-500">eks. mva</span></div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={submit} disabled={submitting || !supplierId || validLineCount === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold" data-testid="confirm-order-btn">
            <Package className="h-4 w-4 mr-1" />Utfør bestilling
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
