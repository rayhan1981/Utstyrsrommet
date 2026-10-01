import React, { useEffect, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Upload, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function Settings() {
  const { user } = useAuth();
  const [clubs, setClubs] = useState([]);
  const [editing, setEditing] = useState(null);
  const [newName, setNewName] = useState("");
  const fileRef = useRef(null);

  const load = () => api.get("/clubs").then((r) => setClubs(r.data));
  useEffect(() => { load(); }, []);

  const save = async (c) => {
    try { await api.put(`/clubs/${c.id}`, { name: c.name, org_number: c.org_number || "", logo_url: c.logo_url || "" }); toast.success("Lagret"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const create = async () => {
    if (!newName.trim()) return;
    try { await api.post("/clubs", { name: newName, org_number: "", logo_url: "" }); setNewName(""); toast.success("Klubb lagt til"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (c) => {
    if (!window.confirm(`Slette klubben ${c.name}?`)) return;
    try { await api.delete(`/clubs/${c.id}`); toast.success("Slettet"); load(); }
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
          <Button onClick={create} className="bg-emerald-900 hover:bg-emerald-800" data-testid="create-club-btn"><Plus className="h-4 w-4 mr-2" />Opprett</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {clubs.map((c) => (
          <Card key={c.id} className="p-5 space-y-3" data-testid={`club-card-${c.id}`}>
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                {c.logo_url ? <img src={c.logo_url} alt={c.name} className="h-full w-full object-contain" /> : <span className="text-xs text-slate-400">Logo</span>}
              </div>
              <div className="flex-1">
                <h4 className="font-display font-bold text-lg">{c.name}</h4>
                <p className="text-xs text-slate-500">Org.nr: {c.org_number || "ikke satt"}</p>
                <label className="inline-flex items-center gap-2 text-xs text-emerald-800 font-semibold mt-1 cursor-pointer hover:underline">
                  <Upload className="h-3 w-3" /> Last opp logo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(c.id, e.target.files[0])} />
                </label>
              </div>
              {user?.role === "admin" && (
                <Button variant="ghost" size="icon" onClick={() => del(c)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
              )}
            </div>
            <div className="space-y-2">
              <div><Label>Klubbnavn</Label><Input value={c.name} onChange={(e) => setClubs(clubs.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))} /></div>
              <div><Label>Organisasjonsnummer</Label><Input value={c.org_number || ""} onChange={(e) => setClubs(clubs.map((x) => x.id === c.id ? { ...x, org_number: e.target.value } : x))} /></div>
              <Button onClick={() => save(c)} size="sm" className="bg-emerald-900 hover:bg-emerald-800">Lagre</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
