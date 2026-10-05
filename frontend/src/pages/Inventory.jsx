import React, { useEffect, useState } from "react";
import { api, formatError, BALL_SIZES } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, Download, Search, X, Upload, FileSpreadsheet, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";
import QrExportDialog from "@/components/QrExportDialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";

const EMPTY = { name: "", category: "", main_group: "", sub_group: "", price: 0, total_stock: 0, location: "", is_clothing: false, is_ball: false, sizes: [] };

export default function Inventory() {
  const { hasPerm, hasFeature } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = () => api.get("/items").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const openNew = () => { setEditId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (i) => { setEditId(i.id); setForm({ ...EMPTY, ...i, sizes: i.sizes || [] }); setOpen(true); };

  const save = async () => {
    try {
      const payload = { ...form, price: parseFloat(form.price) || 0, total_stock: parseInt(form.total_stock) || 0 };
      if (editId) await api.put(`/items/${editId}`, payload); else await api.post("/items", payload);
      toast.success("Lagret"); setOpen(false); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (id) => {
    if (!window.confirm("Slette denne varen?")) return;
    try { await api.delete(`/items/${id}`); toast.success("Slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const addSize = () => setForm({ ...form, sizes: [...form.sizes, { size: "", jersey_number: "X", quantity: 0, location: "" }] });
  const removeSize = (idx) => setForm({ ...form, sizes: form.sizes.filter((_, i) => i !== idx) });
  const updSize = (idx, key, val) => {
    const arr = [...form.sizes]; arr[idx] = { ...arr[idx], [key]: val }; setForm({ ...form, sizes: arr });
  };

  const exportInv = () => {
    const token = localStorage.getItem("utr_token");
    fetch(`${BASE}/api/export/inventory`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob()).then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a"); a.href = u; a.download = "beholdning.xlsx"; a.click(); URL.revokeObjectURL(u);
      });
  };

  const downloadQrLabels = () => {
    const token = localStorage.getItem("utr_token");
    fetch(`${BASE}/api/inventory/qr-labels`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a"); a.href = u; a.download = "qr-etiketter.pdf"; a.click(); URL.revokeObjectURL(u);
      });
  };

  const generateQr = async (item) => {
    try {
      await api.post(`/items/${item.id}/generate-qr`);
      toast.success(`QR-kode generert for ${item.name}`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const downloadTemplate = () => {
    const token = localStorage.getItem("utr_token");
    fetch(`${BASE}/api/items/import/template`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob()).then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a"); a.href = u; a.download = "utstyrsrommet_import_mal.xlsx"; a.click(); URL.revokeObjectURL(u);
      });
  };

  const importFile = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post("/items/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.errors && data.errors.length) {
        toast.warning(`${data.created} varer importert med ${data.errors.length} feil`);
        console.warn("Importfeil:", data.errors);
      } else {
        toast.success(`${data.created} varer importert`);
      }
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const filtered = items;

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Utstyr & Beholdning</h1>
          <p className="text-slate-600 text-sm mt-1">Varer, kategorier, størrelser og lokasjon</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={downloadTemplate} data-testid="download-template-btn"><FileSpreadsheet className="h-4 w-4 mr-2" />Last ned mal</Button>
          {hasPerm("inventory", "write") && (
            <label className="inline-flex">
              <Button variant="outline" asChild data-testid="import-items-btn">
                <span className="cursor-pointer"><Upload className="h-4 w-4 mr-2" />Importer Excel
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
                </span>
              </Button>
            </label>
          )}
          <Button variant="outline" onClick={exportInv} data-testid="export-inventory-btn"><Download className="h-4 w-4 mr-2" />Eksporter Excel</Button>
          {hasFeature("qr_codes") && (
            <Button variant="outline" onClick={() => setQrOpen(true)} data-testid="qr-labels-btn"><QrCode className="h-4 w-4 mr-2" />Eksporter QR</Button>
          )}
          {hasPerm("inventory", "write") && <Button onClick={openNew} data-testid="new-item-btn" className="bg-emerald-900 hover:bg-emerald-800"><Plus className="h-4 w-4 mr-2" />Nytt utstyr</Button>}
        </div>
      </div>

      <Card className="p-3">
        <DataTable
          rows={items}
          emptyLabel="Ingen varer."
          searchPlaceholder="Søk vare, kategori, lokasjon…"
          columns={[
            { key: "name", label: "Varenavn", filter: "text", render: (i) => (
                <div>
                  <div className="font-semibold">{i.name}</div>
                  {(i.is_clothing || i.is_ball) && (
                    <div className="text-xs text-slate-500 mt-0.5 space-y-0.5">
                      {i.sizes?.map((s, idx) => (
                        <div key={idx}>
                          <span className="font-mono">{s.size}: {s.quantity}</span>
                          {i.is_clothing && s.jersey_number && s.jersey_number !== "X" && <span className="ml-1 text-slate-700">#{s.jersey_number}</span>}
                          {s.location && <span className="ml-2 text-emerald-700">@ {s.location}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
            ) },
            { key: "category", label: "Kategori", filter: "text", render: (i) => i.category || "-" },
            { key: "main_group", label: "Hovedgruppe", filter: "text", render: (i) => i.main_group || "-" },
            { key: "sub_group", label: "Undergruppe", filter: "text", render: (i) => i.sub_group || "-" },
            { key: "type", label: "Type", filter: "select",
              options: [{value:"vare",label:"Vare"},{value:"klær",label:"Klær"},{value:"ball",label:"Ball"}],
              accessor: (i) => i.is_clothing ? "klær" : (i.is_ball ? "ball" : "vare") },
            { key: "price", label: "Pris", filter: "number", accessor: (i) => i.price || 0, render: (i) => nok(i.price) },
            { key: "total_stock", label: "Beholdning", filter: "number", render: (i) => <span className={i.total_stock <= 3 ? "text-amber-700 font-semibold" : ""}>{i.total_stock}</span> },
            { key: "location", label: "Lokasjon", filter: "text", render: (i) => i.location || "-" },
          ]}
          actions={(i) => (
            <>
              {hasFeature("qr_codes") && hasPerm("inventory", "write") && (
                i.has_qr
                  ? <span className="inline-flex items-center text-emerald-700 text-xs font-semibold mr-1" title="QR-kode generert"><QrCode className="h-4 w-4" /></span>
                  : <Button variant="outline" size="sm" onClick={() => generateQr(i)} data-testid={`gen-qr-${i.id}`}><QrCode className="h-3 w-3 mr-1" />Generer QR</Button>
              )}
              {hasPerm("inventory", "write") && <Button variant="ghost" size="icon" onClick={() => openEdit(i)}><Pencil className="h-4 w-4" /></Button>}
              {hasPerm("inventory", "admin") && <Button variant="ghost" size="icon" onClick={() => del(i.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
            </>
          )}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Rediger vare" : "Nytt utstyr"}</DialogTitle>
            <DialogDescription>Legg til varen med kategori, pris, beholdning og lokasjon.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Varenavn</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Kategori</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
              <div><Label>Hovedgruppe</Label><Input value={form.main_group} onChange={(e) => setForm({ ...form, main_group: e.target.value })} /></div>
              <div><Label>Undergruppe</Label><Input value={form.sub_group} onChange={(e) => setForm({ ...form, sub_group: e.target.value })} /></div>
              <div><Label>Pris (NOK)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div><Label>Lokasjon (hylle/rom)</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-3 border border-slate-200 rounded-md p-3 cursor-pointer">
                <Switch checked={form.is_clothing} onCheckedChange={(v) => setForm({ ...form, is_clothing: v, is_ball: v ? false : form.is_ball, sizes: v ? form.sizes : [] })} data-testid="is-clothing-switch" />
                <div>
                  <div className="font-semibold text-sm">Klær / Drakter</div>
                  <div className="text-xs text-slate-500">Egne størrelser + draktnummer</div>
                </div>
              </label>
              <label className="flex items-center gap-3 border border-slate-200 rounded-md p-3 cursor-pointer">
                <Switch checked={form.is_ball} onCheckedChange={(v) => setForm({ ...form, is_ball: v, is_clothing: v ? false : form.is_clothing, sizes: v ? form.sizes : [] })} data-testid="is-ball-switch" />
                <div>
                  <div className="font-semibold text-sm">Baller</div>
                  <div className="text-xs text-slate-500">Forhåndsdefinerte ballstørrelser</div>
                </div>
              </label>
            </div>
            {!form.is_clothing && !form.is_ball && (
              <div><Label>Total beholdning</Label><Input type="number" value={form.total_stock} onChange={(e) => setForm({ ...form, total_stock: e.target.value })} /></div>
            )}
            {form.is_clothing && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Størrelser & Draktnummer</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addSize}><Plus className="h-3 w-3 mr-1" />Legg til størrelse</Button>
                </div>
                <div className="space-y-2">
                  {form.sizes.map((s, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-2" placeholder="Str" value={s.size} onChange={(e) => updSize(idx, "size", e.target.value)} />
                      <Input className="col-span-3" placeholder="Draktnr (X)" value={s.jersey_number} onChange={(e) => updSize(idx, "jersey_number", e.target.value || "X")} />
                      <Input className="col-span-2" type="number" placeholder="Antall" value={s.quantity} onChange={(e) => updSize(idx, "quantity", parseInt(e.target.value) || 0)} />
                      <Input className="col-span-4" placeholder="Lokasjon pr str (valgfri)" value={s.location || ""} onChange={(e) => updSize(idx, "location", e.target.value)} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeSize(idx)}><X className="h-4 w-4 text-red-600" /></Button>
                    </div>
                  ))}
                  {form.sizes.length === 0 && <p className="text-sm text-slate-500">Ingen størrelser lagt til. Klikk «Legg til størrelse».</p>}
                </div>
              </div>
            )}
            {form.is_ball && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Ballstørrelser</Label>
                  <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, sizes: [...form.sizes, { size: "", jersey_number: "", quantity: 0, location: "" }] })} data-testid="add-ball-size-btn">
                    <Plus className="h-3 w-3 mr-1" />Legg til størrelse
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.sizes.map((s, idx) => {
                    const used = form.sizes.map((x, i) => i !== idx ? x.size : null).filter(Boolean);
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-4">
                          <Select value={s.size} onValueChange={(v) => updSize(idx, "size", v)}>
                            <SelectTrigger data-testid={`ball-size-select-${idx}`}><SelectValue placeholder="Velg størrelse" /></SelectTrigger>
                            <SelectContent>
                              {BALL_SIZES.filter((b) => !used.includes(b) || b === s.size).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input className="col-span-2" type="number" placeholder="Antall" value={s.quantity} onChange={(e) => updSize(idx, "quantity", parseInt(e.target.value) || 0)} />
                        <Input className="col-span-5" placeholder="Lokasjon pr str (valgfri)" value={s.location || ""} onChange={(e) => updSize(idx, "location", e.target.value)} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeSize(idx)}><X className="h-4 w-4 text-red-600" /></Button>
                      </div>
                    );
                  })}
                  {form.sizes.length === 0 && <p className="text-sm text-slate-500">Ingen ballstørrelser lagt til.</p>}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} data-testid="save-item-btn" className="bg-emerald-900 hover:bg-emerald-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QrExportDialog open={qrOpen} onOpenChange={setQrOpen} />
    </div>
  );
}
