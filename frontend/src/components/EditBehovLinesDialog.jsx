import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Save, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { sortSizesNatural } from "@/lib/sizeSort";

const VARETYPER = ["Fotball", "Håndball", "Drakt", "Trenings-topp", "Shorts", "Jakke", "Målvaktsutstyr", "Markering", "Kjegler", "Vester", "Førstehjelp", "Annet"];

/**
 * Rediger-dialog for utfylt behovsskjema (draft_lines).
 * Lar bruker rette feil, legge til nye linjer, slette linjer før bekreftelse.
 * `schema` er behovsskjema med draft_lines. `items` er varer-katalogen.
 */
export default function EditBehovLinesDialog({ open, onClose, schema, items, onSaved, onConfirmed }) {
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open && schema) setLines((schema.draft_lines || []).map((l) => ({ ...l })));
  }, [open, schema]);

  const addLine = () => setLines([...lines, {
    line_id: Math.random().toString(36).slice(2),
    item_type: "", item_name: "", item_id: null,
    size: null, jersey_number: null, quantity: 1, comment: "", errors: [],
  }]);

  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));

  const updateLine = (idx, field, val) => {
    const newLines = [...lines];
    newLines[idx] = { ...newLines[idx], [field]: val };
    // Auto-fyll item_name når item_id endres
    if (field === "item_id") {
      const it = items.find((i) => i.id === val);
      if (it) newLines[idx].item_name = it.name;
    }
    setLines(newLines);
  };

  const errCount = useMemo(() => lines.filter((l) => (l.errors || []).length > 0).length, [lines]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/behovsskjema/${schema.id}/lines`, { lines });
      setLines(data.lines);
      toast.success(`${data.total} linjer lagret${data.errors_count ? ` – ${data.errors_count} med advarsel` : ""}`);
      onSaved && onSaved();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const confirm = async () => {
    if (errCount > 0) {
      toast.error(`${errCount} linjer har valideringsfeil – fiks dem først`);
      return;
    }
    if (!window.confirm(`Bekreft ${lines.length} linjer som behov for ${schema.team_name}?\n\nSkjemaet blir låst som bekreftet. Kan åpnes igjen senere via «Lås opp».`)) return;
    setConfirming(true);
    try {
      // Lagre først, så bekreft
      await api.put(`/behovsskjema/${schema.id}/lines`, { lines });
      const { data } = await api.post(`/behovsskjema/${schema.id}/confirm`);
      toast.success(`Behov bekreftet – ${data.lines_count} linjer lagret som behov for laget`);
      onConfirmed && onConfirmed();
      onClose && onClose();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setConfirming(false); }
  };

  if (!schema) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rediger behovslinjer – {schema.po_number} · {schema.team_name}</DialogTitle>
          <DialogDescription>
            Alle linjer kan redigeres før skjemaet bekreftes. Linjer uten feil kan bekreftes direkte.
            Når bekreftet låses behovet mot laget.
          </DialogDescription>
        </DialogHeader>

        {errCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-2 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
            <span>{errCount} linjer har valideringsfeil – fiks dem før du bekrefter.</span>
          </div>
        )}

        <div className="border border-slate-200 rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs text-slate-600">
                <th className="px-2 py-2 w-32">Varetype</th>
                <th className="px-2 py-2 w-56">Vare (fra katalog)</th>
                <th className="px-2 py-2 w-20">Str</th>
                <th className="px-2 py-2 w-20">Draktnr</th>
                <th className="px-2 py-2 w-16 text-right">Antall</th>
                <th className="px-2 py-2">Kommentar</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-500 py-6">Ingen linjer. Klikk «Legg til linje» for å legge til manuelt.</td></tr>
              )}
              {lines.map((ln, idx) => {
                const it = items.find((i) => i.id === ln.item_id);
                const hasSizes = !!(it && (it.is_clothing || it.is_ball));
                const sizes = hasSizes ? sortSizesNatural(it.sizes || [], (s) => s.size) : [];
                const hasErr = (ln.errors || []).length > 0;
                return (
                  <tr key={ln.line_id} className={`border-b border-slate-100 last:border-0 ${hasErr ? "bg-red-50/60" : ""}`} data-testid={`behov-edit-row-${idx}`}>
                    <td className="px-2 py-1.5">
                      <Select value={ln.item_type || ""} onValueChange={(v) => updateLine(idx, "item_type", v)}>
                        <SelectTrigger className="h-8 text-xs" data-testid={`row-${idx}-type`}><SelectValue placeholder="–" /></SelectTrigger>
                        <SelectContent>
                          {VARETYPER.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={ln.item_id || ""} onValueChange={(v) => updateLine(idx, "item_id", v)}>
                        <SelectTrigger className="h-8 text-xs" data-testid={`row-${idx}-item`}><SelectValue placeholder={ln.item_name || "Velg vare"} /></SelectTrigger>
                        <SelectContent>
                          {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      {hasSizes ? (
                        <Select value={ln.size || ""} onValueChange={(v) => updateLine(idx, "size", v)}>
                          <SelectTrigger className="h-8 text-xs" data-testid={`row-${idx}-size`}><SelectValue placeholder="–" /></SelectTrigger>
                          <SelectContent>
                            {sizes.map((s) => <SelectItem key={s.size} value={s.size}>{s.size}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input className="h-8 text-xs" value={ln.size || ""} onChange={(e) => updateLine(idx, "size", e.target.value)} placeholder="–" />
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 text-xs font-mono" value={ln.jersey_number || ""} onChange={(e) => updateLine(idx, "jersey_number", e.target.value)} placeholder="–" data-testid={`row-${idx}-jersey`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="number" min="1" max="50" className="h-8 text-xs text-right" value={ln.quantity}
                             onChange={(e) => updateLine(idx, "quantity", parseInt(e.target.value) || 0)} data-testid={`row-${idx}-qty`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 text-xs" value={ln.comment || ""} onChange={(e) => updateLine(idx, "comment", e.target.value)} placeholder="Kommentar" />
                      {hasErr && (
                        <div className="text-[10px] text-red-700 mt-0.5">
                          {(ln.errors || []).join("; ")}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-7 w-7" data-testid={`row-${idx}-del`}>
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={addLine} data-testid="add-line-btn">
            <Plus className="h-4 w-4 mr-1" />Legg til linje
          </Button>
          <span className="text-xs text-slate-500 ml-auto self-center">
            {lines.length} linjer{errCount > 0 ? ` · ${errCount} med feil` : ""}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Lukk</Button>
          <Button variant="outline" onClick={save} disabled={saving} data-testid="save-lines-btn">
            <Save className="h-4 w-4 mr-1" />{saving ? "Lagrer…" : "Lagre endringer"}
          </Button>
          <Button onClick={confirm} disabled={confirming || errCount > 0 || lines.length === 0}
                  className="bg-emerald-700 hover:bg-emerald-800" data-testid="confirm-behov-btn">
            <CheckCircle2 className="h-4 w-4 mr-1" />
            {confirming ? "Bekrefter…" : "Bekreft som behov"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
