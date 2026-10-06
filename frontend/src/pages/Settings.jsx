import React, { useEffect, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Upload, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function Settings() {
  const { user } = useAuth();
  const [clubs, setClubs] = useState([]);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", org_number: "", bank_account: "", kid_prefix: "" });

  const load = () => api.get("/clubs").then((r) => setClubs(r.data));
  useEffect(() => { load(); }, []);

  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, org_number: c.org_number || "", bank_account: c.bank_account || "", kid_prefix: c.kid_prefix || "" }); };

  const saveEdit = async () => {
    try {
      await api.put(`/clubs/${editing.id}`, {
        name: form.name, org_number: form.org_number,
        bank_account: form.bank_account, kid_prefix: form.kid_prefix,
        logo_url: editing.logo_url || "",
      });
      toast.success("Klubb oppdatert"); setEditing(null); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const create = async () => {
    if (!newName.trim()) return;
    try { await api.post("/clubs", { name: newName, org_number: "", logo_url: "" }); setNewName(""); toast.success("Klubb lagt til"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (c) => {
    if (!window.confirm(`Slette klubben "${c.name}"? Dette kan ikke angres.`)) return;
    try { await api.delete(`/clubs/${c.id}`); toast.success("Klubb slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const uploadLogo = async (clubId, file) => {
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post(`/clubs/${clubId}/logo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Logo oppdatert");
      setClubs((cs) => cs.map((c) => c.id === clubId ? { ...c, logo_url: data.logo_url } : c));
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Innstillinger</h1>
        <p className="text-slate-600 text-sm mt-1">Klubber, logoer og generelle innstillinger</p>
      </div>

      <Card className="p-5">
        <h3 className="font-display text-lg font-bold mb-3">Legg til ny klubb</h3>
        <div className="flex gap-2">
          <Input placeholder="Klubbnavn" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="new-club-name" />
          <Button onClick={create} className="bg-red-900 hover:bg-red-800" data-testid="create-club-btn"><Plus className="h-4 w-4 mr-2" />Opprett</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {clubs.length === 0 && <p className="text-sm text-slate-500 col-span-2">Ingen klubber opprettet.</p>}
        {clubs.map((c) => (
          <Card key={c.id} className="p-5" data-testid={`club-card-${c.id}`}>
            <div className="flex items-start gap-4">
              <div className="h-24 w-24 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                {c.logo_url ? <img src={c.logo_url} alt={c.name} className="h-full w-full object-contain" /> : <span className="text-xs text-slate-400">Logo</span>}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-display font-bold text-lg truncate">{c.name}</h4>
                <p className="text-xs text-slate-500 mt-0.5">Org.nr: {c.org_number || "ikke satt"}</p>
                <label className="inline-flex items-center gap-2 text-xs text-red-800 font-semibold mt-2 cursor-pointer hover:underline">
                  <Upload className="h-3 w-3" /> Last opp logo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(c.id, e.target.files[0])} />
                </label>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)} data-testid={`edit-club-${c.id}`}>
                    <Pencil className="h-3 w-3 mr-1" />Rediger
                  </Button>
                  {user?.role === "admin" && (
                    <Button size="sm" variant="outline" onClick={() => del(c)} data-testid={`del-club-${c.id}`} className="text-red-600 hover:text-red-700">
                      <Trash2 className="h-3 w-3 mr-1" />Slett
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rediger klubb</DialogTitle>
            <DialogDescription>Endre navn og organisasjonsnummer</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Klubbnavn</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="edit-club-name" /></div>
            <div><Label>Organisasjonsnummer</Label><Input value={form.org_number} onChange={(e) => setForm({ ...form, org_number: e.target.value })} data-testid="edit-club-org" /></div>
            <div><Label>Bankkontonummer (brukes på faktura)</Label><Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} placeholder="1234.56.78901" data-testid="edit-club-bank" /></div>
            <div><Label>KID-prefix (valgfritt)</Label><Input value={form.kid_prefix} onChange={(e) => setForm({ ...form, kid_prefix: e.target.value })} data-testid="edit-club-kid" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Avbryt</Button>
            <Button onClick={saveEdit} className="bg-red-900 hover:bg-red-800" data-testid="save-club-btn">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
