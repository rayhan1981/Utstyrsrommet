import React, { useEffect, useState } from "react";
import { api, formatError, MODULES, PERMS } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Plus, Mail, Trash2, Pencil, Shield, History } from "lucide-react";
import { toast } from "sonner";
import DataTable from "@/components/DataTable";

const defaultPerms = (level = "read") => Object.fromEntries(MODULES.map((m) => [m.key, level]));

const RESET_SECTIONS = [
  { key: "inventory", label: "Utstyr" },
  { key: "suppliers", label: "Leverandører" },
  { key: "teams", label: "Lag" },
  { key: "people", label: "Personer" },
  { key: "users", label: "Brukere" },
];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", role: "user", permissions: defaultPerms("read"), reset_permissions: [], can_view_login_history: false, active: true, password: "" });
  const [sendInvite, setSendInvite] = useState(true);
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);

  const load = () => api.get("/users").then((r) => setUsers(r.data));
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // refresh online status
    return () => clearInterval(t);
  }, []);

  const showHistory = async (u) => {
    try {
      const { data } = await api.get(`/users/${u.id}/login-history`);
      setHistory(data);
      setHistoryFor(u);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("nb-NO") : "-";

  const openNew = () => {
    setEditId(null); setSendInvite(true);
    setForm({ name: "", email: "", phone: "", address: "", role: "user", permissions: defaultPerms("read"), reset_permissions: [], can_view_login_history: false, active: true, password: "" });
    setOpen(true);
  };
  const openEdit = (u) => {
    setEditId(u.id);
    setForm({ name: u.name, email: u.email, phone: u.phone || "", address: u.address || "", role: u.role, permissions: u.permissions || defaultPerms(), reset_permissions: u.reset_permissions || [], can_view_login_history: !!u.can_view_login_history, active: u.active, password: "" });
    setOpen(true);
  };

  const save = async () => {
    try {
      if (editId) {
        const payload = { name: form.name, phone: form.phone, address: form.address, role: form.role, permissions: form.permissions, reset_permissions: form.role === "admin" ? [] : form.reset_permissions, can_view_login_history: form.role === "admin" ? true : form.can_view_login_history, active: form.active };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${editId}`, payload);
        toast.success("Oppdatert");
      } else {
        const payload = { name: form.name, email: form.email, phone: form.phone, address: form.address, role: form.role, permissions: form.permissions, reset_permissions: form.role === "admin" ? [] : form.reset_permissions, can_view_login_history: form.role === "admin" ? true : form.can_view_login_history };
        if (!sendInvite && form.password) payload.password = form.password;
        const { data } = await api.post("/users", payload);
        toast.success(data.invitation_sent ? "Bruker opprettet - invitasjon sendt på e-post" : "Bruker opprettet");
        if (data.invitation_link) console.log("Invitasjonslenke:", data.invitation_link);
      }
      setOpen(false); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (u) => {
    if (!window.confirm(`Slette brukeren ${u.name}?`)) return;
    try { await api.delete(`/users/${u.id}`); toast.success("Slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const toggleActive = async (u) => {
    try { await api.put(`/users/${u.id}`, { active: !u.active }); toast.success(u.active ? "Deaktivert" : "Aktivert"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const resend = async (u) => {
    try { const { data } = await api.post(`/users/${u.id}/resend-invitation`); toast.success("Invitasjon sendt på nytt"); if (data.invitation_link) console.log("Invitasjon:", data.invitation_link); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6" data-testid="users-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Brukeradministrasjon</h1>
          <p className="text-slate-600 text-sm mt-1">Opprett brukere og tildel rettigheter per modul</p>
        </div>
        <Button onClick={openNew} data-testid="new-user-btn" className="bg-red-900 hover:bg-red-800"><Plus className="h-4 w-4 mr-2" />Ny bruker</Button>
      </div>

      <Card className="p-3">
        <DataTable
          rows={users}
          emptyLabel="Ingen brukere."
          searchPlaceholder="Søk navn, epost, telefon…"
          columns={[
            { key: "name", label: "Navn", filter: "text", render: (u) => (
              <span className="font-semibold flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${u.online ? "bg-red-500" : "bg-slate-300"}`} title={u.online ? "Pålogget" : "Avlogget"}></span>
                {u.name} {u.is_super_admin && <Shield className="h-3 w-3 inline text-red-700" />}
              </span>
            ) },
            { key: "email", label: "E-post", filter: "text" },
            { key: "online", label: "Pålogget", filter: "boolean", accessor: (u) => !!u.online, render: (u) => (
              <span className={`text-xs font-semibold px-2 py-1 rounded ${u.online ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-600"}`}>{u.online ? "Pålogget" : "Avlogget"}</span>
            ) },
            { key: "last_login", label: "Siste pålogging", filter: "text", render: (u) => <span className="text-xs">{fmtDate(u.last_login)}</span> },
            { key: "role", label: "Rolle", filter: "select",
              options: [{value:"admin",label:"Admin"},{value:"user",label:"Bruker"}],
              render: (u) => <span className={`text-xs font-semibold px-2 py-1 rounded ${u.role === "admin" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>{u.role === "admin" ? "Admin" : "Bruker"}</span> },
            { key: "active", label: "Status", filter: "boolean", render: (u) => (
              <div className="flex items-center gap-2">
                <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} disabled={u.is_super_admin} />
                <span className="text-xs text-slate-500">{u.active ? "Aktiv" : "Deaktivert"}</span>
              </div>
            ) },
          ]}
          actions={(u) => (
            <>
              <Button variant="ghost" size="icon" onClick={() => showHistory(u)} title="Påloggingshistorikk" data-testid={`history-btn-${u.id}`}><History className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => resend(u)} title="Send invitasjon på nytt"><Mail className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
              {!u.is_super_admin && <Button variant="ghost" size="icon" onClick={() => del(u)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
            </>
          )}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Rediger bruker" : "Ny bruker"}</DialogTitle>
            <DialogDescription>Fyll inn navn, kontakt, rolle og rettigheter.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Fullt navn</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name" /></div>
              <div><Label>E-post</Label><Input type="email" disabled={!!editId} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email" /></div>
              <div><Label>Telefon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Adresse</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div>
                <Label>Rolle</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v, permissions: v === "admin" ? defaultPerms("admin") : defaultPerms("read") })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="user">Bruker</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
                </Select>
              </div>
            </div>

            {form.role !== "admin" && (
              <>
                <div>
                  <Label>Rettigheter per modul</Label>
                  <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
                    {MODULES.map((m) => (
                      <div key={m.key} className="flex items-center justify-between p-2.5">
                        <span className="text-sm font-medium">{m.label}</span>
                        <Select value={form.permissions[m.key] || "none"} onValueChange={(v) => setForm({ ...form, permissions: { ...form.permissions, [m.key]: v } })}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>{PERMS.map((p) => <SelectItem key={p} value={p}>{p === "none" ? "Ingen" : p === "read" ? "Lesetilgang" : p === "write" ? "Skrivetilgang" : "Admin"}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="flex items-center gap-1 text-red-800"><Shield className="h-3 w-3" />Nullstillings-rettigheter (farlige handlinger)</Label>
                  <p className="text-[11px] text-slate-500 mb-2">Velg hvilke seksjoner brukeren kan slette/nullstille alle data for. Krever passordbekreftelse ved utførelse. Vanlige brukere kan maks nullstille 1 gang pr måned, admin 1 gang pr uke.</p>
                  <div className="border border-red-200 rounded-md p-2 bg-red-50/40 grid grid-cols-2 gap-1">
                    {RESET_SECTIONS.map((s) => {
                      const checked = (form.reset_permissions || []).includes(s.key);
                      return (
                        <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 hover:bg-white/60 rounded">
                          <input type="checkbox" checked={checked}
                                 onChange={(e) => {
                                   const cur = new Set(form.reset_permissions || []);
                                   if (e.target.checked) cur.add(s.key); else cur.delete(s.key);
                                   setForm({ ...form, reset_permissions: Array.from(cur) });
                                 }}
                                 data-testid={`reset-perm-${s.key}`} />
                          <span>{s.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label className="flex items-center gap-1"><History className="h-3 w-3" />Påloggingshistorikk</Label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer border border-slate-200 rounded-md p-2.5 mt-1">
                    <Switch checked={!!form.can_view_login_history}
                            onCheckedChange={(v) => setForm({ ...form, can_view_login_history: v })}
                            data-testid="can-view-login-history" />
                    <span className="flex-1">Kan se andres påloggingshistorikk</span>
                  </label>
                  <p className="text-[11px] text-slate-500 mt-1">Som standard kan vanlige brukere kun se sin egen historikk. Slå på for å gi tilgang til å se andre brukeres pålogginger.</p>
                </div>
              </>
            )}

            {!editId && (
              <div className="border border-slate-200 rounded-md p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={sendInvite} onCheckedChange={setSendInvite} />
                  Send invitasjons-epost (bruker setter eget passord)
                </label>
                {!sendInvite && (
                  <div><Label>Sett passord manuelt</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                )}
              </div>
            )}

            {editId && (
              <div><Label>Nytt passord (valgfritt)</Label><Input type="password" placeholder="La stå tomt for å beholde eksisterende" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} data-testid="save-user-btn" className="bg-red-900 hover:bg-red-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Påloggingshistorikk: {historyFor?.name}</DialogTitle>
            <DialogDescription>{historyFor?.email} - {history.length} pålogginger</DialogDescription>
          </DialogHeader>
          <div className="border border-slate-200 rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Pålogget</TableHead><TableHead>Avlogget</TableHead><TableHead>Varighet</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-slate-500 py-4">Ingen pålogginger registrert.</TableCell></TableRow>}
                {history.map((h) => {
                  const start = h.logged_in_at ? new Date(h.logged_in_at) : null;
                  const end = h.logged_out_at ? new Date(h.logged_out_at) : null;
                  let dur = "-";
                  if (start && end) {
                    const mins = Math.round((end - start) / 60000);
                    dur = mins >= 60 ? `${Math.floor(mins/60)}t ${mins%60}min` : `${mins} min`;
                  } else if (start && !end) dur = "Fortsatt aktiv";
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs">{fmtDate(h.logged_in_at)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(h.logged_out_at)}</TableCell>
                      <TableCell className="text-xs">{dur}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setHistoryFor(null)}>Lukk</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
