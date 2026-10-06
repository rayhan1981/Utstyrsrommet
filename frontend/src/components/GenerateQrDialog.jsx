import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { QrCode } from "lucide-react";

/**
 * Dialog for å generere QR-koder for en spesifikk vare.
 * - For sizeless-varer (type=vare): én knapp som genererer.
 * - For sized-varer (klær/ball): avkrysningsboks pr størrelse + "Alle".
 */
export default function GenerateQrDialog({ open, onOpenChange, item, onDone }) {
  const [selectedSizes, setSelectedSizes] = useState([]);

  const sized = !!(item && (item.is_clothing || item.is_ball));
  const sizes = item?.sizes || [];

  useEffect(() => {
    if (!open || !item) return;
    if (sized) {
      // forhåndsvalg: alle størrelser som ennå ikke har QR
      const toGen = sizes.filter((s) => !s.has_qr).map((s) => s.size);
      setSelectedSizes(toGen.length > 0 ? toGen : sizes.map((s) => s.size));
    }
  }, [open, item, sized, sizes]);

  const toggle = (sz) => setSelectedSizes((xs) => xs.includes(sz) ? xs.filter((x) => x !== sz) : [...xs, sz]);
  const toggleAll = (val) => setSelectedSizes(val ? sizes.map((s) => s.size) : []);
  const allSelected = sized && sizes.length > 0 && selectedSizes.length === sizes.length;

  const submit = async () => {
    try {
      const body = sized ? { sizes: selectedSizes } : {};
      await api.post(`/items/${item.id}/generate-qr`, body);
      if (sized) {
        toast.success(`QR-koder generert for ${selectedSizes.length} størrels${selectedSizes.length === 1 ? "e" : "er"} av ${item.name}`);
      } else {
        toast.success(`QR-kode generert for ${item.name}`);
      }
      onOpenChange(false);
      onDone && onDone();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />Generer QR-kode</DialogTitle>
          <DialogDescription>{item.name}</DialogDescription>
        </DialogHeader>

        {sized ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Hver størrelse får sin egen unike QR-kode. Velg hvilke du vil generere:</p>
            <label className="flex items-center gap-2 py-1 border-b border-slate-200">
              <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} data-testid="gen-qr-all" />
              <span className="font-semibold text-sm">Alle størrelser ({sizes.length})</span>
            </label>
            <div className="max-h-60 overflow-y-auto">
              {sizes.map((s) => (
                <label key={s.size} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer hover:bg-slate-50 px-1 rounded">
                  <Checkbox checked={selectedSizes.includes(s.size)} onCheckedChange={() => toggle(s.size)} data-testid={`gen-qr-size-${s.size}`} />
                  <span className="font-mono">{s.size}</span>
                  <span className="text-slate-500 text-xs">(lager: {s.quantity})</span>
                  {s.has_qr && <span className="ml-auto text-red-700 text-xs">✓ allerede generert</span>}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Dette vil generere én unik QR-kode for varen.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button
            onClick={submit}
            className="bg-red-900 hover:bg-red-800"
            disabled={sized && selectedSizes.length === 0}
            data-testid="gen-qr-submit"
          >
            Generer{sized ? ` (${selectedSizes.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
