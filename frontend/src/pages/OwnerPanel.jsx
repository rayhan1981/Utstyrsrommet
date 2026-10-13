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
import { Search, LogIn, Pencil, Trash2, Settings, UserX, UserCheck, RotateCcw, CalendarPlus, AlertTriangle, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import OwnerFieldOverride from "@/components/OwnerFieldOverride";

const PLAN_OPTIONS = [
  { value: "free", label: "Gratis (manuell)" },
  { value: "basic", label: "Klubb Basic (399/mnd)" },
  { value: "pro", label: "Klubb Pro (599/mnd)" },
  { value: "deluxe", label: "Klubb Premium (849/mnd)" },
];

function StatusBadge({ c }) {
  if (c.deleted_at) return <span className="inline-block ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-200 text-rose-900 uppercase">slettet</span>;
  const s = c.status;
  if (s === "inactive") return <span className="inline-block ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 uppercase">inaktiv</span>;
  if (s === "trial") return <span className="inline-block ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 uppercase">trial</span>;
  return <span className="inline-block ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">aktiv</span>;
}

export default function OwnerPanel() {
  const { user, impersonating, impersonate } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [cancelStripe, setCancelStripe] = useState(false);
  const [hardDelete, setHardDelete] = useState(null); // {customer, typed}

  const refresh = () => api.get("/owner/customers").then((r) => setCustomers(r.data)).catch(() => {});

  useEffect(() => { if (user?.role === "platform_owner") refresh(); }, [user]);

  // Automatisk oppslag av poststed via Kartverket (geonorge) når 4-sifret postnr er fylt inn i Administrer-dialogen
  useEffect(() => {
    const zip = (form?.postal_code || "").trim();
    if (!/^\d{4}$/.test(zip)) return;
    let cancelled = false;
    fetch(`https://ws.geonorge.kartverket.no/adresser/v1/sok?postnummer=${zip}&treffPerSide=1`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const sted = data?.adresser?.[0]?.poststed || "";
        if (sted) setForm((f) => f ? { ...f, city: sted } : f);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.postal_code]);

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
        postal_code: data.customer.postal_code || "",
        city: data.customer.city || "",
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

  const extendTrial = async (days) => {
    if (!detail?.customer?.id) return;
    if (!window.confirm(`Forleng prøveperioden med ${days} dager?`)) return;
    try {
      const { data } = await api.post(`/owner/customers/${detail.customer.id}/extend-trial`, { days });
      const newEnd = new Date(data.trial_end_date).toLocaleDateString("nb-NO");
      toast.success(`Prøveperioden forlenget til ${newEnd}`);
      await reloadDetail();
      await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delUser = async (uid) => {
    if (!window.confirm("Slette denne brukeren?")) return;
    try { await api.delete(`/owner/customers/${detail.customer.id}/users/${uid}`); toast.success("Bruker slettet"); await reloadDetail(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  // --- Impersonering for Avansert-fanen ---
  const impersonateForAdvanced = async () => {
    if (!detail?.customer) return;
    try {
      await impersonate(detail.customer.id);
      toast.success(`Impersonerer ${detail.customer.club_name}. Avansert-overstyring er nå aktiv.`);
      await reloadDetail();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  // --- Hard delete ---
  const confirmHardDelete = async () => {
    if (!hardDelete) return;
    const expected = (hardDelete.customer.club_name || "").trim();
    if ((hardDelete.typed || "").trim() !== expected) {
      toast.error("Bekreftelsesnavn stemmer ikke");
      return;
    }
    try {
      const { data } = await api.delete(`/owner/customers/${hardDelete.customer.id}/hard-delete`, { data: { confirm_name: hardDelete.typed } });
      const deleted = Object.entries(data.deleted || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
      toast.success(`${hardDelete.customer.club_name} PERMANENT slettet (${deleted})`);
      setHardDelete(null);
      setDetail(null);
      await refresh();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
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
          <Button type="submit" className="bg-red-900 hover:bg-red-800" data-testid="owner-search-btn">Søk</Button>
          {results.length > 0 && <Button type="button" variant="outline" onClick={() => { setQ(""); setResults([]); }}>Nullstill</Button>}
        </form>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Klubbnavn</TableHead>
            <TableHead className="w-28">Postnr</TableHead>
            <TableHead>Sted</TableHead>
            <TableHead className="w-40">Telefon</TableHead>
            <TableHead className="text-right">Handling</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {list.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-6">Ingen kunder.</TableCell></TableRow>}
            {list.map((c) => (
              <TableRow key={c.id} data-testid={`customer-row-${c.customer_number}`} className={c.deleted_at ? "opacity-50" : ""}>
                <TableCell className="font-semibold">
                  <span>{c.club_name || <span className="text-slate-400 italic">(uten navn)</span>}</span>
                  <StatusBadge c={c} />
                </TableCell>
                <TableCell className="font-mono text-sm">{c.postal_code || <span className="text-slate-400">–</span>}</TableCell>
                <TableCell className="text-sm">{c.city || <span className="text-slate-400">–</span>}</TableCell>
                <TableCell className="text-sm">{c.owner_phone || <span className="text-slate-400">–</span>}</TableCell>
                <TableCell className="text-right space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => openDetail(c)} data-testid={`manage-${c.customer_number}`}><Settings className="h-3 w-3 mr-1" />Administrer</Button>
                  <Button size="sm" className="bg-red-900 hover:bg-red-800" onClick={() => doImpersonate(c)} data-testid={`impersonate-${c.customer_number}`}><LogIn className="h-3 w-3 mr-1" />Logg inn som</Button>
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
                <TabsTrigger value="advanced" data-testid="tab-cust-advanced"><Crown className="h-3 w-3 mr-1 text-amber-600" />Avansert</TabsTrigger>
                <TabsTrigger value="data" data-testid="tab-cust-data">Data & Sletting</TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>Klubbnavn</Label><Input value={form.club_name} onChange={(e) => setForm({ ...form, club_name: e.target.value })} /></div>
                  <div><Label>Eier (navn)</Label><Input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></div>
                  <div><Label>E-post</Label><Input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} data-testid="cust-email-input" /></div>
                  <div><Label>Telefon</Label><Input value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} data-testid="cust-phone-input" /></div>
                  <div><Label>Postnummer</Label><Input inputMode="numeric" maxLength={4} value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value.replace(/\D/g, "").slice(0, 4) })} data-testid="cust-postal-input" /></div>
                  <div><Label>Sted</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="cust-city-input" /></div>
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

                {detail.customer.status === "trial" && (
                  <div className="border border-amber-200 bg-amber-50 rounded-md p-3 space-y-2" data-testid="extend-trial-section">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <CalendarPlus className="h-4 w-4" />
                      Forleng prøveperiode
                    </div>
                    <div className="text-xs text-slate-600">
                      Utløper: {(detail.customer.trial_end_date || detail.customer.trial_ends_at) ? new Date(detail.customer.trial_end_date || detail.customer.trial_ends_at).toLocaleString("nb-NO") : "–"}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => extendTrial(3)} data-testid="extend-trial-3">+3 dager</Button>
                      <Button size="sm" variant="outline" onClick={() => extendTrial(7)} data-testid="extend-trial-7">+7 dager</Button>
                      <Button size="sm" variant="outline" onClick={() => extendTrial(14)} data-testid="extend-trial-14">+14 dager</Button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button onClick={saveForm} className="bg-red-900 hover:bg-red-800" data-testid="save-cust-btn"><Pencil className="h-4 w-4 mr-1" />Lagre endringer</Button>
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

              <TabsContent value="advanced" className="pt-4 space-y-3">
                <Card className="p-3 border-amber-200 bg-amber-50/40">
                  <div className="flex items-start gap-3">
                    <Crown className="h-5 w-5 text-amber-700 mt-0.5" />
                    <div className="flex-1 text-sm">
                      <strong className="text-amber-900">Felt-overstyring (kun plattformeier)</strong>
                      <p className="text-slate-700 text-xs mt-1">
                        Overstyr felter som er skjult eller låst i vanlig admin-UI. Krever at du først impersonerer kunden.
                        {!impersonating && (
                          <Button size="sm" variant="outline" className="ml-2 h-6 text-xs" onClick={impersonateForAdvanced} data-testid="advanced-impersonate-btn">
                            <LogIn className="h-3 w-3 mr-1" />Start impersonering
                          </Button>
                        )}
                      </p>
                      {impersonating && (
                        <p className="text-green-700 text-xs mt-1">✓ Impersonering aktiv – blyant-ikoner er låst opp under.</p>
                      )}
                    </div>
                  </div>
                </Card>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="customer_number" value={detail.customer.customer_number} label="Kundenr" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="club_name" value={detail.customer.club_name} label="Klubbnavn" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="owner_name" value={detail.customer.owner_name} label="Eier (navn)" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="owner_email" value={detail.customer.owner_email} label="Eier-epost" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="owner_phone" value={detail.customer.owner_phone} label="Telefon" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="postal_code" value={detail.customer.postal_code} label="Postnummer" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="city" value={detail.customer.city} label="Sted" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="plan" value={detail.customer.plan} label="Pakke" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="status" value={detail.customer.status} label="Status" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="subscription_status" value={detail.customer.subscription_status} label="Subscription-status" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="selected_plan" value={detail.customer.selected_plan} label="Valgt pakke (etter trial)" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="trial_ends_at" value={detail.customer.trial_ends_at} label="Trial slutter (ISO)" type="datetime" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="trial_end_date" value={detail.customer.trial_end_date} label="Trial sluttdato" type="datetime" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="subscription_start_date" value={detail.customer.subscription_start_date} label="Abonnement startet" type="datetime" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="created_at" value={detail.customer.created_at} label="Opprettet (ISO)" type="datetime" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="stripe_customer_id" value={detail.customer.stripe_customer_id} label="Stripe customer ID" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="stripe_subscription_id" value={detail.customer.stripe_subscription_id} label="Stripe subscription ID" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="extra_user_seats" value={detail.customer.extra_user_seats} label="Ekstra brukerseter" type="number" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="custom_price" value={detail.customer.custom_price} label="Manuell månedspris" type="number" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="deleted_at" value={detail.customer.deleted_at} label="Slettet (ISO)" type="datetime" onSaved={reloadDetail} />
                  <OwnerFieldOverride collection="customers" documentId={detail.customer.id} field="purge_at" value={detail.customer.purge_at} label="Permanent purge (ISO)" type="datetime" onSaved={reloadDetail} />
                </div>
                <p className="text-xs text-slate-500 pt-3">
                  Tomt felt lagret = fjerner feltet. Datoer må være ISO-format (eks. <code>2026-11-15T00:00:00+00:00</code>). Endringer logges i activity_log med gammel og ny verdi.
                </p>
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
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="outline" onClick={restore} data-testid="restore-cust-btn"><RotateCcw className="h-4 w-4 mr-1" />Gjenopprett konto</Button>
                        <Button variant="outline" className="text-rose-700 border-rose-500 bg-rose-50 hover:bg-rose-100" onClick={() => setHardDelete({ customer: detail.customer, typed: "" })} data-testid="hard-delete-cust-btn">
                          <AlertTriangle className="h-4 w-4 mr-1" />Permanent slett
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" className="text-red-700 border-red-300" onClick={softDelete} data-testid="soft-delete-cust-btn"><Trash2 className="h-4 w-4 mr-1" />Slett kundekonto (soft delete)</Button>
                      <Button variant="outline" className="text-rose-700 border-rose-500 bg-rose-50 hover:bg-rose-100" onClick={() => setHardDelete({ customer: detail.customer, typed: "" })} data-testid="hard-delete-cust-btn">
                        <AlertTriangle className="h-4 w-4 mr-1" />Permanent slett (irreversibel)
                      </Button>
                    </div>
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

      {/* Hard delete bekreftelses-dialog */}
      <Dialog open={!!hardDelete} onOpenChange={(o) => !o && setHardDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-800">
              <AlertTriangle className="h-5 w-5" />Permanent sletting
            </DialogTitle>
            <DialogDescription>
              Dette er <strong>irreversibelt</strong>. Alle brukere, personer, lag, varer, utlån, bestillinger, fakturaer og lagsportal-kontoer for denne klubben slettes umiddelbart og kan ikke gjenopprettes.
            </DialogDescription>
          </DialogHeader>
          {hardDelete && (
            <div className="space-y-3">
              <div className="text-sm">
                Du er i ferd med å slette:
                <div className="font-mono bg-slate-100 rounded p-2 mt-1">{hardDelete.customer.club_name} ({hardDelete.customer.customer_number})</div>
              </div>
              <div>
                <Label>Skriv eksakt klubbnavn for å bekrefte</Label>
                <Input
                  autoFocus
                  value={hardDelete.typed}
                  onChange={(e) => setHardDelete({ ...hardDelete, typed: e.target.value })}
                  placeholder={hardDelete.customer.club_name}
                  data-testid="hard-delete-confirm-input"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHardDelete(null)}>Avbryt</Button>
            <Button
              onClick={confirmHardDelete}
              disabled={(hardDelete?.typed || "").trim() !== (hardDelete?.customer?.club_name || "").trim()}
              className="bg-rose-700 hover:bg-rose-800"
              data-testid="hard-delete-confirm-btn"
            >
              <AlertTriangle className="h-4 w-4 mr-1" />Slett permanent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
