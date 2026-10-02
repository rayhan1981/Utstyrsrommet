import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Search, LogIn, Pencil, Trash2, Settings, UserX, UserCheck, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";

const PLAN_OPTIONS = [
  { value: "free", label: "Gratis (manuell)" },
  { value: "basic", label: "Klubb Basic (399/mnd)" },
  { value: "pro", label: "Klubb Pro (599/mnd)" },
  { value: "deluxe", label: "Klubb Deluxe (999/mnd)" },
];

export default function OwnerPanel() {
  const { user, impersonate } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [cancelStripe, setCancelStripe] = useState(false);

  const refresh = () => api.get("/owner/customers").then((r) => setCustomers(r.data)).catch(() => {});

  useEffect(() => { if (user?.role === "platform_owner") refresh(); }, [user]);

  const search = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return setResults([]);
    try { const { data } = await api.get(`/owner/customers/search?q=${encodeURIComponent(q)}`); setResults(data); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const doImpersonate = async (c) => {
    try { await impersonate(c.id); toast.success(`Logget inn som ${c.club_name}`); nav("/app"); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const openDetail = async (c) => {
    try {
      const { data } = await api.get(`/owner/customers/${c.id}`);
      setDetail(data);
      setForm({
        club_name: data.customer.club_name || "",
        owner_name: data.customer.owner_name || "",
        owner_email: data.customer.owner_email || "",
        owner_phone: data.customer.owner_phone || "",
        plan: data.customer.plan || "basic",
        extra_user_seats: data.customer.extra_user_seats || 0,
        custom_price: data.customer.custom_price ?? "",
      });
      setCancelStripe(false);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const reloadDetail = async () => {
    if (!detail?.customer?.id) return;
    const { data } = await api.get(`/owner/customers/${detail.customer.id}`);
    setDetail(data);
  };

  const saveForm = async () => {
    try {
      const payload = { ...form };
      if (payload.custom_price === "" || payload.custom_price === null) delete payload.custom_price;
      else payload.custom_price = parseFloat(payload.custom_price);
      payload.extra_user_seats = parseInt(payload.extra_user_seats) || 0;
      if (cancelStripe) payload.cancel_stripe = true;
      await api.patch(`/owner/customers/${detail.customer.id}`, payload);
      toast.success("Kundeinfo oppdatert");
      await reloadDetail();
      await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const setStatus = async (status) => {
    if (!window.confirm(status === "inactive" ? "Deaktivere kundekontoen? Alle brukere mister innlogging." : "Aktivere kundekontoen igjen?")) return;
    try {
      await api.patch(`/owner/customers/${detail.customer.id}`, { status });
      toast.success(status === "inactive" ? "Kundekonto deaktivert" : "Kundekonto aktivert");
      await reloadDetail();
      await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const softDelete = async () => {
    if (!window.confirm("Slette hele kundekontoen? Kontoen markeres slettet og slettes permanent etter 12 måneder.")) return;
    try {
      await api.delete(`/owner/customers/${detail.customer.id}`);
      toast.success("Kundekonto slettet (soft delete)");
      setDetail(null);
      await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const restore = async () => {
    try {
      await api.post(`/owner/customers/${detail.customer.id}/restore`);
      toast.success("Kundekonto gjenopprettet");
      await reloadDetail();
      await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delUser = async (uid) => {
    if (!window.confirm("Slette denne brukeren?")) return;
    try { await api.delete(`/owner/customers/${detail.customer.id}/users/${uid}`); toast.success("Bruker slettet"); await reloadDetail(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  if (user?.role !== "platform_owner") return <div className="text-slate-500">Kun plattformeier</div>;

  const list = results.length ? results : customers;

  return (
    <div className="space-y-6" data-testid="owner-panel">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Eier-panel</h1>
        <p className="text-slate-600 text-sm mt-1">Søk, åpne eller endre kundekontoer</p>
      </div>

      <Card className="p-5">
        <form onSubmit={search} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Søk kundenr, klubbnavn, eier, epost, telefon…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="owner-search-input" />
          </div>
          <Button type="submit" className="bg-emerald-900 hover:bg-emerald-800" data-testid="owner-search-btn">Søk</Button>
          {results.length > 0 && <Button type="button" variant="outline" onClick={() => { setQ(""); setResults([]); }}>Nullstill</Button>}
        </form>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Kundenr</TableHead><TableHead>Klubb</TableHead><TableHead>Eier</TableHead><TableHead>E-post</TableHead>
            <TableHead>Pakke</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Handling</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {list.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-6">Ingen kunder.</TableCell></TableRow>}
            {list.map((c) => (
              <TableRow key={c.id} data-testid={`customer-row-${c.customer_number}`} className={c.deleted_at ? "opacity-50" : ""}>
                <TableCell className="font-mono font-semibold">{c.customer_number}</TableCell>
                <TableCell className="font-semibold">{c.club_name}{c.deleted_at && <span className="ml-2 text-xs text-red-700">(slettet)</span>}</TableCell>
                <TableCell>{c.owner_name}</TableCell>
                <TableCell className="text-sm">{c.owner_email}</TableCell>
                <TableCell><span className="text-xs font-semibold px-2 py-1 rounded bg-emerald-100 text-emerald-800 uppercase">{c.plan}</span></TableCell>
                <TableCell>
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${c.status === "inactive" ? "bg-red-100 text-red-800" : c.status === "trial" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {c.status}
                  </span>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => openDetail(c)} data-testid={`manage-${c.customer_number}`}><Settings className="h-3 w-3 mr-1" />Administrer</Button>
                  <Button size="sm" className="bg-emerald-900 hover:bg-emerald-800" onClick={() => doImpersonate(c)} data-testid={`impersonate-${c.customer_number}`}><LogIn className="h-3 w-3 mr-1" />Logg inn som</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Administrer: {detail?.customer?.club_name}</DialogTitle>
            <DialogDescription>Kundenr {detail?.customer?.customer_number} • Status: {detail?.customer?.status}{detail?.customer?.deleted_at && " • SLETTET"}</DialogDescription>
          </DialogHeader>
          {detail && form && (
            <Tabs defaultValue="info">
              <TabsList>
                <TabsTrigger value="info" data-testid="tab-cust-info">Konto & Pakke</TabsTrigger>
                <TabsTrigger value="users" data-testid="tab-cust-users">Brukere ({detail.counts.users})</TabsTrigger>
                <TabsTrigger value="data" data-testid="tab-cust-data">Data & Sletting</TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>Klubbnavn</Label><Input value={form.club_name} onChange={(e) => setForm({ ...form, club_name: e.target.value })} /></div>
                  <div><Label>Eier (navn)</Label><Input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></div>
                  <div><Label>E-post</Label><Input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} data-testid="cust-email-input" /></div>
                  <div><Label>Telefon</Label><Input value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} /></div>
                  <div>
                    <Label>Pakke</Label>
                    <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                      <SelectTrigger data-testid="cust-plan-select"><SelectValue /></SelectTrigger>
                      <SelectContent>{PLAN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Ekstra bruker-seter</Label><Input type="number" min="0" value={form.extra_user_seats} onChange={(e) => setForm({ ...form, extra_user_seats: e.target.value })} /></div>
                  <div className="sm:col-span-2">
                    <Label>Manuell månedspris (NOK) – overstyrer pakkepris</Label>
                    <Input type="number" min="0" step="1" placeholder="(bruker pakkepris)" value={form.custom_price} onChange={(e) => setForm({ ...form, custom_price: e.target.value })} />
                  </div>
                </div>

                {detail.customer.stripe_subscription_id && (
                  <label className="flex items-center gap-2 text-sm border border-amber-200 bg-amber-50 rounded-md p-3">
                    <Switch checked={cancelStripe} onCheckedChange={setCancelStripe} data-testid="cancel-stripe-switch" />
                    <span>Kanseller Stripe-abonnement samtidig (ved endring til Gratis eller nedgradering)</span>
                  </label>
                )}

                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button onClick={saveForm} className="bg-emerald-900 hover:bg-emerald-800" data-testid="save-cust-btn"><Pencil className="h-4 w-4 mr-1" />Lagre endringer</Button>
                  {detail.customer.status === "inactive" ? (
                    <Button variant="outline" onClick={() => setStatus("active")} data-testid="activate-cust-btn"><UserCheck className="h-4 w-4 mr-1" />Aktiver konto</Button>
                  ) : (
                    <Button variant="outline" className="text-red-700 border-red-300" onClick={() => setStatus("inactive")} data-testid="deactivate-cust-btn"><UserX className="h-4 w-4 mr-1" />Deaktiver konto</Button>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="users" className="pt-4">
                <Table>
                  <TableHeader><TableRow><TableHead>Navn</TableHead><TableHead>E-post</TableHead><TableHead>Rolle</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detail.users.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-4">Ingen brukere.</TableCell></TableRow>}
                    {detail.users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.name}</TableCell>
                        <TableCell className="text-sm">{u.email}</TableCell>
                        <TableCell>{u.role}</TableCell>
                        <TableCell>{u.active ? "Aktiv" : "Inaktiv"}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => delUser(u.id)} data-testid={`del-user-${u.id}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="data" className="pt-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card className="p-3 text-center"><div className="text-xs text-slate-500">Lag</div><div className="font-display text-2xl font-bold">{detail.counts.teams}</div></Card>
                  <Card className="p-3 text-center"><div className="text-xs text-slate-500">Personer</div><div className="font-display text-2xl font-bold">{detail.counts.people}</div></Card>
                  <Card className="p-3 text-center"><div className="text-xs text-slate-500">Varer</div><div className="font-display text-2xl font-bold">{detail.counts.items}</div></Card>
                  <Card className="p-3 text-center"><div className="text-xs text-slate-500">Utlån</div><div className="font-display text-2xl font-bold">{detail.counts.loans}</div></Card>
                </div>
                <p className="text-sm text-slate-600">For å slette enkeltpersoner eller varer: Bruk «Logg inn som» og håndter det direkte i kundens arbeidsområde.</p>
                <div className="border-t border-slate-200 pt-4">
                  <h4 className="font-semibold text-red-700 mb-2">Faresone</h4>
                  {detail.customer.deleted_at ? (
                    <div className="space-y-2">
                      <p className="text-sm text-slate-700">Slettet {new Date(detail.customer.deleted_at).toLocaleString("nb-NO")}. Permanent sletting: {new Date(detail.customer.purge_at).toLocaleDateString("nb-NO")}.</p>
                      <Button variant="outline" onClick={restore} data-testid="restore-cust-btn"><RotateCcw className="h-4 w-4 mr-1" />Gjenopprett konto</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="text-red-700 border-red-300" onClick={softDelete} data-testid="soft-delete-cust-btn"><Trash2 className="h-4 w-4 mr-1" />Slett kundekonto (soft delete)</Button>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
