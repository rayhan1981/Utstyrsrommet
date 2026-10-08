import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Plus, Trash2, Download, Mail, ShoppingCart, Pencil } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./Leverandorer";
import OrderDialog from "@/components/OrderDialog";

/**
 * Dedikert side for Behov og behovsmeldinger.
 * - Oppretter behovsskjema per lag/sesong (auto innkjøpsnr)
 * - Rediger mottaker/melding + Excel-mal
 * - Send e-post med Excel-vedlegg
 * - Opprett bestilling fra skjemaet
 */
export default function Behov() {
  const [schemas, setSchemas] = useState([]);
  const [teams, setTeams] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ team_id: "", season: "" });
  const [editSchema, setEditSchema] = useState(null);
  const [sendFor, setSendFor] = useState(null);
  const [sendForm, setSendForm] = useState({ recipient_email: "", recipient_name: "", message: "" });
  const [orderDialog, setOrderDialog] = useState(null);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = async () => {
    const [a, c, d, e] = await Promise.all([
      api.get("/behovsskjema"),
      api.get("/teams"),
      api.get("/suppliers"),
      api.get("/needs/seasons"),
    ]);
    setSchemas(a.data); setTeams(c.data); setSuppliers(d.data); setSeasons(e.data.seasons);
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

  const openEdit = (schema) => {
    setEditSchema({
      ...schema,
      recipient_name: schema.recipient_name || "",
      recipient_email: schema.recipient_email || schema.sent_to || "",
      message: schema.message || "",
    });
  };

  const saveEdit = async () => {
    try {
      await api.put(`/behovsskjema/${editSchema.id}`, {
        recipient_name: editSchema.recipient_name,
        recipient_email: editSchema.recipient_email,
        message: editSchema.message,
      });
      toast.success("Lagret"); setEditSchema(null); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const openSend = (schema) => {
    setSendFor(schema);
    setSendForm({
      recipient_email: schema.recipient_email || schema.sent_to || "",
      recipient_name: schema.recipient_name || "",
      message: schema.message || "",
    });
  };

  const sendEmail = async () => {
    if (!sendForm.recipient_email) { toast.error("Angi mottakers e-post"); return; }
    try {
      const { data } = await api.post(`/behovsskjema/${sendFor.id}/send`, sendForm);
      toast.success(`Skjema sendt til ${data.sent_to} med Excel-vedlegg`);
      setSendFor(null); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (schema) => {
    if (!window.confirm(`Slette behovsskjema ${schema.po_number}? Hvis bestillinger finnes blir det arkivert.`)) return;
    try {
      const { data } = await api.delete(`/behovsskjema/${schema.id}`);
      toast.success(data.archived ? "Arkivert (har bestillinger)" : "Slettet"); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-5" data-testid="behov-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-red-700" />Behov og behovsmeldinger
          </h1>
          <p className="text-slate-600 text-sm mt-1">
            Opprett behovsskjema per lag/sesong, send Excel-mal til lagleder og lag bestilling når behovet er registrert.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="bg-red-700 hover:bg-red-800" data-testid="new-behov-btn">
          <Plus className="h-4 w-4 mr-1" />Opprett behovsskjema
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Innkjøpsnr</TableHead>
              <TableHead>Lag</TableHead>
              <TableHead>Årsklasse</TableHead>
              <TableHead>Sesong</TableHead>
              <TableHead>Opprettet</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sendt</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schemas.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-6">Ingen behovsskjemaer – klikk «Opprett behovsskjema» for å begynne.</TableCell></TableRow>
            )}
            {schemas.map((s) => (
              <TableRow key={s.id} data-testid={`behov-row-${s.po_number}`}>
                <TableCell className="font-mono font-semibold">{s.po_number}</TableCell>
                <TableCell>{s.team_name}</TableCell>
                <TableCell className="text-xs">{s.age_class}</TableCell>
                <TableCell>{s.season}</TableCell>
                <TableCell className="text-xs">{new Date(s.created_at).toLocaleDateString("nb-NO")}</TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell className="text-xs">{s.sent_at ? new Date(s.sent_at).toLocaleDateString("nb-NO") : "-"}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                    <Button size="sm" variant="outline" onClick={() => openEdit(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5" data-testid={`edit-behov-${s.po_number}`}>
                      <Pencil className="h-3 w-3" /><span className="text-[9px]">Rediger</span>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadTemplate(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5" data-testid={`dl-behov-${s.po_number}`}>
                      <Download className="h-3 w-3" /><span className="text-[9px]">Last ned Excel</span>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openSend(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 bg-sky-50 border-sky-300 text-sky-800" data-testid={`send-behov-${s.po_number}`}>
                      <Mail className="h-3 w-3" /><span className="text-[9px]">Send e-post</span>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setOrderDialog(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 bg-emerald-50 border-emerald-300 text-emerald-800" data-testid={`order-from-behov-${s.po_number}`}>
                      <ShoppingCart className="h-3 w-3" /><span className="text-[9px]">Bestill</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del(s)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5" data-testid={`del-behov-${s.po_number}`}>
                      <Trash2 className="h-3 w-3 text-red-600" /><span className="text-[9px] text-red-600">Slett</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Opprett behovsskjema */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nytt behovsskjema</DialogTitle>
            <DialogDescription>Innkjøpsnummer genereres automatisk.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Lag</Label>
              <Select value={newForm.team_id} onValueChange={(v) => setNewForm({ ...newForm, team_id: v })}>
                <SelectTrigger data-testid="new-behov-team"><SelectValue placeholder="Velg lag" /></SelectTrigger>
                <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name} ({t.age_class})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sesong</Label>
              <Select value={newForm.season} onValueChange={(v) => setNewForm({ ...newForm, season: v })}>
                <SelectTrigger data-testid="new-behov-season"><SelectValue placeholder="Velg sesong" /></SelectTrigger>
                <SelectContent>{seasons.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Avbryt</Button>
            <Button onClick={createSchema} className="bg-red-700 hover:bg-red-800" data-testid="confirm-new-behov">Opprett</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rediger behovsskjema */}
      <Dialog open={!!editSchema} onOpenChange={(o) => !o && setEditSchema(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rediger behovsskjema {editSchema?.po_number}</DialogTitle>
            <DialogDescription>Mottakerinformasjon og standardmelding brukes neste gang skjemaet sendes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Mottakers navn (lagleder)</Label><Input value={editSchema?.recipient_name || ""} onChange={(e) => setEditSchema({ ...editSchema, recipient_name: e.target.value })} data-testid="edit-behov-name" /></div>
            <div><Label>Mottakers e-post</Label><Input type="email" value={editSchema?.recipient_email || ""} onChange={(e) => setEditSchema({ ...editSchema, recipient_email: e.target.value })} data-testid="edit-behov-email" /></div>
            <div>
              <Label>Standardmelding (valgfri)</Label>
              <textarea className="w-full border rounded-md p-2 min-h-[100px] text-sm" value={editSchema?.message || ""} onChange={(e) => setEditSchema({ ...editSchema, message: e.target.value })} data-testid="edit-behov-msg" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSchema(null)}>Avbryt</Button>
            <Button onClick={saveEdit} className="bg-red-700 hover:bg-red-800" data-testid="save-edit-behov">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send e-post m/ Excel-vedlegg */}
      <Dialog open={!!sendFor} onOpenChange={(o) => !o && setSendFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send behovsskjema {sendFor?.po_number} til lagleder</DialogTitle>
            <DialogDescription>Excel-malen vedlegges automatisk som ekte vedlegg. Du får kopi til din egen e-post.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Mottakers navn</Label><Input value={sendForm.recipient_name} onChange={(e) => setSendForm({ ...sendForm, recipient_name: e.target.value })} data-testid="send-behov-name" /></div>
            <div><Label>Mottakers e-post *</Label><Input type="email" value={sendForm.recipient_email} onChange={(e) => setSendForm({ ...sendForm, recipient_email: e.target.value })} placeholder="lagleder@klubben.no" data-testid="send-behov-to" /></div>
            <div>
              <Label>Melding (valgfri)</Label>
              <textarea className="w-full border rounded-md p-2 min-h-[100px] text-sm" value={sendForm.message} onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })} data-testid="send-behov-msg" />
            </div>
            <p className="text-xs text-slate-500">💡 Excel-malen (<code>behovsskjema_{sendFor?.po_number}_{sendFor?.team_name}.xlsx</code>) legges ved som ekte vedlegg i e-posten.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendFor(null)}>Avbryt</Button>
            <Button onClick={sendEmail} className="bg-sky-700 hover:bg-sky-800 text-white" data-testid="confirm-send-behov">
              <Mail className="h-4 w-4 mr-1" />Send med vedlegg
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OrderDialog open={!!orderDialog} onClose={() => setOrderDialog(null)} schema={orderDialog} suppliers={suppliers} onDone={() => load()} />
    </div>
  );
}
