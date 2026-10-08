import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Undo2, Trash2, CalendarIcon } from "lucide-react";import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";
import { nb } from "date-fns/locale";
import { format } from "date-fns";

/**
 * Grupper returnerte utlån per «Lag (Årsklasse)». Ingen lag → "Uten lag".
 */
function ReturnedByTeamGrouped({ returned, teams, people, nok, undoReturn }) {
  const groups = {};
  returned.forEach((l) => {
    const team = teams.find((t) => t.id === l.team_id);
    const label = team ? `${team.team_name}${team.age_class ? " · " + team.age_class : ""}` : "Uten lag";
    if (!groups[label]) groups[label] = [];
    groups[label].push(l);
  });
  const sortedKeys = Object.keys(groups).sort();
  return (
    <div className="space-y-4" data-testid="returned-grouped">
      {sortedKeys.map((grpKey) => (
        <div key={grpKey} className="border border-slate-200 rounded-md overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex items-center justify-between">
            <div className="font-semibold text-sm">{grpKey}</div>
            <span className="text-xs text-slate-500">{groups[grpKey].length} retur{groups[grpKey].length === 1 ? "" : "er"}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 bg-slate-50/60 border-b border-slate-100">
                <th className="px-3 py-2">Returnert</th>
                <th className="px-3 py-2">Vare</th>
                <th className="px-3 py-2 text-right">Antall</th>
                <th className="px-3 py-2">Hentet av</th>
                <th className="px-3 py-2">Mottatt av</th>
                {undoReturn && <th className="px-3 py-2 text-right">Handling</th>}
              </tr>
            </thead>
            <tbody>
              {groups[grpKey].map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60" data-testid={`returned-row-${l.id}`}>
                  <td className="px-3 py-2 text-xs">{l.return_date ? new Date(l.return_date).toLocaleDateString("nb-NO") : "-"}</td>
                  <td className="px-3 py-2 font-semibold">{l.item_name}{l.size ? ` (${l.size})` : ""}{l.jersey_number && l.jersey_number !== "X" ? ` #${l.jersey_number}` : ""}</td>
                  <td className="px-3 py-2 text-right">{l.quantity}</td>
                  <td className="px-3 py-2 text-xs">{people.find((p) => p.id === l.person_id)?.name || "-"}</td>
                  <td className="px-3 py-2 text-xs">{people.find((p) => p.id === l.received_by_person_id)?.name || "-"}</td>
                  {undoReturn && (
                    <td className="px-3 py-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => undoReturn(l)} data-testid={`undo-return-${l.id}`}
                              className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                        <Trash2 className="h-3.5 w-3.5 text-red-600" /><span className="text-[9px] text-red-600">Slett retur</span>
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const newLine = () => ({
  item_id: "", quantity: 1, size: "", jersey_number: "",
  due_date: null, // Date|null — null betyr "bruk fellesfrist"
  notes: "",
});

function DatePicker({ value, onChange, placeholder = "Velg dato", testid }) {
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
            <SelectTrigger className="h-8 w-24" data-testid={`${testid}-year`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) =>
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(month.getMonth())}
                  onValueChange={(v) => { const d = new Date(month); d.setMonth(parseInt(v)); setMonth(d); }}>
            <SelectTrigger className="h-8 flex-1" data-testid={`${testid}-month`}><SelectValue /></SelectTrigger>
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

export default function Loans() {
  const { hasPerm } = useAuth();
  const [loans, setLoans] = useState([]);
  const [items, setItems] = useState([]);
  const [teams, setTeams] = useState([]);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(false);
  const [returnFor, setReturnFor] = useState(null);
  const [returnBy, setReturnBy] = useState("");
  const [returnQty, setReturnQty] = useState(1);

  // Fellesfelter for utlån:
  const [common, setCommon] = useState({
    mode: "loan", charge_price: true, loan_target: "person",
    team_id: "none", person_id: "none",
    due_mode: "same", // "same" = én felles frist | "per_line" = pr linje
    common_due_date: addDays(new Date(), 30),
  });
  const [lines, setLines] = useState([newLine()]);

  function addDays(d, days) { const r = new Date(d); r.setDate(r.getDate() + days); return r; }

  const load = async () => {
    const [l, i, t, p] = await Promise.all([api.get("/loans"), api.get("/items"), api.get("/teams"), api.get("/people")]);
    setLoans(l.data); setItems(i.data); setTeams(t.data); setPeople(p.data);
  };
  useEffect(() => { load(); }, []);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const setLineField = (idx, field, value) => {
    const arr = [...lines]; arr[idx] = { ...arr[idx], [field]: value };
    // Nullstill size/jersey hvis vare endres
    if (field === "item_id") { arr[idx].size = ""; arr[idx].jersey_number = ""; }
    setLines(arr);
  };
  const addLine = () => setLines([...lines, newLine()]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));

  const openNew = () => {
    setCommon({ mode: "loan", charge_price: true, loan_target: "person",
                team_id: "none", person_id: "none",
                due_mode: "same", common_due_date: addDays(new Date(), 30) });
    setLines([newLine()]);
    setOpen(true);
  };

  const save = async () => {
    // Valider linjer
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
      // Opprett sekvensielt — holder antall-sjekken korrekt
      for (const p of prepared) await api.post("/loans", p);
      toast.success(`${prepared.length} ${prepared.length === 1 ? "linje" : "linjer"} registrert`);
      setOpen(false); await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const doReturn = async () => {
    try {
      await api.post(`/loans/${returnFor.id}/return`, { quantity: parseInt(returnQty) || 1, received_by_person_id: returnBy || null });
      toast.success("Retur registrert - skyldig beløp oppdatert");
      setReturnFor(null); setReturnBy(""); setReturnQty(1); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };
  const openReturn = (l) => { setReturnFor(l); setReturnQty(l.quantity); setReturnBy(""); };

  const undoReturn = async (l) => {
    const label = `${l.item_name}${l.size ? " (" + l.size + ")" : ""} × ${l.quantity}`;
    const reason = window.prompt(`Slette returen av ${label}?\n\nVarene legges tilbake som UTLÅN på laget, og lagerøkningen reverseres.\n\nBegrunnelse:`);
    if (!reason || !reason.trim()) return;
    try {
      const { data } = await api.post(`/loans/${l.id}/undo-return`, { reason: reason.trim() });
      toast.success(`Retur reversert – ${data.restored_quantity} stk tilbakeført`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const active = loans.filter((l) => l.status === "borrowed");
  const returned = loans.filter((l) => l.status === "returned");

  const loanColumns = [
    { key: "loan_date", label: "Dato", filter: "text", render: (l) => new Date(l.loan_date).toLocaleDateString("nb-NO") },
    { key: "item_name", label: "Vare", filter: "text", render: (l) => (
        <span className="font-semibold">{l.item_name}{l.size ? ` (${l.size})` : ""}{l.jersey_number && l.jersey_number !== "X" ? ` #${l.jersey_number}` : ""}</span>
    ) },
    { key: "quantity", label: "Antall", filter: "number" },
    { key: "team_name", label: "Lag", filter: "text", accessor: (l) => teams.find(t => t.id === l.team_id)?.team_name || "" },
    { key: "person_name", label: "Hentet av", filter: "text", accessor: (l) => people.find(p => p.id === l.person_id)?.name || "" },
    { key: "mode", label: "Type", filter: "select",
      options: [{value:"loan",label:"Utlån"},{value:"handout",label:"Utlevert"}],
      render: (l) => l.mode === "handout" ? "Utlevert" : "Utlånt" },
    { key: "loan_target", label: "Belastes", filter: "select",
      options: [{value:"person",label:"Person"},{value:"team",label:"Lag"}],
      render: (l) => l.loan_target === "team" ? <span className="text-xs">Lag</span> : <span className="text-xs">Person</span> },
    { key: "due_date", label: "Forfall", filter: "text", render: (l) => {
        if (!l.due_date) return "-";
        const d = new Date(l.due_date);
        const overdue = l.status === "borrowed" && d < new Date();
        return <span className={overdue ? "text-red-700 font-semibold" : ""}>{d.toLocaleDateString("nb-NO")}</span>;
    } },
    { key: "amount_owed", label: "Skyldig", filter: "number", render: (l) => <span className={l.amount_owed > 0 ? "text-red-700 font-semibold" : ""}>{nok(l.amount_owed)}</span> },
  ];

  return (
    <div className="space-y-6" data-testid="loans-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Utlån & Retur</h1>
          <p className="text-slate-600 text-sm mt-1">Registrer utlån og utlevering – flere varer og egne frister pr linje</p>
        </div>
        {hasPerm("loans", "write") && (
          <Button onClick={openNew} data-testid="new-loan-btn" className="bg-red-900 hover:bg-red-800">
            <Plus className="h-4 w-4 mr-2" />Nytt utlån / utlevering
          </Button>
        )}
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active">Aktive ({active.length})</TabsTrigger>
          <TabsTrigger value="returned" data-testid="tab-returned">Returnert ({returned.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <Card className="p-3">
            <DataTable
              rows={active}
              emptyLabel="Ingen aktive utlån."
              searchPlaceholder="Søk vare, lag, person…"
              columns={loanColumns}
              actions={(l) => hasPerm("loans", "write") ? (
                <Button variant="outline" size="sm" onClick={() => openReturn(l)} data-testid={`return-btn-${l.id}`} className="flex flex-col items-center h-auto py-1 px-2 gap-0.5">
                  <Undo2 className="h-3.5 w-3.5" /><span className="text-[9px]">Returner</span>
                </Button>
              ) : null}
            />
          </Card>
        </TabsContent>
        <TabsContent value="returned">
          <Card className="p-3">
            {returned.length === 0 ? (
              <div className="text-center text-slate-500 py-6 text-sm">Ingen returnerte utlån.</div>
            ) : (
              <ReturnedByTeamGrouped
                returned={returned}
                teams={teams}
                people={people}
                nok={nok}
                undoReturn={hasPerm("loans", "write") ? undoReturn : null}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nytt utlån / utlevering</DialogTitle>
            <DialogDescription>Legg til flere varer. Velg felles frist eller egen frist per linje.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Felles-innstillinger */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 border border-slate-200 rounded-md p-3">
                <div className="flex-1">
                  <div className="font-semibold text-sm">Modus: {common.mode === "loan" ? "Utlån (lånes ut)" : "Utlevering (gis ut)"}</div>
                  <div className="text-xs text-slate-500">Bytt mellom utlån og utlevering</div>
                </div>
                <Switch checked={common.mode === "handout"} onCheckedChange={(v) => setCommon({ ...common, mode: v ? "handout" : "loan" })} data-testid="loan-mode-switch" />
              </div>
              {common.mode === "handout" && (
                <label className="flex items-center gap-2 text-sm border border-slate-200 rounded-md p-3">
                  <Switch checked={common.charge_price} onCheckedChange={(v) => setCommon({ ...common, charge_price: v })} data-testid="charge-price-switch" />
                  <span>Legg pris til som skyldig beløp</span>
                </label>
              )}
            </div>

            <div className="border border-slate-200 rounded-md p-3 bg-red-50/50">
              <Label className="text-sm font-semibold">Skyldig beløp går til</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button type="button" onClick={() => setCommon({ ...common, loan_target: "person" })} className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.loan_target === "person" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`} data-testid="target-person-btn">Person</button>
                <button type="button" onClick={() => setCommon({ ...common, loan_target: "team" })} className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.loan_target === "team" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`} data-testid="target-team-btn">Lag</button>
              </div>
              <p className="text-xs text-slate-600 mt-1.5">{common.loan_target === "team" ? "Gjelden belastes LAGET." : "Gjelden belastes PERSONEN som henter."}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Lag</Label>
                <Select value={common.team_id} onValueChange={(v) => setCommon({ ...common, team_id: v })}>
                  <SelectTrigger data-testid="loan-team-select"><SelectValue placeholder="Ingen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ingen lag</SelectItem>
                    {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name} {t.age_class && `(${t.age_class})`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hentet av (person)</Label>
                <Select value={common.person_id} onValueChange={(v) => setCommon({ ...common, person_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Ingen" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ingen person</SelectItem>
                    {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Frist-modus */}
            <div className="border border-slate-200 rounded-md p-3">
              <Label className="text-sm font-semibold">Frist for innlevering</Label>
              <div className="grid grid-cols-2 gap-2 mt-2 mb-3">
                <button type="button" onClick={() => setCommon({ ...common, due_mode: "same" })} className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.due_mode === "same" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`} data-testid="due-mode-same">Felles for alle linjer</button>
                <button type="button" onClick={() => setCommon({ ...common, due_mode: "per_line" })} className={`py-2 px-3 rounded-md text-sm font-semibold transition ${common.due_mode === "per_line" ? "bg-red-900 text-white" : "bg-white border border-slate-200 hover:border-red-700"}`} data-testid="due-mode-per-line">Egen frist pr linje</button>
              </div>
              {common.due_mode === "same" && (
                <DatePicker value={common.common_due_date} onChange={(d) => setCommon({ ...common, common_due_date: d })} testid="common-due-date" />
              )}
              {common.due_mode === "per_line" && (
                <p className="text-xs text-slate-500">Fyll inn frist pr linje under. Blank = bruker felles frist ({format(common.common_due_date, "d. MMM yyyy", { locale: nb })}).</p>
              )}
            </div>

            {/* Varelinjer */}
            <div className="border border-slate-200 rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">Varelinjer ({lines.length})</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine} data-testid="add-loan-line">
                  <Plus className="h-3 w-3 mr-1" />Legg til linje
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
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(idx)} data-testid={`remove-line-${idx}`}>
                            <Trash2 className="h-3 w-3 text-red-600" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                        <div className="sm:col-span-3">
                          <Label className="text-[11px]">Vare</Label>
                          <Select value={line.item_id} onValueChange={(v) => setLineField(idx, "item_id", v)}>
                            <SelectTrigger data-testid={`line-item-${idx}`}><SelectValue placeholder="Velg vare" /></SelectTrigger>
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
                              <SelectTrigger><SelectValue placeholder="Str" /></SelectTrigger>
                              <SelectContent>{(item.sizes || []).map((s) => <SelectItem key={s.size} value={s.size}>{s.size} ({s.quantity})</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        )}
                        {hasSize && item?.is_clothing && (
                          <div>
                            <Label className="text-[11px]">Draktnr</Label>
                            <Input value={line.jersey_number} onChange={(e) => setLineField(idx, "jersey_number", e.target.value)} />
                          </div>
                        )}
                        <div>
                          <Label className="text-[11px]">Antall</Label>
                          <Input type="number" min="1" value={line.quantity} onChange={(e) => setLineField(idx, "quantity", e.target.value)} data-testid={`line-qty-${idx}`} />
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
                        <Input value={line.notes} onChange={(e) => setLineField(idx, "notes", e.target.value)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} data-testid="save-loan-btn" className="bg-red-900 hover:bg-red-800">
              Registrer {lines.length} {lines.length === 1 ? "linje" : "linjer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!returnFor} onOpenChange={() => setReturnFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrer retur</DialogTitle>
            <DialogDescription>{returnFor?.item_name} × {returnFor?.quantity}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Antall innlevert</Label><Input type="number" min="1" max={returnFor?.quantity} value={returnQty} onChange={(e) => setReturnQty(e.target.value)} /></div>
            <div>
              <Label>Mottatt av</Label>
              <Select value={returnBy} onValueChange={setReturnBy}>
                <SelectTrigger data-testid="return-received-by"><SelectValue placeholder="Velg person" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnFor(null)}>Avbryt</Button>
            <Button onClick={doReturn} data-testid="confirm-return-btn" className="bg-red-900 hover:bg-red-800">Bekreft retur</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
