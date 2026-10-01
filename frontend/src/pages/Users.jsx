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
import { Plus, Mail, Trash2, Pencil, Shield } from "lucide-react";
import { toast } from "sonner";

const defaultPerms = (level = "read") => Object.fromEntries(MODULES.map((m) => [m.key, level]));

export default function Users() {
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", role: "user", permissions: defaultPerms("read"), active: true, password: "" });
  const [sendInvite, setSendInvite] = useState(true);

  const load = () => api.get("/users").then((r) => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditId(null); setSendInvite(true);
    setForm({ name: "", email: "", phone: "", address: "", role: "user", permissions: defaultPerms("read"), active: true, password: "" });
    setOpen(true);
  };
  const openEdit = (u) => {
    setEditId(u.id);
    setForm({ name: u.name, email: u.email, phone: u.phone || "", address: u.address || "", role: u.role, permissions: u.permissions || defaultPerms(), active: u.active, password: "" });
    setOpen(true);
  };

  const save = async () => {
    try {
      if (editId) {
        const payload = { name: form.name, phone: form.phone, address: form.address, role: form.role, permissions: form.permissions, active: form.active };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${editId}`, payload);
        toast.success("Oppdatert");
      } else {
        const payload = { name: form.name, email: form.email, phone: form.phone, address: form.address, role: form.role, permissions: form.permissions };
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
        <Button onClick={openNew} data-testid="new-user-btn" className="bg-emerald-900 hover:bg-emerald-800"><Plus className="h-4 w-4 mr-2" />Ny bruker</Button>
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Navn</TableHead><TableHead>E-post</TableHead><TableHead>Telefon</TableHead><TableHead>Rolle</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Handlinger</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                <TableCell className="font-semibold">{u.name} {u.is_super_admin && <Shield className="h-3 w-3 inline text-emerald-700 ml-1" />}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{u.phone || "-"}</TableCell>
                <TableCell><span className={`text-xs font-semibold px-2 py-1 rounded ${u.role === "admin" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{u.role === "admin" ? "Admin" : "Bruker"}</span></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} disabled={u.is_super_admin} />
                    <span className="text-xs text-slate-500">{u.active ? "Aktiv" : "Deaktivert"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" onClick={() => resend(u)} title="Send invitasjon på nytt"><Mail className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                  {!u.is_super_admin && <Button variant="ghost" size="icon" onClick={() => del(u)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
            <Button onClick={save} data-testid="save-user-btn" className="bg-emerald-900 hover:bg-emerald-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
