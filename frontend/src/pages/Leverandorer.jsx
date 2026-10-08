import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Truck, Search, ShoppingCart, Trash, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import StockOrderDialog from "@/components/StockOrderDialog";
import OrderActionDialog from "@/components/OrderActionDialog";

const EMPTY = { name: "", address: "", postal_code: "", city: "", country: "Norge", email: "", phone: "", contact_person: "", org_number: "", notes: "", active: true };

export default function Leverandorer() {
  const [list, setList] = useState([]);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [detailFor, setDetailFor] = useState(null);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [quickOrderFor, setQuickOrderFor] = useState(null);
  const [actionOrder, setActionOrder] = useState(null);
  const [trash, setTrash] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);

  const load = async () => {
    const [a, b] = await Promise.all([
      api.get("/suppliers"),
      api.get("/items").catch(() => ({ data: [] })),
    ]);
    setList(a.data); setItems(b.data || []);
  };
  useEffect(() => { load(); loadTrash(); }, []);

  const openNew = () => { setEditId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (s) => { setEditId(s.id); setForm({ ...EMPTY, ...s }); setOpen(true); };

  const save = async () => {
    try {
      if (!form.name.trim()) { toast.error("Leverandørnavn kreves"); return; }
      if (form.email && !/^[^@]+@[^@]+\.[^@]+$/.test(form.email)) { toast.error("Ugyldig e-post"); return; }
      if (editId) await api.put(`/suppliers/${editId}`, form); else await api.post("/suppliers", form);
      toast.success("Lagret"); setOpen(false); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (s) => {
    if (!window.confirm(`Slette ${s.name}? Du kan angre innen 30 dager via "Papirkurv"-knappen.`)) return;
    try {
      const { data } = await api.delete(`/suppliers/${s.id}`);
      // Vis angre-toast i 10 sekunder
      toast.success(
        data.had_orders
          ? `${s.name} slettet (hadde ordrehistorikk). Klikk Angre for å gjenopprette.`
          : `${s.name} slettet. Klikk Angre for å gjenopprette.`,
        {
          duration: 10000,
          action: {
            label: "Angre",
            onClick: async () => {
              try {
                await api.post(`/suppliers/${s.id}/restore`);
                toast.success(`${s.name} gjenopprettet`);
                load();
                loadTrash();
              } catch (err) { toast.error(formatError(err.response?.data?.detail)); }
            },
          },
        }
      );
      load();
      loadTrash();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const loadTrash = async () => {
    try {
      const { data } = await api.get("/suppliers/trash");
      setTrash(data);
    } catch (e) { /* non-admin: silently ignore */ }
  };

  const restoreFromTrash = async (s) => {
    try {
      await api.post(`/suppliers/${s.id}/restore`);
      toast.success(`${s.name} gjenopprettet`);
      load(); loadTrash();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const openHistory = async (s) => {
    setDetailFor(s);
    const { data } = await api.get(`/suppliers/${s.id}/orders`);
    setOrders(data);
  };

  const filtered = list.filter((s) => {
    if (!q) return true;
    const t = q.toLowerCase();
    return [s.name, s.email, s.city, s.contact_person, s.org_number].some((x) => (x || "").toLowerCase().includes(t));
  });

  const filteredOrders = orders.filter((o) => {
    if (!search) return true;
    const t = search.toLowerCase();
    return [o.po_number, ...(o.lines || []).map((l) => `${l.item_name} ${l.item_number || ""}`)].join(" ").toLowerCase().includes(t);
  });

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  return (
    <div className="space-y-5" data-testid="suppliers-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><Truck className="h-7 w-7 text-red-700" />Leverandører</h1>
          <p className="text-slate-600 text-sm mt-1">Registrer, rediger og vis ordrehistorikk per leverandør</p>
        </div>
        <Button onClick={openNew} className="bg-red-700 hover:bg-red-800" data-testid="new-supplier-btn"><Plus className="h-4 w-4 mr-1" />Ny leverandør</Button>
        {trash.length > 0 && (
          <Button onClick={() => setTrashOpen(true)} variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-50"
                  data-testid="open-trash-btn" title="Vis slettede leverandører (siste 30 dager)">
            <Trash className="h-4 w-4 mr-1" />Papirkurv ({trash.length})
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Søk leverandør…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Table>
          <TableHeader><TableRow><TableHead className="w-16">Nr</TableHead><TableHead>Navn</TableHead><TableHead>Kontakt</TableHead><TableHead>Sted</TableHead><TableHead>E-post / tlf</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-6">Ingen leverandører</TableCell></TableRow>}
            {filtered.map((s) => (
              <TableRow key={s.id} className={s.active === false ? "opacity-60" : ""}>
                <TableCell className="font-mono text-xs font-semibold text-red-700">#{s.supplier_number || "-"}</TableCell>
                <TableCell className="font-semibold"><button onClick={() => openHistory(s)} className="text-red-700 hover:underline">{s.name}</button></TableCell>
                <TableCell className="text-xs">{s.contact_person || "-"}</TableCell>
                <TableCell className="text-xs">{s.postal_code} {s.city}</TableCell>
                <TableCell className="text-xs">{s.email}<br/>{s.phone}</TableCell>
                <TableCell><span className={`text-xs font-semibold px-2 py-0.5 rounded ${s.active === false ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-800"}`}>{s.active === false ? "Deaktivert" : "Aktiv"}</span></TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                    {s.active !== false && (
                      <Button variant="outline" size="sm" onClick={() => setQuickOrderFor(s)}
                              className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 bg-emerald-50 border-emerald-300 text-emerald-800"
                              data-testid={`quick-order-${s.supplier_number}`}
                              title={`Opprett ny bestilling for ${s.name} (kun varer knyttet til denne leverandøren)`}>
                        <ShoppingCart className="h-3.5 w-3.5" /><span className="text-[9px]">Bestill varer</span>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(s)}
                            className="flex flex-col items-center h-auto py-1 px-2 gap-0.5"
                            data-testid={`edit-supplier-${s.supplier_number}`}>
                      <Pencil className="h-3.5 w-3.5" /><span className="text-[9px]">Rediger</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => del(s)}
                            className="flex flex-col items-center h-auto py-1 px-2 gap-0.5"
                            data-testid={`del-supplier-${s.supplier_number}`}>
                      <Trash2 className="h-3.5 w-3.5 text-red-600" /><span className="text-[9px] text-red-600">Slett</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editId ? "Rediger leverandør" : "Ny leverandør"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><Label>Leverandørnavn *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="supplier-name" /></div>
            <div className="sm:col-span-2"><Label>Adresse</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>Postnr</Label><Input value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></div>
            <div><Label>Poststed</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div><Label>Land</Label><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
            <div><Label>Organisasjonsnr</Label><Input value={form.org_number} onChange={(e) => setForm({ ...form, org_number: e.target.value })} /></div>
            <div><Label>E-post</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Telefon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Kontaktperson</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Notater</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} className="bg-red-700 hover:bg-red-800" data-testid="save-supplier-btn">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailFor} onOpenChange={(o) => !o && setDetailFor(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ordrehistorikk: {detailFor?.name}</DialogTitle>
            <DialogDescription>{orders.length} bestillinger</DialogDescription>
          </DialogHeader>
          <Input placeholder="Søk innkjøpsnummer, varenavn, artikkelnr…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3" />
          <Table>
            <TableHeader><TableRow><TableHead>Dato</TableHead><TableHead>Innkjøpsnr</TableHead><TableHead>Lag/Lager</TableHead><TableHead>Linjer</TableHead><TableHead className="text-right">Beløp</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {filteredOrders.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-6">Ingen bestillinger</TableCell></TableRow>}
              {filteredOrders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{new Date(o.created_at).toLocaleDateString("nb-NO")}</TableCell>
                  <TableCell className="font-mono font-semibold">{o.po_number}</TableCell>
                  <TableCell className="text-xs">{o.is_stock_order ? "Lagerbestilling" : `${o.team_name} (${o.season})`}</TableCell>
                  <TableCell>{(o.lines || []).length}</TableCell>
                  <TableCell className="text-right font-semibold">{nok(o.total_amount)}</TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter><Button variant="outline" onClick={() => setDetailFor(null)}>Lukk</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-800"><Trash className="h-5 w-5" />Papirkurv – slettede leverandører</DialogTitle>
            <DialogDescription>Slettede leverandører fra siste 30 dager. Klikk <strong>Gjenopprett</strong> for å angre sletting.</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Nr</TableHead><TableHead>Navn</TableHead><TableHead>Slettet</TableHead><TableHead>Av</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {trash.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-6">Ingen slettede leverandører</TableCell></TableRow>}
              {trash.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs text-slate-600">#{s.supplier_number || "-"}</TableCell>
                  <TableCell className="font-semibold">{s.name}</TableCell>
                  <TableCell className="text-xs text-slate-500">{s.deleted_at ? new Date(s.deleted_at).toLocaleString("nb-NO") : "-"}</TableCell>
                  <TableCell className="text-xs text-slate-500">{s.deleted_by_name || "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => restoreFromTrash(s)}
                            className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 border-emerald-300 text-emerald-800 bg-emerald-50"
                            data-testid={`restore-supplier-${s.supplier_number}`}>
                      <RotateCcw className="h-3.5 w-3.5" /><span className="text-[9px]">Gjenopprett</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter><Button variant="outline" onClick={() => setTrashOpen(false)}>Lukk</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <StockOrderDialog
        open={!!quickOrderFor}
        onClose={() => setQuickOrderFor(null)}
        suppliers={list}
        items={items}
        lockedSupplierId={quickOrderFor?.id}
        onDone={(data) => {
          setQuickOrderFor(null);
          // data = { id, po_number, ... } fra POST /orders. Vi trenger supplier-ref for e-post-default.
          setActionOrder({ order: data, supplier: quickOrderFor });
          load();
        }}
      />

      <OrderActionDialog
        open={!!actionOrder}
        order={actionOrder?.order}
        supplier={actionOrder?.supplier}
        onClose={() => setActionOrder(null)}
      />
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    bestilt: { label: "Bestilt", cls: "bg-blue-100 text-blue-800", icon: "●" },
    delvis_levert: { label: "Delvis levert", cls: "bg-amber-100 text-amber-800", icon: "▲" },
    levert: { label: "Levert", cls: "bg-emerald-100 text-emerald-800", icon: "✓" },
    manko: { label: "Manko", cls: "bg-red-100 text-red-800", icon: "!" },
    restbestilling: { label: "Restbestilling", cls: "bg-purple-100 text-purple-800", icon: "■" },
    arkivert: { label: "Arkivert", cls: "bg-slate-200 text-slate-700", icon: "◦" },
    ikke_sendt: { label: "Ikke sendt", cls: "bg-slate-100 text-slate-700", icon: "◦" },
    sendt: { label: "Sendt", cls: "bg-blue-100 text-blue-800", icon: "✉" },
  };
  const s = map[status] || { label: status, cls: "bg-slate-100 text-slate-700", icon: "" };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded ${s.cls}`}>{s.icon} {s.label}</span>;
}
