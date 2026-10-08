import React, { useState, useEffect } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Trash2, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { nb } from "date-fns/locale";
import { format } from "date-fns";
import { sortSizesNatural } from "@/lib/sizeSort";

const newLine = () => ({ item_id: "", quantity: 1, size: "", jersey_number: "", due_date: null, notes: "" });
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

function DatePicker({ value, onChange, placeholder = "Velg dato", testid, label }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value || new Date());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start text-left font-normal" data-testid={testid}>
          <CalendarIcon className="h-4 w-4 mr-2 shrink-0" />
          {value ? format(value, "d. MMMM yyyy", { locale: nb }) : <span className="text-slate-400">{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-2 flex items-center gap-2 border-b border-slate-100">
          <Select value={String(month.getFullYear())}
                  onValueChange={(v) => { const d = new Date(month); d.setFullYear(parseInt(v)); setMonth(d); }}>
            <SelectTrigger className="h-8 w-24" aria-label="Velg årstall"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) =>
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(month.getMonth())}
                  onValueChange={(v) => { const d = new Date(month); d.setMonth(parseInt(v)); setMonth(d); }}>
            <SelectTrigger className="h-8 flex-1" aria-label="Velg måned"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["Januar","Februar","Mars","April","Mai","Juni","Juli","August","September","Oktober","November","Desember"].map((m, i) =>
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Calendar mode="single" selected={value || undefined} month={month}
                   onMonthChange={setMonth}
                   onSelect={(d) => { if (d) { onChange(d); setOpen(false); } }}
                   locale={nb} initialFocus />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Unified LoanDialog brukt fra Teams, People, Scan og Loans.
 * props:
 *  open, onOpenChange, items[], teams[], people[], onSaved
 *  context: { title, mode: "team"|"person"|"item", teamId, personId, itemId, size }
 *  Når context.itemId er satt (fra scan), legges første linje med forhåndsvalgt vare.
 */
export default function LoanDialog({ open, onOpenChange, items = [], teams = [], people = [], context = {}, onSaved }) {
  const [common, setCommon] = useState({
    mode: "loan", charge_price: true, loan_target: "person",
    team_id: "none", person_id: "none",
    due_mode: "same", common_due_date: addDays(new Date(), 30),
  });
  const [lines, setLines] = useState([newLine()]);

  useEffect(() => {
    if (!open) return;
    setCommon((c) => ({
      ...c,
      mode: "loan", charge_price: true,
      loan_target: context.teamId ? "team" : (context.personId ? "person" : "person"),
      team_id: context.teamId || "none",
      person_id: context.personId || "none",
      due_mode: "same", common_due_date: addDays(new Date(), 30),
    }));
    setLines([{ ...newLine(), item_id: context.itemId || "", size: context.size || "" }]);
  }, [open, context.teamId, context.personId, context.itemId, context.size]);

  const setLineField = (idx, field, value) => {
    const arr = [...lines]; arr[idx] = { ...arr[idx], [field]: value };
    if (field === "item_id") { arr[idx].size = ""; arr[idx].jersey_number = ""; }
    setLines(arr);
  };
  const addLine = () => setLines([...lines, newLine()]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const save = async () => {
    const prepared = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.item_id) { toast.error(`Linje ${i+1}: velg vare`); return; }
      const q = parseInt(l.quantity, 10) || 0;
      if (q < 1) { toast.error(`Linje ${i+1}: antall må være minst 1`); return; }
      const item = items.find((x) => x.id === l.item_id);
      if ((item?.is_clothing || item?.is_ball) && !l.size) { toast.error(`Linje ${i+1}: velg størrelse`); return; }
      const due = common.due_mode === "per_line" ? (l.due_date || common.common_due_date) : common.common_due_date;
      prepared.push({
        item_id: l.item_id, quantity: q,
        size: l.size || null, jersey_number: l.jersey_number || null,
        team_id: common.team_id === "none" ? null : common.team_id,
        person_id: common.person_id === "none" ? null : common.person_id,
        mode: common.mode, charge_price: common.charge_price,
        loan_target: common.loan_target,
        due_date: due.toISOString(),
        notes: l.notes || "",
      });
    }
    try {
      for (const p of prepared) await api.post("/loans", p);
      toast.success(`${prepared.length} ${prepared.length === 1 ? "linje" : "linjer"} registrert`);
      onOpenChange(false);
      onSaved && onSaved();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const titleBase = context.title || (context.teamId ? "Nytt utlån til lag" : context.personId ? "Nytt utlån til person" : "Nytt utlån");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleBase}</DialogTitle>
          <DialogDescription>Legg til flere varer, velg utlån eller utlevering, og egen frist per linje om ønskelig.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Modus + ladning */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-slate-200 rounded-md p-3">
              <Label className="text-sm font-semibold mb-2 block">Type registrering</Label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCommon({ ...common, mode: "loan", charge_price: true })}
                        className={`py-2 px-3 rounded-md text-sm font-semibold transition flex flex-col items-center gap-1 ${common.mode === "loan" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`}
                        data-testid="mode-loan-btn">
                  <span>Utlån</span>
                  <span className="text-[10px] font-normal opacity-80">skal returneres</span>
                </button>
                <button type="button" onClick={() => setCommon({ ...common, mode: "handout" })}
                        className={`py-2 px-3 rounded-md text-sm font-semibold transition flex flex-col items-center gap-1 ${common.mode === "handout" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`}
                        data-testid="mode-handout-btn">
                  <span>Utlevering</span>
                  <span className="text-[10px] font-normal opacity-80">beholdes</span>
                </button>
              </div>
            </div>
            {common.mode === "handout" && (
              <div className="border border-slate-200 rounded-md p-3 flex items-center gap-2">
                <Switch checked={common.charge_price} onCheckedChange={(v) => setCommon({ ...common, charge_price: v })} data-testid="charge-price-switch" />
                <div>
                  <Label className="text-sm font-semibold cursor-pointer">Legg til pris som skyldig beløp</Label>
                  <p className="text-[11px] text-slate-500">Slås av for forbruksvarer uten kostnad</p>
                </div>
              </div>
            )}
          </div>

          {/* Target */}
          <div className="border border-slate-200 rounded-md p-3 bg-red-50/40">
            <Label className="text-sm font-semibold mb-2 block">Skyldig beløp belastes</Label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setCommon({ ...common, loan_target: "person" })}
                      className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.loan_target === "person" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`}
                      data-testid="target-person-btn">Person</button>
              <button type="button" onClick={() => setCommon({ ...common, loan_target: "team" })}
                      className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.loan_target === "team" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`}
                      data-testid="target-team-btn">Lag</button>
            </div>
            <p className="text-[11px] text-slate-600 mt-1.5">{common.loan_target === "team" ? "Gjelden havner på laget" : "Gjelden havner på personen som henter"}</p>
          </div>

          {/* Lag + person */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Lag (valgfri)</Label>
              <Select value={common.team_id} onValueChange={(v) => setCommon({ ...common, team_id: v })}>
                <SelectTrigger aria-label="Velg lag" data-testid="loan-team-select"><SelectValue placeholder="Ingen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen lag</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name} {t.age_class && `(${t.age_class})`}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 mt-1">Hvilket lag utstyret tilhører</p>
            </div>
            <div>
              <Label>Hentet av (person)</Label>
              <Select value={common.person_id} onValueChange={(v) => setCommon({ ...common, person_id: v })}>
                <SelectTrigger aria-label="Velg person" data-testid="loan-person-select"><SelectValue placeholder="Ingen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen person</SelectItem>
                  {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 mt-1">Personen som fysisk henter utstyret</p>
            </div>
          </div>

          {/* Frist-modus */}
          <div className="border border-slate-200 rounded-md p-3">
            <Label className="text-sm font-semibold">Frist for innlevering</Label>
            <div className="grid grid-cols-2 gap-2 mt-2 mb-3">
              <button type="button" onClick={() => setCommon({ ...common, due_mode: "same" })}
                      className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.due_mode === "same" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`}
                      data-testid="due-mode-same">Felles for alle linjer</button>
              <button type="button" onClick={() => setCommon({ ...common, due_mode: "per_line" })}
                      className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.due_mode === "per_line" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`}
                      data-testid="due-mode-per-line">Egen frist pr linje</button>
            </div>
            {common.due_mode === "same" && (
              <>
                <Label className="text-xs text-slate-500">Felles innleveringsdato</Label>
                <DatePicker value={common.common_due_date} onChange={(d) => setCommon({ ...common, common_due_date: d })} testid="common-due-date" />
              </>
            )}
            {common.due_mode === "per_line" && (
              <p className="text-xs text-slate-500">Fyll inn frist pr linje under. Blank = bruk felles ({format(common.common_due_date, "d. MMM yyyy", { locale: nb })}).</p>
            )}
          </div>

          {/* Varelinjer */}
          <div className="border border-slate-200 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Varelinjer ({lines.length})</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine} data-testid="add-loan-line">
                <Plus className="h-3 w-3 mr-1" />Legg til vare
              </Button>
            </div>
            <div className="space-y-3">
              {lines.map((line, idx) => {
                const item = items.find((i) => i.id === line.item_id);
                const hasSize = !!(item?.is_clothing || item?.is_ball);
                return (
                  <div key={idx} className="border border-slate-200 rounded-md p-3 bg-slate-50/60" data-testid={`loan-line-${idx}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-xs font-bold text-slate-500">Linje {idx + 1}</div>
                      {lines.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(idx)} data-testid={`remove-line-${idx}`}
                                className="flex flex-col items-center h-auto py-1">
                          <Trash2 className="h-3 w-3 text-red-600" />
                          <span className="text-[9px] text-red-600">Fjern</span>
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                      <div className="sm:col-span-3">
                        <Label className="text-[11px]">Vare</Label>
                        <Select value={line.item_id} onValueChange={(v) => setLineField(idx, "item_id", v)}>
                          <SelectTrigger aria-label={`Velg vare for linje ${idx+1}`} data-testid={`line-item-${idx}`}><SelectValue placeholder="Velg vare" /></SelectTrigger>
                          <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({nok(i.price)})</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {hasSize && (
                        <div>
                          <Label className="text-[11px]">Størrelse</Label>
                          <Select value={line.size} onValueChange={(v) => {
                            const s = (item.sizes || []).find((x) => x.size === v);
                            const arr = [...lines]; arr[idx] = { ...arr[idx], size: v, jersey_number: s?.jersey_number || (item.is_ball ? "" : "X") };
                            setLines(arr);
                          }}>
                            <SelectTrigger aria-label="Velg størrelse"><SelectValue placeholder="Str" /></SelectTrigger>
                            <SelectContent>{sortSizesNatural((item.sizes || []), (s) => s.size).map((s) => <SelectItem key={s.size} value={s.size}>{s.size} ({s.quantity})</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      )}
                      {hasSize && item?.is_clothing && (
                        <div>
                          <Label className="text-[11px]">Draktnr</Label>
                          <Input value={line.jersey_number} onChange={(e) => setLineField(idx, "jersey_number", e.target.value)} aria-label="Draktnummer" />
                        </div>
                      )}
                      <div>
                        <Label className="text-[11px]">Antall</Label>
                        <Input type="number" min="1" value={line.quantity} onChange={(e) => setLineField(idx, "quantity", e.target.value)} aria-label="Antall" data-testid={`line-qty-${idx}`} />
                      </div>
                    </div>
                    {common.due_mode === "per_line" && (
                      <div className="mt-2">
                        <Label className="text-[11px]">Frist (overstyrer felles)</Label>
                        <DatePicker value={line.due_date} onChange={(d) => setLineField(idx, "due_date", d)}
                                     placeholder={`Felles: ${format(common.common_due_date, "d. MMM yyyy", { locale: nb })}`}
                                     testid={`line-due-${idx}`} />
                      </div>
                    )}
                    <div className="mt-2">
                      <Label className="text-[11px]">Notat (valgfri)</Label>
                      <Input value={line.notes} onChange={(e) => setLineField(idx, "notes", e.target.value)} aria-label="Notat" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={save} data-testid="save-loan-btn" className="bg-red-900 hover:bg-red-800">
            Registrer {lines.length} {lines.length === 1 ? "linje" : "linjer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
