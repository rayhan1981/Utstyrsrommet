import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Plus, FileText, Trash2, Download, Send, Package, Bell, FileDown, Pencil, Mail } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./Leverandorer";
import OrderDialog from "@/components/OrderDialog";
import StockOrderDialog from "@/components/StockOrderDialog";

export default function Bestillinger() {
  const [schemas, setSchemas] = useState([]);
  const [orders, setOrders] = useState([]);
  const [teams, setTeams] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ team_id: "", season: "" });
  const [stockOpen, setStockOpen] = useState(false);
  const [orderDialog, setOrderDialog] = useState(null);
  const [notifyFor, setNotifyFor] = useState(null);
  const [notifyChannel, setNotifyChannel] = useState("both");
  const [notifyMsg, setNotifyMsg] = useState("");
  const [editSchema, setEditSchema] = useState(null);
  const [sendSchemaFor, setSendSchemaFor] = useState(null);
  const [sendForm, setSendForm] = useState({ recipient_email: "", recipient_name: "", message: "" });
  const [sendOrderFor, setSendOrderFor] = useState(null);
  const [sendOrderForm, setSendOrderForm] = useState({ to: "", cc: "", subject: "", message: "" });
  const [items, setItems] = useState([]);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = async () => {
    const [a, b, c, d, e, f] = await Promise.all([
      api.get("/behovsskjema"), api.get("/orders"),
      api.get("/teams"), api.get("/suppliers"),
      api.get("/needs/seasons"), api.get("/items"),
    ]);
    setSchemas(a.data); setOrders(b.data); setTeams(c.data); setSuppliers(d.data);
    setSeasons(e.data.seasons); setItems(f.data);
  };
  useEffect(() => { load(); }, []);

  const createSchema = async () => {
    if (!newForm.team_id || !newForm.season) { toast.error("Velg lag og sesong"); return; }
    try {
      const { data } = await api.post("/behovsskjema", newForm);
      toast.success(`Behovsskjema opprettet – nummer ${data.po_number}`);
      setNewOpen(false); setNewForm({ team_id: "", season: "" });
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const downloadTemplate = (schema) => {
    const token = localStorage.getItem("utr_token");
    fetch(`${BASE}/api/teams/${schema.team_id}/needs/template`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob()).then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a"); a.href = u; a.download = `behov_${schema.po_number}_${schema.team_name}.xlsx`; a.click();
        URL.revokeObjectURL(u);
      });
  };

  const markSent = async (schema) => {
    setSendSchemaFor(schema);
    setSendForm({
      recipient_email: schema.recipient_email || schema.sent_to || "",
      recipient_name: schema.recipient_name || "",
      message: schema.message || "",
    });
  };

  const sendSchemaEmail = async () => {
    if (!sendForm.recipient_email) { toast.error("Angi mottakers e-post"); return; }
    try {
      const { data } = await api.post(`/behovsskjema/${sendSchemaFor.id}/send`, sendForm);
      toast.success(`Skjema sendt til ${data.sent_to}`);
      setSendSchemaFor(null); load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    }
  };

  const quickSendSchema = async (schema) => {
    const to = schema.recipient_email || schema.sent_to || window.prompt(`Send behovsskjema ${schema.po_number} til hvilken e-post?`, "");
    if (!to || !to.trim()) return;
    try {
      const { data } = await api.post(`/behovsskjema/${schema.id}/send`, {
        recipient_email: to.trim(),
        recipient_name: schema.recipient_name || "",
      });
      toast.success(`Skjema sendt til ${data.sent_to} med Excel-vedlegg`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const openEditSchema = (schema) => {
    setEditSchema({
      ...schema,
      recipient_name: schema.recipient_name || "",
      recipient_email: schema.recipient_email || schema.sent_to || "",
      message: schema.message || "",
    });
  };

  const saveEditSchema = async () => {
    try {
      await api.put(`/behovsskjema/${editSchema.id}`, {
        recipient_name: editSchema.recipient_name,
        recipient_email: editSchema.recipient_email,
        message: editSchema.message,
      });
      toast.success("Lagret"); setEditSchema(null); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delSchema = async (schema) => {
    if (!window.confirm(`Slette behovsskjema ${schema.po_number}? Hvis bestillinger finnes blir det arkivert.`)) return;
    try { const { data } = await api.delete(`/behovsskjema/${schema.id}`);
      toast.success(data.archived ? "Arkivert (har bestillinger)" : "Slettet"); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const dlOrderPdf = async (o) => {
    const token = localStorage.getItem("utr_token");
    const r = await fetch(`${BASE}/api/orders/${o.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { toast.error("Kunne ikke generere PDF"); return; }
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = `bestilling_${o.po_number}.pdf`; a.click();
    URL.revokeObjectURL(u);
  };

  const openSendOrder = (o) => {
    const sup = suppliers.find((s) => s.id === o.supplier_id);
    setSendOrderFor(o);
    setSendOrderForm({
      to: sup?.email || "",
      cc: "",
      subject: `Bestilling ${o.po_number}`,
      message: "",
    });
  };

  const sendOrderEmail = async () => {
    if (!sendOrderForm.to) { toast.error("Angi mottakers e-post"); return; }
    try {
      const payload = { to: sendOrderForm.to };
      if (sendOrderForm.cc) payload.cc = sendOrderForm.cc;
      if (sendOrderForm.subject) payload.subject = sendOrderForm.subject;
      if (sendOrderForm.message) payload.message = sendOrderForm.message;
      const { data } = await api.post(`/orders/${sendOrderFor.id}/send`, payload);
      toast.success(`Bestilling sendt til ${data.sent_to}`);
      setSendOrderFor(null); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const openNotify = (o) => {
    setNotifyFor(o);
    setNotifyChannel("both");
    setNotifyMsg("");
  };

  const sendNotify = async () => {
    try {
      const { data } = await api.post(`/orders/${notifyFor.id}/notify-lagleder`,
        { channel: notifyChannel, message: notifyMsg || null });
      if (data.ok) {
        toast.success("Lagleder varslet!");
        setNotifyFor(null); load();
      } else {
        const errs = (data.log || []).filter((x) => !x.ok).map((x) => `${x.channel}: ${x.error}`).join("; ");
        toast.error(`Varsling feilet: ${errs || "ukjent"}`);
      }
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const canNotify = (o) => {
    if (o.is_stock_order || !o.team_id) return false;
    const lines = o.lines || [];
    const total = lines.reduce((a, l) => a + (l.quantity || 0), 0);
    const recv = lines.reduce((a, l) => a + (l.received_quantity || 0), 0);
    return total > 0 && recv >= total;
  };

  const delOrder = async (o) => {
    if (!window.confirm(`Arkivere bestilling ${o.po_number}?`)) return;
    try {
      await api.post(`/orders/${o.id}/manual-status`, { status: "arkivert", reason: "Slettet via UI" });
      toast.success("Arkivert"); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  return (
    <div className="space-y-5" data-testid="bestillinger-page">
      <div>
        <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><ShoppingCart className="h-7 w-7 text-red-700" />Bestillinger</h1>
        <p className="text-slate-600 text-sm mt-1">Behovsskjemaer, leverandørbestillinger og lagerbestillinger</p>
      </div>

      <Tabs defaultValue="skjema">
        <TabsList>
          <TabsTrigger value="skjema" data-testid="tab-skjema">Behovsskjemaer</TabsTrigger>
          <TabsTrigger value="bestillinger" data-testid="tab-ordre">Bestillinger</TabsTrigger>
        </TabsList>

        <TabsContent value="skjema" className="pt-4 space-y-3">
          <div className="flex gap-2">
            <Button onClick={() => setNewOpen(true)} className="bg-red-700 hover:bg-red-800" data-testid="new-schema-btn"><Plus className="h-4 w-4 mr-1" />Opprett behovsskjema</Button>
          </div>
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Innkjøpsnr</TableHead><TableHead>Lag</TableHead><TableHead>Årsklasse</TableHead><TableHead>Sesong</TableHead><TableHead>Opprettet</TableHead><TableHead>Status</TableHead><TableHead>Sendt</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {schemas.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-6">Ingen behovsskjemaer</TableCell></TableRow>}
                {schemas.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono font-semibold">{s.po_number}</TableCell>
                    <TableCell>{s.team_name}</TableCell>
                    <TableCell className="text-xs">{s.age_class}</TableCell>
                    <TableCell>{s.season}</TableCell>
                    <TableCell className="text-xs">{new Date(s.created_at).toLocaleDateString("nb-NO")}</TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="text-xs">{s.sent_at ? new Date(s.sent_at).toLocaleDateString("nb-NO") : "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                        <Button size="sm" variant="outline" onClick={() => openEditSchema(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5" data-testid={`edit-schema-${s.po_number}`}>
                          <Pencil className="h-3 w-3" /><span className="text-[9px]">Rediger</span>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadTemplate(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                          <Download className="h-3 w-3" /><span className="text-[9px]">Last ned</span>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => quickSendSchema(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 bg-sky-50 border-sky-300 text-sky-800" data-testid={`send-schema-${s.po_number}`}>
                          <Mail className="h-3 w-3" /><span className="text-[9px]">Send e-post</span>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setOrderDialog(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 bg-emerald-50 border-emerald-300 text-emerald-800" data-testid={`order-from-schema-${s.po_number}`}>
                          <ShoppingCart className="h-3 w-3" /><span className="text-[9px]">Bestill</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => delSchema(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                          <Trash2 className="h-3 w-3 text-red-600" /><span className="text-[9px] text-red-600">Slett</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="bestillinger" className="pt-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setStockOpen(true)} className="bg-red-700 hover:bg-red-800" data-testid="new-stock-order-btn"><Plus className="h-4 w-4 mr-1" />Opprett ny lagerordre</Button>
          </div>
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Innkjøpsnr</TableHead><TableHead>Lag</TableHead><TableHead>Leverandør</TableHead><TableHead>Linjer</TableHead><TableHead className="text-right">Beløp</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {orders.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-6">Ingen bestillinger</TableCell></TableRow>}
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono font-semibold">{o.po_number}</TableCell>
                    <TableCell className="text-xs">{o.is_stock_order ? <span className="font-semibold text-purple-700">Lager</span> : `${o.team_name} (${o.season})`}</TableCell>
                    <TableCell>{o.supplier_name}</TableCell>
                    <TableCell>{(o.lines || []).length}</TableCell>
                    <TableCell className="text-right">{nok(o.total_amount)}</TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => dlOrderPdf(o)} title="Last ned PDF"><FileDown className="h-3 w-3" /></Button>
                      {!o.is_stock_order || o.supplier_id ? (
                        <Button size="sm" variant="outline" onClick={() => openSendOrder(o)} className="ml-1 bg-sky-50 border-sky-300 text-sky-800" title="Send bestilling på e-post (PDF vedlagt)" data-testid={`send-order-${o.po_number}`}><Mail className="h-3 w-3" /></Button>
                      ) : null}
                      {canNotify(o) && !o.ready_for_pickup_notified && (
                        <Button size="sm" variant="outline" onClick={() => openNotify(o)} className="ml-1 bg-emerald-50 border-emerald-300 text-emerald-800" title="Varsle lagleder" data-testid={`notify-${o.po_number}`}><Bell className="h-3 w-3" /></Button>
                      )}
                      {o.ready_for_pickup_notified && <span className="ml-1 text-xs text-emerald-700 font-semibold">✓ Varslet</span>}
                      {o.sent_at && <span className="ml-1 text-[10px] text-slate-500">Sendt {new Date(o.sent_at).toLocaleDateString("nb-NO")}</span>}
                      <Button size="sm" variant="ghost" onClick={() => delOrder(o)} className="ml-1"><Trash2 className="h-3 w-3 text-red-600" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="text-xs text-slate-500">💡 Fullstendig bestillingsflyt (velg leverandør + varelinjer + PDF-generering + e-post) kommer i neste iterasjon. Bruk «Marker sendt» på behovsskjema inntil videre.</p>
        </TabsContent>
      </Tabs>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nytt behovsskjema</DialogTitle><DialogDescription>Innkjøpsnummer genereres automatisk</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Lag</Label>
              <Select value={newForm.team_id} onValueChange={(v) => setNewForm({ ...newForm, team_id: v })}>
                <SelectTrigger data-testid="new-schema-team"><SelectValue placeholder="Velg lag" /></SelectTrigger>
                <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name} ({t.age_class})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Sesong</Label>
              <Select value={newForm.season} onValueChange={(v) => setNewForm({ ...newForm, season: v })}>
                <SelectTrigger data-testid="new-schema-season"><SelectValue placeholder="Velg sesong" /></SelectTrigger>
                <SelectContent>{seasons.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Avbryt</Button>
            <Button onClick={createSchema} className="bg-red-700 hover:bg-red-800" data-testid="confirm-new-schema">Opprett</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OrderDialog open={!!orderDialog} onClose={() => setOrderDialog(null)} schema={orderDialog} suppliers={suppliers} onDone={() => load()} />
      <StockOrderDialog open={stockOpen} onClose={() => setStockOpen(false)} suppliers={suppliers} items={items} onDone={() => load()} />

      <Dialog open={!!editSchema} onOpenChange={(o) => !o && setEditSchema(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rediger behovsskjema {editSchema?.po_number}</DialogTitle><DialogDescription>Mottakerinformasjon for utsending</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Mottakers navn (lagleder)</Label><Input value={editSchema?.recipient_name || ""} onChange={(e) => setEditSchema({ ...editSchema, recipient_name: e.target.value })} /></div>
            <div><Label>Mottakers e-post *</Label><Input type="email" value={editSchema?.recipient_email || ""} onChange={(e) => setEditSchema({ ...editSchema, recipient_email: e.target.value })} data-testid="edit-schema-email" /></div>
            <div><Label>Melding i e-posten (valgfri)</Label>
              <textarea className="w-full border rounded-md p-2 min-h-[100px] text-sm" value={editSchema?.message || ""} onChange={(e) => setEditSchema({ ...editSchema, message: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSchema(null)}>Avbryt</Button>
            <Button onClick={saveEditSchema} className="bg-red-700 hover:bg-red-800" data-testid="save-edit-schema">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent></DialogContent>
      </Dialog>

      <Dialog open={!!sendOrderFor} onOpenChange={(o) => !o && setSendOrderFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send bestilling {sendOrderFor?.po_number} på e-post</DialogTitle>
            <DialogDescription>PDF-bestillingen vedlegges automatisk. Kopi sendes til din e-post.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Mottakers e-post *</Label><Input type="email" value={sendOrderForm.to} onChange={(e) => setSendOrderForm({ ...sendOrderForm, to: e.target.value })} placeholder="post@leverandor.no" data-testid="send-order-to" /></div>
            <div><Label>Kopi til (valgfri)</Label><Input type="email" value={sendOrderForm.cc} onChange={(e) => setSendOrderForm({ ...sendOrderForm, cc: e.target.value })} data-testid="send-order-cc" /></div>
            <div><Label>Emne</Label><Input value={sendOrderForm.subject} onChange={(e) => setSendOrderForm({ ...sendOrderForm, subject: e.target.value })} data-testid="send-order-subject" /></div>
            <div><Label>Melding (valgfri)</Label>
              <textarea className="w-full border rounded-md p-2 min-h-[100px] text-sm" value={sendOrderForm.message} onChange={(e) => setSendOrderForm({ ...sendOrderForm, message: e.target.value })} data-testid="send-order-message" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOrderFor(null)}>Avbryt</Button>
            <Button onClick={sendOrderEmail} className="bg-sky-700 hover:bg-sky-800 text-white" data-testid="confirm-send-order"><Mail className="h-4 w-4 mr-1" />Send bestilling</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!notifyFor} onOpenChange={(o) => !o && setNotifyFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Varsle lagleder – {notifyFor?.team_name}</DialogTitle>
            <DialogDescription>Alle varer er mottatt – klare for henting</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Kanal</Label>
              <Select value={notifyChannel} onValueChange={setNotifyChannel}>
                <SelectTrigger data-testid="notify-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">E-post + SMS</SelectItem>
                  <SelectItem value="email">Kun e-post</SelectItem>
                  <SelectItem value="sms">Kun SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Melding (valgfri – standardtekst brukes om tom)</Label>
              <textarea className="w-full border rounded-md p-2 min-h-[120px] text-sm" value={notifyMsg} onChange={(e) => setNotifyMsg(e.target.value)} placeholder="La stå tom for standardtekst" data-testid="notify-msg" />
            </div>
            <p className="text-xs text-slate-500">MERK: SMS krever at Twilio er konfigurert (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER). Hvis ikke, bruk «Kun e-post».</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyFor(null)}>Avbryt</Button>
            <Button onClick={sendNotify} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="confirm-notify-btn">
              <Bell className="h-4 w-4 mr-1" />Send varsel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
