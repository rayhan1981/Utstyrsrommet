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
import { Pencil, Trash2, Plus, Download, X, Upload, FileSpreadsheet, QrCode, Eye, ImagePlus, ImageOff, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";
import QrExportDialog from "@/components/QrExportDialog";
import GenerateQrDialog from "@/components/GenerateQrDialog";
import ViewQrDialog from "@/components/ViewQrDialog";
import UpgradeCTA from "@/components/UpgradeCTA";
import { compressImage } from "@/lib/imageUtils";

const EMPTY = { name: "", category: "", main_group: "", sub_group: "", price: 0, purchase_price: "", total_stock: 0, location: "", is_clothing: false, is_ball: false, sizes: [], image_url: null, supplier_id: "", supplier_number: "", supplier_name: "" };

export default function Inventory() {
  const { hasPerm, hasFeature } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [genFor, setGenFor] = useState(null);
  const [viewFor, setViewFor] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = async () => {
    const r = await api.get("/items"); setItems(r.data);
    const s = await api.get("/suppliers").catch(() => ({ data: [] })); setSuppliers(s.data || []);
  };
  useEffect(() => { load(); }, []);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const openNew = () => { setEditId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (i) => { setEditId(i.id); setForm({ ...EMPTY, ...i, sizes: i.sizes || [] }); setOpen(true); };

  const save = async () => {
    try {
      const payload = { ...form, price: parseFloat(form.price) || 0, total_stock: parseInt(form.total_stock) || 0,
        purchase_price: form.purchase_price === "" || form.purchase_price === null ? null : parseFloat(form.purchase_price) };
      if (editId) await api.put(`/items/${editId}`, payload); else await api.post("/items", payload);
      toast.success("Lagret"); setOpen(false); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (id) => {
    if (!window.confirm("Slette denne varen?")) return;
    try { await api.delete(`/items/${id}`); toast.success("Slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const addSize = () => setForm({ ...form, sizes: [...form.sizes, { size: "", jersey_number: "X", quantity: 0, location: "", image_url: null }] });
  const removeSize = (idx) => setForm({ ...form, sizes: form.sizes.filter((_, i) => i !== idx) });
  const updSize = (idx, key, val) => {
    const arr = [...form.sizes]; arr[idx] = { ...arr[idx], [key]: val }; setForm({ ...form, sizes: arr });
  };

  const handleMainImage = async (file) => {
    try {
      const url = await compressImage(file);
      setForm((f) => ({ ...f, image_url: url }));
      toast.success("Hovedbilde lastet opp");
    } catch (e) { toast.error("Kunne ikke lese bildet"); }
  };

  const handleSizeImage = async (idx, file) => {
    try {
      const url = await compressImage(file);
      updSize(idx, "image_url", url);
      toast.success("Bilde lagt til størrelsen");
    } catch (e) { toast.error("Kunne ikke lese bildet"); }
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

  const generateQr = (item) => setGenFor(item);
  const viewQr = (item) => setViewFor(item);

  const bulkGenerateQr = async () => {
    if (!window.confirm("Aktiver QR-koder for ALLE varer og størrelser som ikke har det ennå?")) return;
    try {
      const { data } = await api.post("/items/bulk-generate-qr");
      toast.success(`QR aktivert: ${data.items_updated} varer, ${data.sizes_updated} størrelser`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const anyQr = (i) => {
    if (i.is_clothing || i.is_ball) return (i.sizes || []).some((s) => s.has_qr);
    return !!i.has_qr;
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
            <>
              <Button variant="outline" onClick={() => setQrOpen(true)} data-testid="qr-labels-btn"><QrCode className="h-4 w-4 mr-2" />Eksporter QR</Button>
              {hasPerm("inventory", "write") && (
                <Button variant="outline" onClick={bulkGenerateQr} data-testid="bulk-qr-btn"><QrCode className="h-4 w-4 mr-2" />Generer QR for alle</Button>
              )}
            </>
          )}
          {hasPerm("inventory", "write") && <Button onClick={openNew} data-testid="new-item-btn" className="bg-red-900 hover:bg-red-800"><Plus className="h-4 w-4 mr-2" />Nytt utstyr</Button>}
        </div>
      </div>

      <Card className="p-3">
        <DataTable
          rows={items.flatMap((i) => {
            if (i.is_clothing || i.is_ball) {
              return (i.sizes || []).map((s, sidx) => ({
                _id: `${i.id}__${sidx}`,
                _parent: i,
                _is_variant: true,
                id: i.id,
                image_url: s.image_url || i.image_url,
                name: i.name,
                category: i.category || "",
                main_group: i.main_group || "",
                sub_group: i.sub_group || "",
                type: i.is_clothing ? "klær" : "ball",
                size: s.size || "",
                jersey_number: i.is_clothing ? (s.jersey_number || "") : "",
                quantity: s.quantity || 0,
                price: i.price || 0,
                location: s.location || i.location || "",
              }));
            }
            return [{
              _id: i.id, _parent: i, _is_variant: false,
              id: i.id, image_url: i.image_url, name: i.name,
              category: i.category || "", main_group: i.main_group || "",
              sub_group: i.sub_group || "", type: "vare",
              size: "", jersey_number: "", quantity: i.total_stock || 0,
              price: i.price || 0, location: i.location || "",
            }];
          })}
          emptyLabel="Ingen varer."
          searchPlaceholder="Søk vare, kategori, størrelse, draktnr, lokasjon…"
          columns={[
            { key: "image", label: "", render: (r) => (
                <div className="h-10 w-10 rounded-md overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                  {r.image_url ? <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-slate-300" />}
                </div>
            ) },
            { key: "name", label: "Varenavn", filter: "text", render: (r) => (
              <div className="font-semibold truncate max-w-[180px] flex items-center gap-1.5">
                {r.name}
                {!r._parent.supplier_id && <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded whitespace-nowrap" title="Mangler leverandør – rediger varen">⚠ Mangler leverandør</span>}
              </div>
            ), accessor: (r) => `${r.name} ${r._parent.supplier_name || ""} ${r._parent.supplier_number || ""}` },
            { key: "size", label: "Str", filter: "text", render: (r) => r.size ? <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.size}</span> : <span className="text-slate-400">–</span> },
            { key: "jersey_number", label: "Draktnr", filter: "text", render: (r) => (r.jersey_number && r.jersey_number !== "X") ? <span className="font-mono text-xs">#{r.jersey_number}</span> : <span className="text-slate-400">–</span> },
            { key: "category", label: "Kategori", filter: "text", render: (r) => <span className="text-xs">{r.category || "-"}</span> },
            { key: "type", label: "Type", filter: "select",
              options: [{value:"vare",label:"Vare"},{value:"klær",label:"Klær"},{value:"ball",label:"Ball"}],
              accessor: (r) => r.type,
              render: (r) => <span className="text-xs">{r.type === "klær" ? "Klær" : r.type === "ball" ? "Ball" : "Vare"}</span> },
            { key: "price", label: "Pris", filter: "number", accessor: (r) => r.price, render: (r) => <span className="text-xs">{nok(r.price)}</span> },
            { key: "quantity", label: "Antall", filter: "number", render: (r) => <span className={r.quantity <= 3 ? "text-amber-700 font-semibold" : "font-semibold"}>{r.quantity}</span> },
            { key: "location", label: "Lokasjon", filter: "text", render: (r) => <span className="text-xs text-red-700">{r.location || "-"}</span> },
          ]}
          actions={(r) => {
            const i = r._parent;
            return (
            <>
              {hasFeature("qr_codes") && hasPerm("inventory", "write") && !r._is_variant && (
                <Button variant="outline" size="sm" onClick={() => generateQr(i)} data-testid={`gen-qr-${i.id}`}>
                  <QrCode className="h-3 w-3 mr-1" />QR
                </Button>
              )}
              {hasFeature("qr_codes") && anyQr(i) && (
                <Button variant="ghost" size="icon" onClick={() => viewQr(i)} title="Vis QR"><Eye className="h-4 w-4 text-red-700" /></Button>
              )}
              {hasPerm("inventory", "write") && <Button variant="ghost" size="icon" onClick={() => openEdit(i)} title="Rediger"><Pencil className="h-4 w-4" /></Button>}
              {hasPerm("inventory", "admin") && !r._is_variant && <Button variant="ghost" size="icon" onClick={() => del(i.id)} title="Slett"><Trash2 className="h-4 w-4 text-red-600" /></Button>}
            </>
            );
          }}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Rediger vare" : "Nytt utstyr"}</DialogTitle>
            <DialogDescription>Legg til varen med kategori, pris, beholdning og lokasjon.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {hasFeature("product_images") ? (
              <div className="flex items-start gap-4 border border-slate-200 rounded-md p-3 bg-slate-50">
                <div className="h-24 w-24 rounded-md overflow-hidden bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  {form.image_url ? (
                    <img src={form.image_url} alt="Hovedbilde" className="h-full w-full object-cover" data-testid="main-image-preview" />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-slate-300" />
                  )}
                </div>
                <div className="flex-1">
                  <Label className="text-sm font-semibold">Hovedbilde</Label>
                  <p className="text-xs text-slate-500 mb-2">Vises i varetabellen og detaljvisning.</p>
                  <div className="flex gap-2">
                    <label className="inline-flex">
                      <Button type="button" variant="outline" size="sm" asChild data-testid="upload-main-image-btn">
                        <span className="cursor-pointer">
                          <ImagePlus className="h-4 w-4 mr-1" />{form.image_url ? "Bytt bilde" : "Legg til bilde"}
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleMainImage(e.target.files[0])} />
                        </span>
                      </Button>
                    </label>
                    {form.image_url && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, image_url: null })} data-testid="remove-main-image-btn">
                        <ImageOff className="h-4 w-4 mr-1" />Fjern
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 border border-amber-200 bg-amber-50 rounded-md p-3 text-sm">
                <ImageIcon className="h-5 w-5 text-amber-700 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-amber-900">Produktbilder er med i Klubb Deluxe</div>
                  <div className="text-xs text-amber-800 mt-0.5">Oppgrader til Deluxe for å legge bilde på vare og per størrelse.</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Varenavn</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Kategori</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
              <div><Label>Hovedgruppe</Label><Input value={form.main_group} onChange={(e) => setForm({ ...form, main_group: e.target.value })} /></div>
              <div><Label>Undergruppe</Label><Input value={form.sub_group} onChange={(e) => setForm({ ...form, sub_group: e.target.value })} /></div>
              <div><Label>Pris / salg (NOK)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div><Label>Innkjøpspris (NOK)</Label><Input type="number" step="0.01" placeholder="(valgfri)" value={form.purchase_price ?? ""} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} data-testid="purchase-price-input" /></div>
              <div className="sm:col-span-2">
                <Label>Leverandør</Label>
                <Select value={form.supplier_id || "none"} onValueChange={(v) => {
                  if (v === "none") { setForm({ ...form, supplier_id: "", supplier_number: "", supplier_name: "" }); return; }
                  const s = suppliers.find((x) => x.id === v);
                  setForm({ ...form, supplier_id: v, supplier_number: s?.supplier_number || "", supplier_name: s?.name || "" });
                }}>
                  <SelectTrigger data-testid="item-supplier-select"><SelectValue placeholder="(ingen leverandør)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">(ingen leverandør)</SelectItem>
                    {suppliers.filter((s) => s.active !== false).map((s) => (
                      <SelectItem key={s.id} value={s.id}>#{s.supplier_number} · {s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2"><Label>Lokasjon (hylle/rom)</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
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
                <div className="space-y-3">
                  {form.sizes.map((s, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-md p-3 bg-slate-50/40">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                        {hasFeature("product_images") && (
                          <div className="col-span-2 sm:col-span-1">
                            <Label className="text-[11px] text-slate-500 mb-1 block">Bilde</Label>
                            <label className="inline-flex cursor-pointer">
                              <span className="h-10 w-10 rounded-md border border-slate-200 bg-white flex items-center justify-center overflow-hidden hover:border-red-500 transition" data-testid={`size-image-btn-${idx}`}>
                                {s.image_url ? <img src={s.image_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-4 w-4 text-slate-400" />}
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleSizeImage(idx, e.target.files[0])} />
                              </span>
                            </label>
                          </div>
                        )}
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Størrelse</Label>
                          <Input placeholder="M" value={s.size} onChange={(e) => updSize(idx, "size", e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Draktnummer</Label>
                          <Input placeholder="10" value={s.jersey_number} onChange={(e) => updSize(idx, "jersey_number", e.target.value || "X")} />
                        </div>
                        <div>
                          <Label className="text-[11px] text-slate-500 mb-1 block">Antall</Label>
                          <Input type="number" placeholder="0" value={s.quantity} onChange={(e) => updSize(idx, "quantity", parseInt(e.target.value) || 0)} />
                        </div>
                        <div className="col-span-2 sm:col-span-1 flex items-end gap-1">
                          <div className="flex-1">
                            <Label className="text-[11px] text-slate-500 mb-1 block">Lokasjon</Label>
                            <Input placeholder="B2" value={s.location || ""} onChange={(e) => updSize(idx, "location", e.target.value)} />
                          </div>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeSize(idx)} title="Fjern linje"><X className="h-4 w-4 text-red-600" /></Button>
                        </div>
                      </div>
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
                <div className="space-y-3">
                  {form.sizes.map((s, idx) => {
                    const used = form.sizes.map((x, i) => i !== idx ? x.size : null).filter(Boolean);
                    return (
                      <div key={idx} className="border border-slate-200 rounded-md p-3 bg-slate-50/40">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                          {hasFeature("product_images") && (
                            <div className="col-span-2 sm:col-span-1">
                              <Label className="text-[11px] text-slate-500 mb-1 block">Bilde</Label>
                              <label className="inline-flex cursor-pointer">
                                <span className="h-10 w-10 rounded-md border border-slate-200 bg-white flex items-center justify-center overflow-hidden hover:border-red-500 transition" data-testid={`ball-size-image-btn-${idx}`}>
                                  {s.image_url ? <img src={s.image_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-4 w-4 text-slate-400" />}
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleSizeImage(idx, e.target.files[0])} />
                                </span>
                              </label>
                            </div>
                          )}
                          <div>
                            <Label className="text-[11px] text-slate-500 mb-1 block">Størrelse</Label>
                            <Select value={s.size} onValueChange={(v) => updSize(idx, "size", v)}>
                              <SelectTrigger data-testid={`ball-size-select-${idx}`}><SelectValue placeholder="Velg str" /></SelectTrigger>
                              <SelectContent>
                                {BALL_SIZES.filter((b) => !used.includes(b) || b === s.size).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[11px] text-slate-500 mb-1 block">Antall</Label>
                            <Input type="number" placeholder="0" value={s.quantity} onChange={(e) => updSize(idx, "quantity", parseInt(e.target.value) || 0)} />
                          </div>
                          <div className="col-span-2 sm:col-span-1 flex items-end gap-1">
                            <div className="flex-1">
                              <Label className="text-[11px] text-slate-500 mb-1 block">Lokasjon</Label>
                              <Input placeholder="Ballbur" value={s.location || ""} onChange={(e) => updSize(idx, "location", e.target.value)} />
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeSize(idx)} title="Fjern linje"><X className="h-4 w-4 text-red-600" /></Button>
                          </div>
                        </div>
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
            <Button onClick={save} data-testid="save-item-btn" className="bg-red-900 hover:bg-red-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QrExportDialog open={qrOpen} onOpenChange={setQrOpen} />
      <GenerateQrDialog open={!!genFor} onOpenChange={(o) => !o && setGenFor(null)} item={genFor} onDone={load} />
      <ViewQrDialog open={!!viewFor} onOpenChange={(o) => !o && setViewFor(null)} item={viewFor} />

      {!hasFeature("qr_codes") && hasPerm("inventory", "read") && (
        <UpgradeCTA feature="qr_codes" inline />
      )}
    </div>
  );
}
