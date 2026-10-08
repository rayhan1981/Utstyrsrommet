import React, { useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * Import-preview-dialog for Excel-lagerimport.
 * Flow:
 *  1. Dialogen tar imot `preview` (fra POST /items/import/preview)
 *  2. Viser varer som skal opprettes/oppdateres + valideringsfeil
 *  3. "Importer nå" sender filen på nytt mot POST /items/import (kun hvis feil=0 eller strict=false)
 */
export default function ImportPreviewDialog({ open, onClose, preview, file, onDone }) {
  const [submitting, setSubmitting] = useState(false);
  if (!preview) return null;
  const hasErrors = (preview.errors || []).length > 0;

  const commit = async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/items/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${data.created} varer importert`);
      onDone?.();
      onClose?.();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Forhåndsvis Excel-import</DialogTitle>
          <DialogDescription>Sjekk at varer og leverandørmatching ser riktig ut før du bekrefter.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3">
            <div className="text-xs text-emerald-700 font-semibold">Varer</div>
            <div className="text-2xl font-bold text-emerald-900" data-testid="preview-item-count">{preview.total_items}</div>
          </div>
          <div className="bg-sky-50 border border-sky-200 rounded-md p-3">
            <div className="text-xs text-sky-700 font-semibold">Varianter</div>
            <div className="text-2xl font-bold text-sky-900">{preview.total_variants}</div>
          </div>
          <div className={`${hasErrors ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"} border rounded-md p-3`}>
            <div className={`text-xs font-semibold ${hasErrors ? "text-red-700" : "text-slate-700"}`}>Feil</div>
            <div className={`text-2xl font-bold ${hasErrors ? "text-red-900" : "text-slate-500"}`} data-testid="preview-error-count">{(preview.errors || []).length}</div>
          </div>
        </div>

        {hasErrors && (
          <div className="border border-red-200 rounded-md overflow-hidden">
            <div className="bg-red-50 px-3 py-2 font-semibold text-sm text-red-900 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />Valideringsfeil – disse radene vil IKKE bli importert
            </div>
            <div className="max-h-[180px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Rad</TableHead><TableHead>Felt</TableHead><TableHead>Feil</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(preview.errors || []).map((e, i) => (
                    <TableRow key={i}><TableCell className="text-xs">{e.row}</TableCell><TableCell className="text-xs">{e.field}</TableCell><TableCell className="text-xs text-red-700">{e.error}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 font-semibold text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" />Varer klare for import ({preview.items.length})
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Vare</TableHead><TableHead>Kategori</TableHead><TableHead>Type</TableHead>
                <TableHead className="text-right">Varianter</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead>Leverandør</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {preview.items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-6 text-sm">Ingen varer å importere.</TableCell></TableRow>}
                {preview.items.map((it, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-semibold text-sm">{it.name}
                      {it.will_update && <span className="ml-2 text-[9px] font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded">finnes allerede</span>}
                    </TableCell>
                    <TableCell className="text-xs">{it.category}{it.main_group ? ` · ${it.main_group}` : ""}{it.sub_group ? ` · ${it.sub_group}` : ""}</TableCell>
                    <TableCell className="text-xs">{it.type}</TableCell>
                    <TableCell className="text-right text-xs">{it.variant_count}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{it.total_stock}</TableCell>
                    <TableCell className="text-xs">{it.supplier_name ? `#${it.supplier_number} ${it.supplier_name}` : <span className="text-slate-400">–</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={commit} disabled={submitting || preview.items.length === 0}
                  className="bg-red-900 hover:bg-red-800" data-testid="confirm-import-btn">
            <Upload className="h-4 w-4 mr-2" />
            {submitting ? "Importerer…" : `Importer ${preview.items.length} varer`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
