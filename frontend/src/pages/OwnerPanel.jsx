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
import { toast } from "sonner";
import { Search, LogIn, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function OwnerPanel() {
  const { user, impersonate } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editPlan, setEditPlan] = useState("basic");

  useEffect(() => {
    if (user?.role === "platform_owner") api.get("/owner/customers").then((r) => setCustomers(r.data)).catch(() => {});
  }, [user]);

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

  const savePlan = async () => {
    try { await api.put(`/owner/customers/${editing.id}`, { plan: editPlan }); toast.success("Pakke oppdatert"); setEditing(null); const r = await api.get("/owner/customers"); setCustomers(r.data); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  if (user?.role !== "platform_owner") return <div className="text-slate-500">Kun plattformeier</div>;

  const list = results.length ? results : customers;

  return (
    <div className="space-y-6" data-testid="owner-panel">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Eier-panel</h1>
        <p className="text-slate-600 text-sm mt-1">Søk, åpne eller endre abonnementet til en kunde</p>
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
            <TableHead>Telefon</TableHead><TableHead>Pakke</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Handling</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {list.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-6">Ingen kunder.</TableCell></TableRow>}
            {list.map((c) => (
              <TableRow key={c.id} data-testid={`customer-row-${c.customer_number}`}>
                <TableCell className="font-mono font-semibold">{c.customer_number}</TableCell>
                <TableCell className="font-semibold">{c.club_name}</TableCell>
                <TableCell>{c.owner_name}</TableCell>
                <TableCell>{c.owner_email}</TableCell>
                <TableCell>{c.owner_phone || "-"}</TableCell>
                <TableCell><span className="text-xs font-semibold px-2 py-1 rounded bg-emerald-100 text-emerald-800 uppercase">{c.plan}</span></TableCell>
                <TableCell><span className="text-xs">{c.status}</span></TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)} data-testid={`edit-plan-${c.customer_number}`}><Pencil className="h-3 w-3 mr-1" />Pakke</Button>
                  <Button size="sm" className="bg-emerald-900 hover:bg-emerald-800" onClick={() => doImpersonate(c)} data-testid={`impersonate-${c.customer_number}`}><LogIn className="h-3 w-3 mr-1" />Logg inn som</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Endre pakke for {editing?.club_name}</DialogTitle>
            <DialogDescription>Oppgrader eller nedgrader kundens pakke manuelt.</DialogDescription>
          </DialogHeader>
          <div><Label>Pakke</Label>
            <Select value={editPlan} onValueChange={setEditPlan}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">Klubb Basic (399/mnd)</SelectItem>
                <SelectItem value="pro">Klubb Pro (599/mnd)</SelectItem>
                <SelectItem value="deluxe">Klubb Deluxe (999/mnd)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Avbryt</Button>
            <Button onClick={savePlan} className="bg-emerald-900 hover:bg-emerald-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
