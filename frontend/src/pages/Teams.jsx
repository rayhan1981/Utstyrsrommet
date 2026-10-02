import React, { useEffect, useState } from "react";
import { api, formatError, TEAM_NAME_OPTIONS, YEARS_ENGAGED } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";

const EMPTY_TRAINER = { name: "", email: "", phone: "", years_engaged: "" };
const EMPTY_TEAM = {
  team_name: "", age_class: "", email: "",
  training_times: Array(7).fill(""),
  contact_person: "", key_responsible: "", key_serial: "",
  head_coach: { ...EMPTY_TRAINER }, team_manager: { ...EMPTY_TRAINER },
  trainer1: { ...EMPTY_TRAINER }, trainer2: { ...EMPTY_TRAINER },
  trainer3: { ...EMPTY_TRAINER }, trainer4: { ...EMPTY_TRAINER }, trainer5: { ...EMPTY_TRAINER },
};

function TrainerFields({ label, value, onChange }) {
  const v = value || EMPTY_TRAINER;
  return (
    <div className="border border-slate-200 rounded-md p-3 space-y-2">
      <div className="font-semibold text-sm text-emerald-900">{label}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input placeholder="Navn" value={v.name} onChange={(e) => onChange({ ...v, name: e.target.value })} />
        <Input placeholder="Telefon" value={v.phone} onChange={(e) => onChange({ ...v, phone: e.target.value })} />
        <Input placeholder="Epost" value={v.email} onChange={(e) => onChange({ ...v, email: e.target.value })} />
        <Select value={v.years_engaged} onValueChange={(x) => onChange({ ...v, years_engaged: x })}>
          <SelectTrigger><SelectValue placeholder="Antall år engasjert" /></SelectTrigger>
          <SelectContent>{YEARS_ENGAGED.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

export default function Teams() {
  const { hasPerm } = useAuth();
  const [teams, setTeams] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_TEAM);
  const [editId, setEditId] = useState(null);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = () => api.get("/teams").then((r) => setTeams(r.data));
  useEffect(() => { load(); }, []);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const openNew = () => { setEditId(null); setForm(EMPTY_TEAM); setOpen(true); };
  const openEdit = (t) => {
    setEditId(t.id);
    setForm({ ...EMPTY_TEAM, ...t, training_times: [...(t.training_times || []), ...Array(7).fill("")].slice(0, 7) });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = { ...form, training_times: form.training_times.filter((t) => t.trim()) };
      if (editId) await api.put(`/teams/${editId}`, payload);
      else await api.post("/teams", payload);
      toast.success("Lagret"); setOpen(false); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (id) => {
    if (!window.confirm("Slette dette laget?")) return;
    try { await api.delete(`/teams/${id}`); toast.success("Slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const exportTeam = (id, name) => {
    const token = localStorage.getItem("utr_token");
    const url = `${BASE}/api/export/team/${id}`;
    fetch(url, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob())
      .then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = `lag_${name}.xlsx`; a.click(); URL.revokeObjectURL(u);
      });
  };

  return (
    <div className="space-y-6" data-testid="teams-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Lag</h1>
          <p className="text-slate-600 text-sm mt-1">Administrer lag, trenere og lagledere</p>
        </div>
        {hasPerm("teams", "write") && (
          <Button onClick={openNew} data-testid="new-team-btn" className="bg-emerald-900 hover:bg-emerald-800">
            <Plus className="h-4 w-4 mr-2" /> Nytt lag
          </Button>
        )}
      </div>

      <Card className="p-3">
        <DataTable
          rows={teams}
          emptyLabel="Ingen lag registrert."
          searchPlaceholder="Søk lag, aldersklasse, trener…"
          columns={[
            { key: "team_name", label: "Lagsnavn", filter: "text", render: (t) => <span className="font-semibold">{t.team_name}</span> },
            { key: "age_class", label: "Aldersklasse", filter: "text" },
            { key: "contact_person", label: "Kontaktperson", filter: "text", render: (t) => t.contact_person || "-" },
            { key: "head_coach_name", label: "Hovedtrener", filter: "text", accessor: (t) => t.head_coach?.name || "", render: (t) => t.head_coach?.name || "-" },
            { key: "debt", label: "Skyldig", filter: "number", accessor: (t) => t.debt || 0, render: (t) => <span className={t.debt > 0 ? "text-red-700 font-semibold" : ""}>{nok(t.debt)}</span> },
          ]}
          actions={(t) => (
            <>
              <Button variant="ghost" size="icon" onClick={() => exportTeam(t.id, t.team_name)} data-testid={`export-team-${t.id}`}>
                <Download className="h-4 w-4" />
              </Button>
              {hasPerm("teams", "write") && (
                <Button variant="ghost" size="icon" onClick={() => openEdit(t)} data-testid={`edit-team-${t.id}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {hasPerm("teams", "admin") && (
                <Button variant="ghost" size="icon" onClick={() => del(t.id)} data-testid={`del-team-${t.id}`}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              )}
            </>
          )}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Rediger lag" : "Nytt lag"}</DialogTitle>
            <DialogDescription>Fyll ut lagets detaljer, kontaktpersoner og roller.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Lagsnavn</Label>
                <Select value={form.team_name} onValueChange={(v) => setForm({ ...form, team_name: v })}>
                  <SelectTrigger data-testid="team-name-select"><SelectValue placeholder="Velg lagsnavn" /></SelectTrigger>
                  <SelectContent>{TEAM_NAME_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Aldersklasse (f.eks. 2019)</Label>
                <Input value={form.age_class} onChange={(e) => setForm({ ...form, age_class: e.target.value })} />
              </div>
              <div>
                <Label>E-post til laget</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Kontaktperson</Label>
                <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div>
                <Label>Nøkkelansvarlig</Label>
                <Input value={form.key_responsible} onChange={(e) => setForm({ ...form, key_responsible: e.target.value })} />
              </div>
              <div>
                <Label>Serienummer på nøkkel</Label>
                <Input value={form.key_serial} onChange={(e) => setForm({ ...form, key_serial: e.target.value })} />
              </div>
            </div>

            <div>
              <Label>Treningstider (opptil 7 pr uke)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                {form.training_times.map((t, i) => (
                  <Input key={i} placeholder={`Treningstid ${i + 1} (f.eks. Mandag 17-19)`} value={t}
                    onChange={(e) => { const arr = [...form.training_times]; arr[i] = e.target.value; setForm({ ...form, training_times: arr }); }} />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <TrainerFields label="Hovedtrener" value={form.head_coach} onChange={(v) => setForm({ ...form, head_coach: v })} />
              <TrainerFields label="Lagleder" value={form.team_manager} onChange={(v) => setForm({ ...form, team_manager: v })} />
              {["trainer1","trainer2","trainer3","trainer4","trainer5"].map((k, idx) => (
                <TrainerFields key={k} label={`Trener ${idx+1}`} value={form[k]} onChange={(v) => setForm({ ...form, [k]: v })} />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} data-testid="save-team-btn" className="bg-emerald-900 hover:bg-emerald-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
