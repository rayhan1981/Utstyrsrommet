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
import { ShoppingCart, Plus, FileText, Trash2, Download, Send, Package } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./Leverandorer";

export default function Bestillinger() {
  const [schemas, setSchemas] = useState([]);
  const [orders, setOrders] = useState([]);
  const [teams, setTeams] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ team_id: "", season: "" });
  const [stockOpen, setStockOpen] = useState(false);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = async () => {
    const [a, b, c, d, e] = await Promise.all([
      api.get("/behovsskjema"), api.get("/orders"),
      api.get("/teams"), api.get("/suppliers"),
      api.get("/needs/seasons"),
    ]);
    setSchemas(a.data); setOrders(b.data); setTeams(c.data); setSuppliers(d.data);
    setSeasons(e.data.seasons);
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
    const email = prompt(`Send til hvilken e-post? (lagleders adresse)`);
    if (!email) return;
    try {
      await api.put(`/behovsskjema/${schema.id}`, { status: "sendt", sent_at: new Date().toISOString(), sent_to: email });
      toast.success("Markert som sendt. (MERK: Faktisk e-postutsending er ikke integrert ennå – manuell videresending kreves.)");
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delSchema = async (schema) => {
    if (!window.confirm(`Slette behovsskjema ${schema.po_number}? Hvis bestillinger finnes blir det arkivert.`)) return;
    try { const { data } = await api.delete(`/behovsskjema/${schema.id}`);
      toast.success(data.archived ? "Arkivert (har bestillinger)" : "Slettet"); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
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
                      <Button size="sm" variant="outline" onClick={() => downloadTemplate(s)} title="Last ned Excel-mal"><Download className="h-3 w-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => markSent(s)} className="ml-1" title="Marker sendt"><Send className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => delSchema(s)} className="ml-1"><Trash2 className="h-3 w-3 text-red-600" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="bestillinger" className="pt-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setStockOpen(true)} variant="outline" data-testid="new-stock-order-btn"><Package className="h-4 w-4 mr-1" />Bestill lagervarer</Button>
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
                      <Button size="sm" variant="ghost" onClick={() => delOrder(o)}><Trash2 className="h-3 w-3 text-red-600" /></Button>
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
    </div>
  );
}
