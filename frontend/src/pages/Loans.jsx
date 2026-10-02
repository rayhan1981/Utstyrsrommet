import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function Loans() {
  const { hasPerm } = useAuth();
  const [loans, setLoans] = useState([]);
  const [items, setItems] = useState([]);
  const [teams, setTeams] = useState([]);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(false);
  const [returnFor, setReturnFor] = useState(null);
  const [returnBy, setReturnBy] = useState("");
  const [returnQty, setReturnQty] = useState(1);

  const [form, setForm] = useState({
    mode: "loan", charge_price: true, item_id: "", quantity: 1,
    team_id: "none", person_id: "none", size: "", jersey_number: "", notes: "",
  });

  const load = async () => {
    const [l, i, t, p] = await Promise.all([api.get("/loans"), api.get("/items"), api.get("/teams"), api.get("/people")]);
    setLoans(l.data); setItems(i.data); setTeams(t.data); setPeople(p.data);
  };
  useEffect(() => { load(); }, []);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const selectedItem = items.find((i) => i.id === form.item_id);

  const save = async () => {
    try {
      const payload = {
        ...form,
        quantity: parseInt(form.quantity) || 1,
        team_id: form.team_id === "none" ? null : form.team_id,
        person_id: form.person_id === "none" ? null : form.person_id,
        size: form.size || null,
        jersey_number: form.jersey_number || null,
      };
      await api.post("/loans", payload);
      toast.success(form.mode === "loan" ? "Utlån registrert" : "Utlevering registrert");
      setOpen(false); setForm({ mode: "loan", charge_price: true, item_id: "", quantity: 1, team_id: "none", person_id: "none", size: "", jersey_number: "", notes: "" });
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const doReturn = async () => {
    try {
      await api.post(`/loans/${returnFor.id}/return`, { quantity: parseInt(returnQty) || 1, received_by_person_id: returnBy || null });
      toast.success("Retur registrert - skyldig beløp oppdatert");
      setReturnFor(null); setReturnBy(""); setReturnQty(1); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const openReturn = (l) => { setReturnFor(l); setReturnQty(l.quantity); setReturnBy(""); };

  const active = loans.filter((l) => l.status === "borrowed");
  const returned = loans.filter((l) => l.status === "returned");

  const row = (l, isActive) => (
    <TableRow key={l.id} data-testid={`loan-row-${l.id}`}>
      <TableCell className="text-xs">{new Date(l.loan_date).toLocaleDateString("nb-NO")}</TableCell>
      <TableCell className="font-semibold">{l.item_name}{l.size ? ` (${l.size})` : ""}{l.jersey_number && l.jersey_number !== "X" ? ` #${l.jersey_number}` : ""}</TableCell>
      <TableCell>{l.quantity}</TableCell>
      <TableCell className="text-xs">{teams.find(t => t.id === l.team_id)?.team_name || "-"}</TableCell>
      <TableCell className="text-xs">{people.find(p => p.id === l.person_id)?.name || "-"}</TableCell>
      <TableCell className="text-xs">{l.mode === "handout" ? "Utlevert" : "Utlånt"}</TableCell>
      <TableCell className={l.amount_owed > 0 ? "text-red-700 font-semibold" : ""}>{nok(l.amount_owed)}</TableCell>
      <TableCell className="text-right">
        {isActive && hasPerm("loans", "write") && (
          <Button variant="outline" size="sm" onClick={() => openReturn(l)} data-testid={`return-btn-${l.id}`}>
            <Undo2 className="h-3 w-3 mr-1" />Returner
          </Button>
        )}
        {!isActive && (
          <span className="text-xs text-slate-500">
            {l.return_date ? new Date(l.return_date).toLocaleDateString("nb-NO") : ""}
            {l.received_by_person_id && ` / ${people.find(p => p.id === l.received_by_person_id)?.name || ""}`}
          </span>
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-6" data-testid="loans-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Utlån & Retur</h1>
          <p className="text-slate-600 text-sm mt-1">Registrer utlån, utlevering og håndter innlevering</p>
        </div>
        {hasPerm("loans", "write") && (
          <Button onClick={() => setOpen(true)} data-testid="new-loan-btn" className="bg-emerald-900 hover:bg-emerald-800">
            <Plus className="h-4 w-4 mr-2" />Nytt utlån / utlevering
          </Button>
        )}
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active">Aktive ({active.length})</TabsTrigger>
          <TabsTrigger value="returned" data-testid="tab-returned">Returnert ({returned.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Dato</TableHead><TableHead>Vare</TableHead><TableHead>Antall</TableHead><TableHead>Lag</TableHead><TableHead>Hentet av</TableHead><TableHead>Type</TableHead><TableHead>Skyldig</TableHead><TableHead className="text-right">Handling</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {active.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">Ingen aktive utlån.</TableCell></TableRow>}
                {active.map((l) => row(l, true))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="returned">
          <Card>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Dato</TableHead><TableHead>Vare</TableHead><TableHead>Antall</TableHead><TableHead>Lag</TableHead><TableHead>Hentet av</TableHead><TableHead>Type</TableHead><TableHead>Skyldig</TableHead><TableHead className="text-right">Retur</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {returned.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">Ingen returnerte utlån.</TableCell></TableRow>}
                {returned.map((l) => row(l, false))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Nytt utlån / utlevering</DialogTitle>
            <DialogDescription>Velg vare, antall og hvem som henter.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3 border border-slate-200 rounded-md p-3">
              <div className="flex-1">
                <div className="font-semibold text-sm">Modus: {form.mode === "loan" ? "Utlån (lånes ut)" : "Utlevering (gis ut)"}</div>
                <div className="text-xs text-slate-500">Bytt mellom utlån og utlevering</div>
              </div>
              <Switch checked={form.mode === "handout"} onCheckedChange={(v) => setForm({ ...form, mode: v ? "handout" : "loan" })} data-testid="loan-mode-switch" />
            </div>

            {form.mode === "handout" && (
              <label className="flex items-center gap-2 text-sm border border-slate-200 rounded-md p-3">
                <Switch checked={form.charge_price} onCheckedChange={(v) => setForm({ ...form, charge_price: v })} data-testid="charge-price-switch" />
                <span>Legg pris til som skyldig beløp</span>
              </label>
            )}

            <div>
              <Label>Vare</Label>
              <Select value={form.item_id} onValueChange={(v) => setForm({ ...form, item_id: v, size: "", jersey_number: "" })}>
                <SelectTrigger data-testid="loan-item-select"><SelectValue placeholder="Velg vare" /></SelectTrigger>
                <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({nok(i.price)})</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {(selectedItem?.is_clothing || selectedItem?.is_ball) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Størrelse</Label>
                  <Select value={form.size} onValueChange={(v) => {
                    const s = selectedItem.sizes.find((x) => x.size === v);
                    setForm({ ...form, size: v, jersey_number: s?.jersey_number || (selectedItem.is_ball ? "" : "X") });
                  }}>
                    <SelectTrigger><SelectValue placeholder="Velg str" /></SelectTrigger>
                    <SelectContent>{(selectedItem.sizes || []).map((s) => <SelectItem key={s.size} value={s.size}>{s.size} (lager: {s.quantity})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {selectedItem?.is_clothing && (
                  <div><Label>Draktnr</Label><Input value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} /></div>
                )}
              </div>
            )}

            <div><Label>Antall</Label><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="loan-qty-input" /></div>

            <div>
              <Label>Lag</Label>
              <Select value={form.team_id} onValueChange={(v) => setForm({ ...form, team_id: v })}>
                <SelectTrigger data-testid="loan-team-select"><SelectValue placeholder="Ingen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen lag</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name} {t.age_class && `(${t.age_class})`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Hentet av (person)</Label>
              <Select value={form.person_id} onValueChange={(v) => setForm({ ...form, person_id: v })}>
                <SelectTrigger><SelectValue placeholder="Ingen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen person</SelectItem>
                  {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div><Label>Notater</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} data-testid="save-loan-btn" className="bg-emerald-900 hover:bg-emerald-800">Registrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!returnFor} onOpenChange={() => setReturnFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrer retur</DialogTitle>
            <DialogDescription>{returnFor?.item_name} × {returnFor?.quantity}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Antall innlevert</Label><Input type="number" min="1" max={returnFor?.quantity} value={returnQty} onChange={(e) => setReturnQty(e.target.value)} /></div>
            <div>
              <Label>Mottatt av</Label>
              <Select value={returnBy} onValueChange={setReturnBy}>
                <SelectTrigger data-testid="return-received-by"><SelectValue placeholder="Velg person" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnFor(null)}>Avbryt</Button>
            <Button onClick={doReturn} data-testid="confirm-return-btn" className="bg-emerald-900 hover:bg-emerald-800">Bekreft retur</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
