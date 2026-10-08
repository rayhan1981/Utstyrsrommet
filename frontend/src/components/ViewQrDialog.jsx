import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Printer, QrCode, Download, Plus } from "lucide-react";

const PRINT_SIZES = [
  { key: "small",  label: "Liten (30 mm)",  mm: 30 },
  { key: "medium", label: "Medium (50 mm)", mm: 50 },
  { key: "large",  label: "Stor (80 mm)",   mm: 80 },
];

export default function ViewQrDialog({ open, onOpenChange, item }) {
  const [data, setData] = useState(null);
  const [printSize, setPrintSize] = useState("medium");
  const [busy, setBusy] = useState(false);

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

  const generateAll = async () => {
    setBusy(true);
    try {
      await api.post(`/items/${item.id}/generate-qr`, {});
      toast.success("QR-koder generert");
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const generateOne = async (size) => {
    setBusy(true);
    try {
      await api.post(`/items/${item.id}/generate-qr`, { sizes: [size] });
      toast.success(`QR for ${size} generert`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const downloadOne = (code) => {
    const a = document.createElement("a");
    a.href = code.data_url;
    const sz = code.size ? `_${code.size}` : "";
    a.download = `qr_${item?.name?.replace(/[^A-Za-z0-9]+/g, "_")}${sz}.png`;
    a.click();
  };

  const printAll = () => {
    const w = window.open("", "_blank");
    if (!w) { toast.error("Blokkert av popup-blokkerer – tillat popup og prøv igjen"); return; }
    const mm = PRINT_SIZES.find((p) => p.key === printSize).mm;
    const html = `
      <html><head><title>QR-koder: ${data?.item?.name}</title>
      <style>
        @page { margin: 10mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 10mm; }
        .grid { display: flex; flex-wrap: wrap; gap: 8mm; }
        .card { page-break-inside: avoid; border: 1px solid #999; padding: 4mm; border-radius: 2mm; text-align: center; background: #fff; }
        .card img { width: ${mm}mm; height: ${mm}mm; display: block; margin: 0 auto; }
        .meta { font-size: 10pt; margin-top: 2mm; }
        .meta .name { font-weight: bold; }
        .meta .size { font-family: monospace; color: #333; }
      </style></head><body>
      <h2 style="margin-top:0">${data?.item?.name}</h2>
      <div class="grid">
        ${(data?.qr_codes || []).map((q) => `
          <div class="card">
            <img src="${q.data_url}" alt="QR" />
            <div class="meta">
              <div class="name">${data?.item?.name || ""}</div>
              <div class="size">${q.size ? "Str: " + q.size : ""} ${q.jersey_number && q.jersey_number !== "X" ? " #" + q.jersey_number : ""}</div>
            </div>
          </div>
        `).join("")}
      </div>
      </body></html>`;
    w.document.write(html); w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const codes = data?.qr_codes || [];
  const isVariantItem = !!(item?.is_clothing || item?.is_ball);
  const sortedCodes = isVariantItem
    ? [...codes].sort((a, b) => {
        const ka = (a.size || "").trim();
        const kb = (b.size || "").trim();
        // Numeric first
        const na = /^\d+$/.test(ka) ? parseInt(ka) : null;
        const nb = /^\d+$/.test(kb) ? parseInt(kb) : null;
        if (na != null && nb != null) return na - nb;
        if (na != null) return -1;
        if (nb != null) return 1;
        return ka.localeCompare(kb);
      })
    : codes;
  const missingSizes = isVariantItem
    ? (item?.sizes || []).filter((s) => !codes.some((c) => c.size === s.size))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />QR-koder for {data?.item?.name || "..."}</DialogTitle>
          <DialogDescription>
            {codes.length === 0 ? "Ingen QR-koder er generert ennå." : `${codes.length} aktiv${codes.length === 1 ? "" : "e"} QR-kode${codes.length === 1 ? "" : "r"}`}
          </DialogDescription>
        </DialogHeader>

        {codes.length === 0 && (
          <div className="border border-amber-200 bg-amber-50 rounded-md p-4 text-sm space-y-3">
            <p>Ingen QR-koder er opprettet for denne varen ennå.</p>
            <Button onClick={generateAll} disabled={busy} className="bg-red-900 hover:bg-red-800" data-testid="generate-qr-inline">
              <Plus className="h-4 w-4 mr-1" />Opprett QR-koder nå
            </Button>
          </div>
        )}

        {codes.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <Label className="text-sm font-semibold">Utskriftsstørrelse</Label>
              <Select value={printSize} onValueChange={setPrintSize}>
                <SelectTrigger className="w-48" aria-label="Velg utskriftsstørrelse" data-testid="print-size-select"><SelectValue /></SelectTrigger>
                <SelectContent>{PRINT_SIZES.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="view-qr-grid">
              {sortedCodes.map((q, idx) => (
                <div key={idx} className="border border-slate-200 rounded-md p-3 text-center bg-white">
                  <img src={q.data_url} alt={q.label} className="w-full h-auto max-w-[160px] mx-auto" />
                  <div className="font-semibold text-sm mt-2">{q.label}</div>
                  {q.size && <div className="text-xs text-slate-500 font-mono">Str: {q.size}{q.jersey_number && q.jersey_number !== "X" ? ` #${q.jersey_number}` : ""}</div>}
                  <Button variant="outline" size="sm" onClick={() => downloadOne(q)} className="mt-2 flex-col h-auto py-1.5 w-full" data-testid={`dl-qr-${idx}`}>
                    <Download className="h-3 w-3" /><span className="text-[9px]">Last ned</span>
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}

        {missingSizes.length > 0 && (
          <div className="border border-slate-200 rounded-md p-3 mt-4 bg-slate-50">
            <Label className="text-xs font-semibold text-slate-700">Mangler QR for disse variantene:</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {missingSizes.map((s) => (
                <Button key={s.size} variant="outline" size="sm" onClick={() => generateOne(s.size)} disabled={busy}
                        className="flex-col h-auto py-1.5" data-testid={`gen-missing-${s.size}`}>
                  <Plus className="h-3 w-3" />
                  <span className="text-[10px]">Opprett for {s.size}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Lukk</Button>
          {codes.length > 0 && (
            <Button onClick={printAll} className="bg-red-900 hover:bg-red-800" data-testid="print-qr-btn">
              <Printer className="h-4 w-4 mr-2" />Skriv ut alle
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
