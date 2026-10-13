import React, { useEffect, useState, useMemo } from "react";
import { api, formatError, BALL_SIZES } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, Download, X, Upload, FileSpreadsheet, QrCode, Eye, ImagePlus, ImageOff, ImageIcon, Package, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";
import QrExportDialog from "@/components/QrExportDialog";
import GenerateQrDialog from "@/components/GenerateQrDialog";
import ViewQrDialog from "@/components/ViewQrDialog";
import UpgradeCTA from "@/components/UpgradeCTA";
import { compressImage } from "@/lib/imageUtils";
import { sortSizesNatural, naturalSizeKey } from "@/lib/sizeSort";
import TaxonomyPicker from "@/components/TaxonomyPicker";
import ImportPreviewDialog from "@/components/ImportPreviewDialog";

const EMPTY = { name: "", main_item_number: "", category: "", main_group: "", sub_group: "", price: 0, purchase_price: "", total_stock: 0, location: "", is_clothing: false, is_ball: false, sizes: [], image_url: null, images: [], supplier_id: "", supplier_number: "", supplier_name: "" };

// Hjelpere for lokal forhåndsvisning av komplett varenummer (speiler backend-logikk)
function _normSize(s) { s = String(s || "").trim(); if (!s) return ""; return /\d/.test(s) ? s : s.toUpperCase(); }
function _normJersey(j) { j = String(j ?? "").trim(); if (!j || j.toUpperCase() === "X") return ""; if (/^\d$/.test(j)) return "0" + j; return j; }
function computeFullNumber(main, size, jersey) {
  const m = String(main || "").trim();
  if (!m) return "";
  const parts = [m];
  const s = _normSize(size); if (s) parts.push(s);
  const j = _normJersey(jersey); if (j) parts.push(j);
  return parts.join("-");
}

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
  const [importPreview, setImportPreview] = useState(null);
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState(null);
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
    if (!window.confirm("Slette denne varen? Varen kan ikke slettes hvis den har aktive utlån eller åpne bestillinger.")) return;
    try { await api.delete(`/items/${id}`); toast.success("Slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delVariant = async (item, size, jersey_number) => {
    const label = `${size}${jersey_number && jersey_number !== "X" ? " #" + jersey_number : ""}`;
    if (!window.confirm(`Slette varelinje ${label} av «${item.name}»?\n\nLinjen kan ikke slettes hvis den har aktive utlån.`)) return;
    try {
      await api.post(`/items/${item.id}/delete-variant`, { size, jersey_number });
      toast.success(`Varelinje ${label} slettet`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const addSize = () => setForm({ ...form, sizes: [...form.sizes, { size: "", jersey_number: "X", quantity: 0, location: "", image_url: null, images: [] }] });
  const removeSize = (idx) => setForm({ ...form, sizes: form.sizes.filter((_, i) => i !== idx) });
  const updSize = (idx, key, val) => {
    const arr = [...form.sizes]; arr[idx] = { ...arr[idx], [key]: val }; setForm({ ...form, sizes: arr });
  };

  const MAX_MAIN_IMAGES = 5;
  const MAX_SIZE_IMAGES = 4;

  const handleMainImage = async (file) => {
    try {
      const url = await compressImage(file);
      setForm((f) => {
        const imgs = [...(f.images || [])];
        if (imgs.length >= MAX_MAIN_IMAGES) { toast.error(`Maks ${MAX_MAIN_IMAGES} bilder for hovedvare`); return f; }
        imgs.push(url);
        return { ...f, images: imgs, image_url: f.image_url || url };
      });
      toast.success("Bilde lagt til");
    } catch (e) { toast.error("Kunne ikke lese bildet"); }
  };

  const removeMainImage = (idx) => {
    setForm((f) => {
      const imgs = (f.images || []).filter((_, i) => i !== idx);
      return { ...f, images: imgs, image_url: imgs[0] || null };
    });
  };

  const handleSizeImage = async (idx, file) => {
    try {
      const url = await compressImage(file);
      const arr = [...form.sizes];
      const s = { ...arr[idx] };
      const imgs = [...(s.images || [])];
      if (imgs.length >= MAX_SIZE_IMAGES) { toast.error(`Maks ${MAX_SIZE_IMAGES} bilder per størrelse`); return; }
      imgs.push(url);
      s.images = imgs; s.image_url = s.image_url || url;
      arr[idx] = s; setForm({ ...form, sizes: arr });
      toast.success("Bilde lagt til størrelsen");
    } catch (e) { toast.error("Kunne ikke lese bildet"); }
  };

  const removeSizeImage = (idx, imgIdx) => {
    const arr = [...form.sizes];
    const s = { ...arr[idx] };
    const imgs = (s.images || []).filter((_, i) => i !== imgIdx);
    s.images = imgs; s.image_url = imgs[0] || null;
    arr[idx] = s; setForm({ ...form, sizes: arr });
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
  const viewQr = (row) => {
    // row kan være forelder-item (sizeless) eller en variant-rad (med size)
    const item = row?._parent || row;
    const payload = { item };
    if (row && row._is_variant && row.size) {
      payload.size = row.size;
      payload.jersey_number = row.jersey_number;
      payload.quantity = row.quantity;
    }
    setViewFor(payload);
  };

  const deleteQrLine = async (row) => {
    const item = row._parent || row;
    const label = row._is_variant && row.size
      ? `QR-kode for ${item.name} (${row.size}${row.jersey_number && row.jersey_number !== "X" ? " #" + row.jersey_number : ""})`
      : `QR-kode for ${item.name}`;
    if (!window.confirm(`Er du sikker på at du vil slette ${label}?\n\nDu kan generere ny QR senere.`)) return;
    try {
      const params = row._is_variant && row.size ? `?size=${encodeURIComponent(row.size)}` : "";
      await api.delete(`/items/${item.id}/qr${params}`);
      toast.success("QR-kode slettet");
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const deleteAllQr = async () => {
    if (!window.confirm("Er du sikker på at du vil SLETTE ALLE QR-koder for alle varer?\n\nDenne handlingen kan ikke angres. Du kan generere nye QR-koder etterpå.")) return;
    try {
      const { data } = await api.post("/items/qr-reset-all");
      toast.success(`Slettet QR for ${data.items_cleared} varer og ${data.sizes_cleared} varelinjer`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  /**
   * Direkte-generer QR for én spesifikk varelinje (variant eller enkeltvare).
   * Kan kun kalles én gang pr linje – backend ignorerer re-generering men UI blokkerer også.
   */
  const generateQrForLine = async (row) => {
    if (row._has_qr) {
      toast.info("QR-kode finnes allerede for denne varelinjen – kan ikke genereres på nytt");
      return;
    }
    const i = row._parent;
    const label = row._is_variant
      ? `${i.name} (${row.size || "–"}${row.jersey_number && row.jersey_number !== "X" ? " · #" + row.jersey_number : ""})`
      : i.name;
    if (!window.confirm(`Generer QR-kode for ${label}?\n\nQR-koden kan kun genereres én gang pr varelinje.`)) return;
    try {
      const body = row._is_variant && row.size ? { sizes: [row.size] } : {};
      await api.post(`/items/${i.id}/generate-qr`, body);
      toast.success(`QR-kode generert for ${label}`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

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
      const { data } = await api.post("/items/import/preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPendingImportFile(file);
      setImportPreview(data);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const filtered = items;

  // Unike kategorier m/ antall – brukes i webshop-style kategoribar
  const categoryList = useMemo(() => {
    const counts = new Map();
    for (const i of items) {
      const c = (i.category || "").trim();
      if (!c) continue;
      // Tell varianter som "varer" i kategorien når det er klær/ball
      const n = (i.is_clothing || i.is_ball) ? ((i.sizes || []).length || 1) : 1;
      counts.set(c, (counts.get(c) || 0) + n);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], "nb"));
  }, [items]);

  const totalRowCount = useMemo(() => {
    let n = 0;
    for (const i of items) {
      n += (i.is_clothing || i.is_ball) ? ((i.sizes || []).length || 1) : 1;
    }
    return n;
  }, [items]);

  // Faktisk filtrert item-liste basert på kategorivalg
  const visibleItems = useMemo(() => {
    if (!categoryFilter) return items;
    return items.filter((i) => (i.category || "").trim() === categoryFilter);
  }, [items, categoryFilter]);

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
              {hasPerm("inventory", "admin") && (
                <Button variant="outline" onClick={deleteAllQr} data-testid="reset-all-qr-btn" className="text-red-700 border-red-200 hover:bg-red-50"><Trash2 className="h-4 w-4 mr-2" />Slett alle QR</Button>
              )}
            </>
          )}
          {hasPerm("inventory", "write") && <Button onClick={openNew} data-testid="new-item-btn" className="bg-red-900 hover:bg-red-800"><Plus className="h-4 w-4 mr-2" />Nytt utstyr</Button>}
        </div>
      </div>

      {/* Webshop-style kategoribar */}
      {categoryList.length > 0 && (
        <Card className="p-3" data-testid="category-bar">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={categoryFilter === null ? "default" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter(null)}
              data-testid="cat-filter-all"
              className={categoryFilter === null ? "bg-red-700 hover:bg-red-800 text-white" : ""}
              title="Vis alle varer uavhengig av kategori"
            >
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              Vis alle varer
              <span className="ml-1.5 text-[10px] opacity-80">({totalRowCount})</span>
            </Button>
            <span className="h-6 w-px bg-slate-200 mx-1" />
            {categoryList.map(([cat, cnt]) => (
              <Button
                key={cat}
                variant={categoryFilter === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter(cat)}
                data-testid={`cat-filter-${cat.replace(/[^A-Za-z0-9]+/g, "_")}`}
                className={categoryFilter === cat ? "bg-red-700 hover:bg-red-800 text-white" : ""}
                title={`Vis kun varer i kategorien «${cat}»`}
              >
                <Package className="h-4 w-4 mr-1.5" />
                {cat}
                <span className="ml-1.5 text-[10px] opacity-80">({cnt})</span>
              </Button>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-2 sm:p-3">
        <DataTable
          key={categoryFilter || "__all__"}
          initialGroupBy={categoryFilter ? [] : ["category", "main_group", "sub_group"]}
          getRowId={(r) => r._id}
          onDropToGroup={async (rowId, target) => {
            // rowId er vårt _id (f.eks. "ITEM__size__jersey__idx") – mapper tilbake til item.id
            const parentId = rowId.split("__")[0];
            try {
              await api.post("/items/bulk-move", {
                item_ids: [parentId],
                target_category: target.category ?? null,
                target_main_group: target.main_group ?? null,
                target_sub_group: target.sub_group ?? null,
              });
              toast.success("Flyttet til ny mappe");
              load();
            } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
          }}
          rows={visibleItems.flatMap((i) => {
            if (i.is_clothing || i.is_ball) {
              const sortedSizes = sortSizesNatural(i.sizes || [], (s) => s.size);
              return sortedSizes.map((s, sidx) => ({
                _id: `${i.id}__${s.size || "nosize"}__${s.jersey_number || "x"}__${sidx}`,
                _parent: i,
                _is_variant: true,
                _has_qr: !!s.has_qr,
                id: i.id,
                image_url: s.image_url || i.image_url,
                name: i.name,
                full_number: s.full_number || computeFullNumber(i.main_item_number || "", s.size, s.jersey_number),
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
              _id: i.id, _parent: i, _is_variant: false, _has_qr: !!i.has_qr,
              id: i.id, image_url: i.image_url, name: i.name,
              full_number: i.full_number || i.main_item_number || "",
              category: i.category || "", main_group: i.main_group || "",
              sub_group: i.sub_group || "", type: "vare",
              size: "", jersey_number: "", quantity: i.total_stock || 0,
              price: i.price || 0, location: i.location || "",
            }];
          })}
          emptyLabel="Ingen varer."
          searchPlaceholder="Søk varenummer, varenavn, kategori, størrelse, draktnr, lokasjon…"
          columns={[
            { key: "image", label: "", className: "w-10 py-1 px-1 sm:px-2", render: (r) => (
                <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-md overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                  {r.image_url ? <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-slate-300" />}
                </div>
            ) },
          ].concat(categoryFilter ? [] : [
            // Kategori-kolonnen skjules når kategori-filteret er aktivt (den vises som badge i topplinjen).
          ]).concat([
            { key: "full_number", label: "Varenr", filter: "text", className: "py-1 px-1 sm:px-2",
              accessor: (r) => r.full_number || "",
              render: (r) => r.full_number ? <span className="font-mono text-[11px] bg-red-50 text-red-800 px-1.5 py-0.5 rounded whitespace-nowrap">{r.full_number}</span> : <span className="text-slate-300 text-xs">–</span> },
            { key: "name", label: "Varenavn", filter: "text", className: "py-1 px-1 sm:px-2", render: (r) => (
              <div className="min-w-0 max-w-[220px] sm:max-w-[260px]">
                <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                  <span className="truncate">{r.name}</span>
                  {r.size && <span className="sm:hidden font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded shrink-0">{r.size}</span>}
                  {r.jersey_number && r.jersey_number !== "X" && <span className="sm:hidden font-mono text-[10px] text-slate-500 shrink-0">#{r.jersey_number}</span>}
                </div>
                <div className="sm:hidden flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
                  <span>{nok(r.price)}</span>
                  <span className="text-slate-300">·</span>
                  <span className={r.quantity <= 3 ? "text-amber-700 font-semibold" : ""}>{r.quantity} stk</span>
                  {r.location && <><span className="text-slate-300">·</span><span className="text-red-700 truncate">{r.location}</span></>}
                </div>
                {!r._parent.supplier_id && <span className="inline-block text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5" title="Mangler leverandør – rediger varen">⚠ Mangler leverandør</span>}
              </div>
            ), accessor: (r) => `${r.name} ${r._parent.supplier_name || ""} ${r._parent.supplier_number || ""}` },
            { key: "size", label: "Str", filter: "text", className: "hidden sm:table-cell py-1 px-2", render: (r) => r.size ? <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.size}</span> : <span className="text-slate-400">–</span> },
            { key: "jersey_number", label: "Draktnr", filter: "text", className: "hidden md:table-cell py-1 px-2", render: (r) => (r.jersey_number && r.jersey_number !== "X") ? <span className="font-mono text-xs">#{r.jersey_number}</span> : <span className="text-slate-400">–</span> },
            ...(categoryFilter ? [] : [{ key: "category", label: "Kategori", filter: "text", groupable: true, className: "hidden xl:table-cell py-1 px-2",
              groupLabel: (v) => (v == null || v === "" ? "(Uten kategori)" : String(v)),
              render: (r) => <span className="text-xs">{r.category || "-"}</span> }]),
            { key: "main_group", label: "Hovedgruppe", filter: "text", groupable: true, className: "hidden xl:table-cell py-1 px-2", accessor: (r) => r.main_group || "",
              groupLabel: (v) => (v == null || v === "" ? "(Uten hovedgruppe)" : String(v)),
              render: (r) => <span className="text-xs text-slate-600">{r.main_group || "-"}</span> },
            { key: "sub_group", label: "Undergruppe", filter: "text", groupable: true, className: "hidden xl:table-cell py-1 px-2", accessor: (r) => r.sub_group || "",
              groupLabel: (v) => (v == null || v === "" ? "(Uten undergruppe)" : String(v)),
              render: (r) => <span className="text-xs text-slate-500">{r.sub_group || "-"}</span> },
            { key: "type", label: "Type", filter: "select", className: "hidden lg:table-cell py-1 px-2",
              options: [{value:"vare",label:"Vare"},{value:"klær",label:"Klær"},{value:"ball",label:"Ball"}],
              accessor: (r) => r.type,
              render: (r) => <span className="text-xs">{r.type === "klær" ? "Klær" : r.type === "ball" ? "Ball" : "Vare"}</span> },
            { key: "price", label: "Pris", filter: "number", className: "hidden md:table-cell py-1 px-2", accessor: (r) => r.price, render: (r) => <span className="text-xs">{nok(r.price)}</span> },
            { key: "quantity", label: "Antall", filter: "number", className: "hidden sm:table-cell py-1 px-2", render: (r) => <span className={r.quantity <= 3 ? "text-amber-700 font-semibold" : "font-semibold"}>{r.quantity}</span> },
            { key: "location", label: "Lokasjon", filter: "text", className: "hidden lg:table-cell py-1 px-2", render: (r) => <span className="text-xs text-red-700">{r.location || "-"}</span> },
          ])}
          actions={(r) => {
            const i = r._parent;
            return (
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {hasFeature("qr_codes") && hasPerm("inventory", "write") && (
                r._has_qr ? (
                  <Button variant="outline" size="sm" disabled
                          data-testid={`gen-qr-done-${r._id}`}
                          title="QR-kode er allerede generert for denne varelinjen"
                          className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 opacity-60 cursor-not-allowed">
                    <QrCode className="h-3.5 w-3.5 text-emerald-700" /><span className="text-[9px] text-emerald-700">✓ QR laget</span>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => generateQrForLine(r)}
                          data-testid={`gen-qr-line-${r._id}`}
                          className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 bg-red-50 hover:bg-red-100 border-red-200 text-red-800">
                    <QrCode className="h-3.5 w-3.5" /><span className="text-[9px]">Generer QR</span>
                  </Button>
                )
              )}
              {hasFeature("qr_codes") && (
                <Button variant="ghost" size="sm" onClick={() => viewQr(r)} data-testid={`view-qr-${r._id}`}
                        disabled={!r._has_qr}
                        className={`flex flex-col items-center h-auto py-1 px-2 gap-0.5 ${!r._has_qr ? "opacity-40 cursor-not-allowed" : ""}`}>
                  <QrCode className="h-3.5 w-3.5 text-red-700" /><span className="text-[9px] text-red-700">Vis QR</span>
                </Button>
              )}
              {hasFeature("qr_codes") && hasPerm("inventory", "write") && r._has_qr && (
                <Button variant="ghost" size="sm" onClick={() => deleteQrLine(r)} data-testid={`del-qr-${r._id}`}
                        className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                  <Trash2 className="h-3.5 w-3.5 text-red-600" /><span className="text-[9px] text-red-600">Slett QR</span>
                </Button>
              )}
              {hasPerm("inventory", "write") && (
                <Button variant="ghost" size="sm" onClick={() => openEdit(i)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                  <Pencil className="h-3.5 w-3.5" /><span className="text-[9px]">Rediger</span>
                </Button>
              )}
              {hasPerm("inventory", "admin") && r._is_variant && r.size && (
                <Button variant="ghost" size="sm" onClick={() => delVariant(i, r.size, r.jersey_number)} data-testid={`del-variant-${i.id}-${r.size}`}
                        className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                  <Trash2 className="h-3.5 w-3.5 text-red-600" /><span className="text-[9px] text-red-600">Slett linje</span>
                </Button>
              )}
              {hasPerm("inventory", "admin") && !r._is_variant && (
                <Button variant="ghost" size="sm" onClick={() => del(i.id)} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                  <Trash2 className="h-3.5 w-3.5 text-red-600" /><span className="text-[9px] text-red-600">Slett vare</span>
                </Button>
              )}
            </div>
            );
          }}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Rediger vare" : "Nytt utstyr"}</DialogTitle>
            <DialogDescription>Legg til varen med kategori, pris, beholdning og lokasjon.</DialogDescription>
            <div className="flex gap-2 pt-3 border-t border-slate-100 mt-2">
              <Button variant="outline" onClick={() => setOpen(false)} data-testid="cancel-item-top">Avbryt</Button>
              <Button onClick={save} data-testid="save-item-top" className="bg-red-900 hover:bg-red-800">Lagre vare</Button>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            {hasFeature("product_images") ? (
              <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <Label className="text-sm font-semibold">Bilder av varen (inntil {MAX_MAIN_IMAGES})</Label>
                    <p className="text-xs text-slate-500">Første bilde vises i varetabellen og som hovedbilde.</p>
                  </div>
                  <span className="text-xs text-slate-500">{(form.images || []).length}/{MAX_MAIN_IMAGES}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(form.images || []).map((url, idx) => (
                    <div key={idx} className="relative group h-20 w-20 rounded-md overflow-hidden bg-white border border-slate-200">
                      <img src={url} alt={`Bilde ${idx+1}`} className="h-full w-full object-cover" data-testid={`main-image-${idx}`} />
                      {idx === 0 && <span className="absolute top-0.5 left-0.5 bg-red-700 text-white text-[9px] px-1 rounded">HOVED</span>}
                      <button type="button" onClick={() => removeMainImage(idx)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition" data-testid={`remove-main-image-${idx}`}>
                        <ImageOff className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {(form.images || []).length < MAX_MAIN_IMAGES && (
                    <label className="inline-flex cursor-pointer">
                      <span className="h-20 w-20 rounded-md border-2 border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-slate-400 hover:border-red-500 hover:text-red-600 transition" data-testid="upload-main-image-btn">
                        <ImagePlus className="h-5 w-5" />
                        <span className="text-[10px] mt-0.5">Legg til</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleMainImage(e.target.files[0])} />
                      </span>
                    </label>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 border border-amber-200 bg-amber-50 rounded-md p-3 text-sm">
                <ImageIcon className="h-5 w-5 text-amber-700 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-amber-900">Produktbilder er med i Klubb Premium</div>
                  <div className="text-xs text-amber-800 mt-0.5">Oppgrader til Premium for å legge bilde på vare og per størrelse.</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Varenavn *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="item-name-input" /></div>
              <div>
                <Label className="flex items-center gap-1.5">
                  Hovedvarenummer *
                  <span className="text-[10px] font-normal text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Fritekst</span>
                </Label>
                <Input
                  value={form.main_item_number}
                  onChange={(e) => setForm({ ...form, main_item_number: e.target.value })}
                  placeholder="HJEM100"
                  data-testid="main-item-number-input"
                  className="font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">Bokstaver + tall. Komplett varenummer bygges automatisk: Hovedvarenummer-Størrelse-Draktnummer.</p>
              </div>
              <div className="hidden sm:block"></div>
              <TaxonomyPicker
                value={{ category: form.category, main_group: form.main_group, sub_group: form.sub_group }}
                onChange={(v) => setForm({ ...form, category: v.category, main_group: v.main_group, sub_group: v.sub_group })}
              />
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
              <>
                <div><Label>Total beholdning</Label><Input type="number" value={form.total_stock} onChange={(e) => setForm({ ...form, total_stock: e.target.value })} /></div>
                {form.main_item_number && (
                  <div className="border border-emerald-200 bg-emerald-50 rounded-md p-2.5 text-xs">
                    <div className="font-semibold text-emerald-900 mb-0.5">Komplett varenummer:</div>
                    <span className="font-mono text-sm text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-200" data-testid="full-number-preview">{form.main_item_number.trim()}</span>
                  </div>
                )}
              </>
            )}
            {(form.is_clothing || form.is_ball) && form.main_item_number && form.sizes.length > 0 && (
              <div className="border border-emerald-200 bg-emerald-50 rounded-md p-2.5 text-xs">
                <div className="font-semibold text-emerald-900 mb-1.5">Forhåndsvisning – komplette varenummer:</div>
                <div className="flex flex-wrap gap-1.5" data-testid="variant-numbers-preview">
                  {form.sizes.map((s, i) => {
                    const fn = computeFullNumber(form.main_item_number || "", s.size, form.is_ball ? "" : s.jersey_number);
                    return <span key={i} className="font-mono text-[11px] text-emerald-900 bg-white px-1.5 py-0.5 rounded border border-emerald-200">{fn || "(mangler)"}</span>;
                  })}
                </div>
              </div>
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
                            <Label className="text-[11px] text-slate-500 mb-1 block">Bilder ({(s.images || []).length}/{MAX_SIZE_IMAGES})</Label>
                            <div className="flex flex-wrap gap-1">
                              {(s.images || []).map((url, iidx) => (
                                <div key={iidx} className="relative group h-10 w-10 rounded-md overflow-hidden border border-slate-200 bg-white">
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                  <button type="button" onClick={() => removeSizeImage(idx, iidx)} className="absolute inset-0 bg-black/0 hover:bg-black/50 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition">
                                    <ImageOff className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                              {(s.images || []).length < MAX_SIZE_IMAGES && (
                                <label className="inline-flex cursor-pointer">
                                  <span className="h-10 w-10 rounded-md border border-dashed border-slate-300 bg-white flex items-center justify-center hover:border-red-500 transition" data-testid={`size-image-btn-${idx}`}>
                                    <ImagePlus className="h-4 w-4 text-slate-400" />
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleSizeImage(idx, e.target.files[0])} />
                                  </span>
                                </label>
                              )}
                            </div>
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
                          <Button type="button" variant="outline" size="sm" onClick={() => removeSize(idx)}
                                  className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 border-red-200 bg-red-50 hover:bg-red-100"
                                  data-testid={`del-size-${idx}`}
                                  title="Slett denne varelinjen">
                            <Trash2 className="h-3.5 w-3.5 text-red-600" />
                            <span className="text-[9px] text-red-700">Slett str</span>
                          </Button>
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
                              <Label className="text-[11px] text-slate-500 mb-1 block">Bilder ({(s.images || []).length}/{MAX_SIZE_IMAGES})</Label>
                              <div className="flex flex-wrap gap-1">
                                {(s.images || []).map((url, iidx) => (
                                  <div key={iidx} className="relative group h-10 w-10 rounded-md overflow-hidden border border-slate-200 bg-white">
                                    <img src={url} alt="" className="h-full w-full object-cover" />
                                    <button type="button" onClick={() => removeSizeImage(idx, iidx)} className="absolute inset-0 bg-black/0 hover:bg-black/50 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition">
                                      <ImageOff className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                                {(s.images || []).length < MAX_SIZE_IMAGES && (
                                  <label className="inline-flex cursor-pointer">
                                    <span className="h-10 w-10 rounded-md border border-dashed border-slate-300 bg-white flex items-center justify-center hover:border-red-500 transition" data-testid={`ball-size-image-btn-${idx}`}>
                                      <ImagePlus className="h-4 w-4 text-slate-400" />
                                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleSizeImage(idx, e.target.files[0])} />
                                    </span>
                                  </label>
                                )}
                              </div>
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
                            <Button type="button" variant="outline" size="sm" onClick={() => removeSize(idx)}
                                    className="flex flex-col items-center h-auto py-1 px-2 gap-0.5 border-red-200 bg-red-50 hover:bg-red-100"
                                    data-testid={`del-ball-size-${idx}`}
                                    title="Slett denne ballstørrelsen">
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                              <span className="text-[9px] text-red-700">Slett str</span>
                            </Button>
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
      <ViewQrDialog open={!!viewFor} onOpenChange={(o) => !o && setViewFor(null)} viewFor={viewFor} onDeleted={load} />
      <ImportPreviewDialog
        open={!!importPreview}
        preview={importPreview}
        file={pendingImportFile}
        onClose={() => { setImportPreview(null); setPendingImportFile(null); }}
        onDone={() => { load(); setImportPreview(null); setPendingImportFile(null); }}
      />

      {!hasFeature("qr_codes") && hasPerm("inventory", "read") && (
        <UpgradeCTA feature="qr_codes" inline />
      )}
    </div>
  );
}
