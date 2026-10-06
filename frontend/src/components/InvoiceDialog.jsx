import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { FileText, Download, Mail } from "lucide-react";

const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });
const BASE = process.env.REACT_APP_BACKEND_URL;

export default function InvoiceDialog({ open, onOpenChange, personId, teamId, recipientName }) {
  const [loans, setLoans] = useState([]);
  const [selected, setSelected] = useState({});
  const [dueDays, setDueDays] = useState("14");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [generated, setGenerated] = useState(null);

  useEffect(() => {
    if (!open) return;
    const params = { status: "borrowed" };
    if (personId) params.person_id = personId;
    if (teamId) params.team_id = teamId;
    api.get("/loans", { params }).then((r) => {
      const list = (r.data || []).filter((l) => (l.amount_owed || 0) > 0);
      setLoans(list);
      const next = {};
      list.forEach((l) => { next[l.id] = true; });
      setSelected(next);
      setGenerated(null);
    });
  }, [open, personId, teamId]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const toggleAll = (val) => setSelected(Object.fromEntries(loans.map((l) => [l.id, val])));
  const chosenIds = Object.keys(selected).filter((k) => selected[k]);
  const chosenTotal = loans.filter((l) => selected[l.id]).reduce((s, l) => s + (l.amount_owed || 0), 0);
  const allSelected = chosenIds.length === loans.length && loans.length > 0;

  const generate = async () => {
    try {
      if (chosenIds.length === 0) { toast.error("Velg minst én linje"); return; }
      const { data } = await api.post("/invoices", {
        person_id: personId || null, team_id: teamId || null,
        loan_ids: chosenIds, due_in_days: parseInt(dueDays), notes,
      });
      setGenerated(data);
      setEmail(data.recipient_email || "");
      toast.success(`Faktura ${data.invoice_number} opprettet (${nok(data.total)})`);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const download = () => {
    const token = localStorage.getItem("utr_token");
    fetch(`${BASE}/api/invoices/${generated.id}/pdf`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = `faktura-${generated.invoice_number}.pdf`; a.click(); URL.revokeObjectURL(u);
      });
  };

  const sendEmail = async () => {
    try {
      await api.post(`/invoices/${generated.id}/send`, { email: email || null });
      toast.success("Faktura sendt på e-post");
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Lag faktura</DialogTitle>
          <DialogDescription>{recipientName} · velg hvilke linjer som skal med</DialogDescription>
        </DialogHeader>

        {!generated ? (
          <>
            <div className="border border-slate-200 rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} data-testid="inv-select-all" /></TableHead>
                    <TableHead>Dato</TableHead>
                    <TableHead>Vare</TableHead>
                    <TableHead>Antall</TableHead>
                    <TableHead className="text-right">Skyldig</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loans.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-6">Ingen linjer med skyldig beløp.</TableCell></TableRow>}
                  {loans.map((l) => (
                    <TableRow key={l.id} data-testid={`inv-row-${l.id}`}>
                      <TableCell><Checkbox checked={!!selected[l.id]} onCheckedChange={() => toggle(l.id)} /></TableCell>
                      <TableCell className="text-xs">{new Date(l.loan_date).toLocaleDateString("nb-NO")}</TableCell>
                      <TableCell>{l.item_name}{l.size ? ` (${l.size})` : ""}</TableCell>
                      <TableCell>{l.quantity}</TableCell>
                      <TableCell className="text-right font-semibold text-red-700">{nok(l.amount_owed)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between bg-red-50 rounded-md p-3">
              <span className="text-sm">Valgt: {chosenIds.length} linje{chosenIds.length === 1 ? "" : "r"}</span>
              <span className="font-display font-bold text-lg">{nok(chosenTotal)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Forfall</Label>
                <Select value={dueDays} onValueChange={setDueDays}>
                  <SelectTrigger data-testid="inv-due-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 dager</SelectItem>
                    <SelectItem value="14">14 dager</SelectItem>
                    <SelectItem value="30">30 dager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notat (valgfritt)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
              <Button onClick={generate} className="bg-red-900 hover:bg-red-800" disabled={chosenIds.length === 0} data-testid="generate-invoice-btn">
                Generer faktura (PDF)
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="font-bold">Faktura {generated.invoice_number} opprettet</div>
              <div className="text-sm text-slate-600 mt-1">Beløp: <strong>{nok(generated.total)}</strong> · KID: <span className="font-mono">{generated.kid}</span></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={download} className="flex-1 bg-red-900 hover:bg-red-800" data-testid="download-invoice-btn"><Download className="h-4 w-4 mr-2" />Last ned PDF</Button>
            </div>
            <div className="border border-slate-200 rounded-md p-3 space-y-2">
              <Label>Send faktura på e-post</Label>
              <div className="flex gap-2">
                <Input type="email" placeholder="mottaker@eksempel.no" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="invoice-email-input" />
                <Button onClick={sendEmail} variant="outline" data-testid="send-invoice-btn"><Mail className="h-4 w-4 mr-1" />Send</Button>
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Lukk</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
