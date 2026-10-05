import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Printer, QrCode } from "lucide-react";

/**
 * Dialog som viser alle genererte QR-koder for en vare.
 */
export default function ViewQrDialog({ open, onOpenChange, item }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || !item) { setData(null); return; }
    api.get(`/items/${item.id}/qr-images`)
      .then((r) => setData(r.data))
      .catch((e) => toast.error(formatError(e.response?.data?.detail)));
  }, [open, item]);

  const printAll = () => {
    const w = window.open("", "_blank");
    if (!w) { toast.error("Blokkert av popup-blokkerer"); return; }
    const html = `
      <html><head><title>QR-koder: ${data?.item?.name}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
        .card { text-align: center; page-break-inside: avoid; border: 1px solid #ddd; padding: 10px; border-radius: 6px; }
        .card img { width: 180px; height: 180px; }
        .card div { font-weight: bold; margin-top: 8px; font-size: 14px; }
      </style></head><body>
      <h2>${data?.item?.name}</h2>
      <div class="grid">
        ${(data?.qr_codes || []).map((q) => `<div class="card"><img src="${q.data_url}" alt="QR" /><div>${q.label}</div></div>`).join("")}
      </div>
      </body></html>
    `;
    w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300);
  };

  const codes = data?.qr_codes || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />QR-koder for {data?.item?.name || "..."}</DialogTitle>
          <DialogDescription>{codes.length} aktiv{codes.length === 1 ? "" : "e"} QR-kode{codes.length === 1 ? "" : "r"}</DialogDescription>
        </DialogHeader>

        {codes.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">Ingen QR-koder generert ennå. Bruk «Generer QR»-knappen først.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="view-qr-grid">
            {codes.map((q, idx) => (
              <div key={idx} className="border border-slate-200 rounded-md p-3 text-center bg-white">
                <img src={q.data_url} alt={q.label} className="w-full h-auto max-w-[180px] mx-auto" />
                <div className="font-semibold text-sm mt-2">{q.label}</div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Lukk</Button>
          {codes.length > 0 && (
            <Button onClick={printAll} className="bg-emerald-900 hover:bg-emerald-800" data-testid="print-qr-btn">
              <Printer className="h-4 w-4 mr-2" />Skriv ut
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
