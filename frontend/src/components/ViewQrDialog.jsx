import React, { useEffect, useState, useMemo } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Printer, QrCode, Download, Trash2 } from "lucide-react";

const PRINT_SIZES = [
  { key: "small",  label: "Liten (2 cm)",   mm: 20 },
  { key: "medium", label: "Medium (6 cm)",  mm: 60 },
  { key: "large",  label: "Stor (10 cm)",   mm: 100 },
];

/**
 * ViewQrDialog – viser nøyaktig én QR-kode for den valgte varelinjen og lar brukeren
 * velge hvor mange kopier som skal skrives ut:
 *   - 1 kopi
 *   - antall = beholdning
 *   - antall = beholdning + 2 hyllemerker
 *
 * Props:
 *   viewFor: { item, size?, jersey_number?, quantity? } eller null
 *   onDeleted: callback etter at QR er slettet (så Inventory kan reloade)
 */
export default function ViewQrDialog({ open, onOpenChange, viewFor, onDeleted }) {
  const [data, setData] = useState(null);
  const [printSize, setPrintSize] = useState("medium");
  const [copiesMode, setCopiesMode] = useState("one");  // one | stock | stock_plus_two
  const [busy, setBusy] = useState(false);

  const item = viewFor?.item || null;
  const sizeFilter = viewFor?.size || null;
  const stock = (() => {
    if (!viewFor) return 0;
    if (typeof viewFor.quantity === "number") return viewFor.quantity;
    if (sizeFilter) {
      const s = (item?.sizes || []).find((x) => x.size === sizeFilter);
      return s?.quantity || 0;
    }
    return item?.total_stock || 0;
  })();

  const load = () => {
    if (!item) return;
    setData(null);
    api.get(`/items/${item.id}/qr-images`)
      .then((r) => setData(r.data))
      .catch((e) => toast.error(formatError(e.response?.data?.detail)));
  };

  useEffect(() => {
    if (!open || !item) { setData(null); return; }
    load();
  }, [open, item?.id]);

  // Finn akkurat den QR-koden som matcher varelinjen
  const code = useMemo(() => {
    const list = data?.qr_codes || [];
    if (sizeFilter) return list.find((q) => q.size === sizeFilter) || null;
    return list.find((q) => !q.size) || null;
  }, [data, sizeFilter]);

  const copyCount = useMemo(() => {
    if (copiesMode === "one") return 1;
    if (copiesMode === "stock") return Math.max(1, stock);
    if (copiesMode === "stock_plus_two") return Math.max(1, stock) + 2;
    return 1;
  }, [copiesMode, stock]);

  const downloadPdf = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (sizeFilter) {
        params.set("scope", "variant");
        params.set("value", item.id);
        params.set("variant_size", sizeFilter);
      } else {
        params.set("scope", "item");
        params.set("value", item.id);
      }
      params.set("size", printSize);
      params.set("copies", String(copyCount));
      const res = await api.get(`/inventory/qr-labels?${params.toString()}`, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (item.name || "qr").replace(/[^A-Za-z0-9]+/g, "_");
      const szTag = sizeFilter ? `_${sizeFilter}` : "";
      a.download = `qr_${safe}${szTag}_x${copyCount}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const printOne = () => {
    if (!code) return;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Blokkert av popup-blokkerer – tillat popup og prøv igjen"); return; }
    const mm = PRINT_SIZES.find((p) => p.key === printSize).mm;
    const copies = Array.from({ length: copyCount }).map(() => `
      <div class="card">
        <img src="${code.data_url}" alt="QR" />
        <div class="meta">
          <div class="varenr">${code.full_number || ""}</div>
          <div class="name">${item?.name || ""}${sizeFilter ? ` (${sizeFilter})` : ""}</div>
        </div>
      </div>
    `).join("");
    const html = `
      <html><head><title>QR: ${item?.name || ""}</title>
      <style>
        @page { margin: 10mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 10mm; }
        .grid { display: flex; flex-wrap: wrap; gap: 6mm; }
        .card { page-break-inside: avoid; border: 1px solid #999; padding: 3mm; border-radius: 2mm; text-align: center; background: #fff; }
        .card img { width: ${mm}mm; height: ${mm}mm; display: block; margin: 0 auto; }
        .meta .varenr { font-weight: bold; font-family: monospace; font-size: 11pt; margin-top: 2mm; }
        .meta .name { font-size: 9pt; color: #333; }
      </style></head><body>
      <div class="grid">${copies}</div>
      </body></html>`;
    w.document.write(html); w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const downloadPng = () => {
    if (!code) return;
    const a = document.createElement("a");
    a.href = code.data_url;
    const szTag = sizeFilter ? `_${sizeFilter}` : "";
    a.download = `qr_${(item?.name || "qr").replace(/[^A-Za-z0-9]+/g, "_")}${szTag}.png`;
    a.click();
  };

  const deleteThisQr = async () => {
    if (!item) return;
    const label = sizeFilter
      ? `QR-kode for ${item.name} (${sizeFilter})`
      : `QR-kode for ${item.name}`;
    if (!window.confirm(`Er du sikker på at du vil slette ${label}?\n\nDenne handlingen kan ikke angres – men du kan generere ny QR senere.`)) return;
    setBusy(true);
    try {
      const params = sizeFilter ? `?size=${encodeURIComponent(sizeFilter)}` : "";
      await api.delete(`/items/${item.id}/qr${params}`);
      toast.success("QR-kode slettet");
      onDeleted?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />QR-kode</DialogTitle>
          <DialogDescription>
            {item?.name}{sizeFilter ? ` – ${sizeFilter}` : ""}{" "}
            <span className="text-slate-500">· Beholdning: {stock}</span>
          </DialogDescription>
        </DialogHeader>

        {!code ? (
          <div className="text-center py-6 text-slate-500 text-sm">Ingen QR-kode funnet for denne varelinjen.</div>
        ) : (
          <>
            <div className="flex flex-col items-center bg-slate-50 border border-slate-200 rounded-md p-4">
              <img src={code.data_url} alt={code.label} className="w-48 h-48" data-testid="single-qr-image" />
              <div className="font-mono font-bold text-lg mt-2">{code.full_number || "-"}</div>
              <div className="text-xs text-slate-500">{item?.name}{sizeFilter ? ` – ${sizeFilter}` : ""}</div>
            </div>

            <div className="space-y-3 mt-4">
              <div>
                <Label className="text-sm font-semibold">Antall kopier</Label>
                <Select value={copiesMode} onValueChange={setCopiesMode}>
                  <SelectTrigger data-testid="copies-mode-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one">1 kopi</SelectItem>
                    <SelectItem value="stock">Antall = beholdning ({Math.max(1, stock)})</SelectItem>
                    <SelectItem value="stock_plus_two">Antall = beholdning + 2 hyllemerker ({Math.max(1, stock) + 2})</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500 mt-1">Totalt skrives det ut <span className="font-semibold">{copyCount}</span> {copyCount === 1 ? "kopi" : "kopier"}.</p>
              </div>
              <div>
                <Label className="text-sm font-semibold">Utskriftsstørrelse</Label>
                <Select value={printSize} onValueChange={setPrintSize}>
                  <SelectTrigger data-testid="print-size-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRINT_SIZES.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Lukk</Button>
          {code && (
            <>
              <Button variant="outline" onClick={deleteThisQr} disabled={busy} className="text-red-700 border-red-200 hover:bg-red-50" data-testid="delete-qr-btn">
                <Trash2 className="h-4 w-4 mr-1" />Slett QR
              </Button>
              <Button variant="outline" onClick={downloadPng} disabled={busy} data-testid="download-qr-png">
                <Download className="h-4 w-4 mr-1" />Last ned PNG
              </Button>
              <Button variant="outline" onClick={downloadPdf} disabled={busy} data-testid="download-qr-pdf">
                <Download className="h-4 w-4 mr-1" />Last ned PDF ({copyCount})
              </Button>
              <Button onClick={printOne} disabled={busy} className="bg-red-900 hover:bg-red-800" data-testid="print-qr-btn">
                <Printer className="h-4 w-4 mr-1" />Skriv ut ({copyCount})
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
