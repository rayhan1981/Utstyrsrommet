import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Plus, Eye, HandCoins, FileText } from "lucide-react";
import LoanDialog from "@/components/LoanDialog";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";
import InvoiceDialog from "@/components/InvoiceDialog";

export default function People() {
  const { hasPerm } = useAuth();
  const [people, setPeople] = useState([]);
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", team_ids: [] });
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loanFor, setLoanFor] = useState(null);
  const [loanForm, setLoanForm] = useState({ item_id: "", quantity: 1, team_id: "none", size: "", jersey_number: "", notes: "" });
  const [invoiceFor, setInvoiceFor] = useState(null);

  const load = async () => {
    const [p, t, i] = await Promise.all([api.get("/people"), api.get("/teams"), api.get("/items")]);
    setPeople(p.data); setTeams(t.data); setItems(i.data);
  };
  useEffect(() => { load(); }, []);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  const openNew = () => { setEditId(null); setForm({ name: "", phone: "", email: "", team_ids: [] }); setOpen(true); };
  const openEdit = (p) => { setEditId(p.id); setForm({ name: p.name, phone: p.phone || "", email: p.email || "", team_ids: p.team_ids || [] }); setOpen(true); };

  const save = async () => {
    try {
      if (editId) await api.put(`/people/${editId}`, form); else await api.post("/people", form);
      toast.success("Lagret"); setOpen(false); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (id) => {
    if (!window.confirm("Slette denne personen?")) return;
    try { await api.delete(`/people/${id}`); toast.success("Slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const showDetail = async (id) => {
    const { data } = await api.get(`/people/${id}`);
    setDetail(data);
  };

  const toggleTeam = (tid) => {
    const ids = form.team_ids.includes(tid) ? form.team_ids.filter((x) => x !== tid) : [...form.team_ids, tid];
    setForm({ ...form, team_ids: ids });
  };

  const openQuickLoan = (p) => {
    setLoanFor(p);
  };

  const selectedItem = null;

  const submitQuickLoan = async () => {};

  return (
    <div className="space-y-6" data-testid="people-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Personer</h1>
          <p className="text-slate-600 text-sm mt-1">Enkeltpersoner knyttet til ett eller flere lag</p>
        </div>
        {hasPerm("people", "write") && (
          <Button onClick={openNew} data-testid="new-person-btn" className="bg-red-900 hover:bg-red-800">
            <Plus className="h-4 w-4 mr-2" /> Ny person
          </Button>
        )}
      </div>

      <Card className="p-3">
        <DataTable
          rows={people}
          emptyLabel="Ingen personer registrert."
          searchPlaceholder="Søk navn, telefon, epost…"
          columns={[
            { key: "name", label: "Navn", filter: "text", render: (p) => <span className="font-semibold">{p.name}</span> },
            { key: "phone", label: "Telefon", filter: "text", render: (p) => p.phone || "-" },
            { key: "email", label: "Epost", filter: "text", render: (p) => p.email || "-" },
            { key: "team_ids", label: "Lag", filter: "text", groupable: true,
              accessor: (p) => (p.team_ids || []).map(id => teams.find(t => t.id === id)?.team_name).filter(Boolean).join(", "),
              groupLabel: (val) => val ? (teams.find(t => t.id === val)?.team_name || "(Ukjent lag)") : "(Uten lag)",
              render: (p) => <span className="text-xs">{(p.team_ids || []).map(id => teams.find(t => t.id === id)?.team_name).filter(Boolean).join(", ") || "-"}</span> },
            { key: "debt", label: "Skyldig", filter: "number", accessor: (p) => p.debt || 0, render: (p) => <span className={p.debt > 0 ? "text-red-700 font-semibold" : ""}>{nok(p.debt)}</span> },
            { key: "auto_created_from_team", label: "Fra lag?", filter: "boolean", accessor: (p) => !!p.auto_created_from_team, render: (p) => p.auto_created_from_team ? <span className="text-xs text-red-700">Auto</span> : "-" },
          ]}
          actions={(p) => (
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {hasPerm("loans", "write") && (
                <Button variant="outline" size="sm" onClick={() => openQuickLoan(p)} data-testid={`quick-loan-${p.id}`} className="flex flex-col items-center h-auto py-1.5 px-2.5 gap-0.5">
                  <HandCoins className="h-4 w-4" />
                  <span className="text-[9px] font-semibold">Lån ut</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => showDetail(p.id)} data-testid={`view-person-${p.id}`} className="flex flex-col items-center h-auto py-1.5 px-2 gap-0.5">
                <Eye className="h-4 w-4" /><span className="text-[9px]">Detaljer</span>
              </Button>
              {hasPerm("people", "write") && (
                <Button variant="ghost" size="sm" onClick={() => openEdit(p)} className="flex flex-col items-center h-auto py-1.5 px-2 gap-0.5">
                  <Pencil className="h-4 w-4" /><span className="text-[9px]">Rediger</span>
                </Button>
              )}
              {hasPerm("people", "admin") && (
                <Button variant="ghost" size="sm" onClick={() => del(p.id)} className="flex flex-col items-center h-auto py-1.5 px-2 gap-0.5">
                  <Trash2 className="h-4 w-4 text-red-600" /><span className="text-[9px] text-red-600">Slett</span>
                </Button>
              )}
            </div>
          )}
        />
      </Card>

      <LoanDialog
        open={!!loanFor}
        onOpenChange={(o) => !o && setLoanFor(null)}
        items={items} teams={teams} people={people}
        context={loanFor ? {
          personId: loanFor.id,
          teamId: (loanFor.team_ids && loanFor.team_ids[0]) || undefined,
          title: `Nytt utlån til ${loanFor.name}`
        } : {}}
        onSaved={() => { setLoanFor(null); load(); }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Rediger person" : "Ny person"}</DialogTitle>
            <DialogDescription>Legg til navn, kontakt og lagstilknytning.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Navn</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Telefon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Epost</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div>
              <Label>Tilknyttede lag</Label>
              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md p-2 space-y-1">
                {teams.length === 0 && <div className="text-sm text-slate-500 p-2">Ingen lag opprettet ennå</div>}
                {teams.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                    <Checkbox checked={form.team_ids.includes(t.id)} onCheckedChange={() => toggleTeam(t.id)} />
                    <span>{t.team_name} {t.age_class && <span className="text-slate-500">({t.age_class})</span>}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} data-testid="save-person-btn" className="bg-red-900 hover:bg-red-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>{detail?.person?.name}</span>
              {detail?.person?.debt > 0 && (
                <Button size="sm" variant="outline" onClick={() => setInvoiceFor({ id: detail.person.id, name: detail.person.name })} data-testid="person-invoice-btn">
                  <FileText className="h-3 w-3 mr-1" />Lag faktura
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>Personlig oversikt, lag og utlånshistorikk</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Card className="p-4 bg-red-50 border-red-200">
                  <div className="text-xs uppercase font-semibold text-red-800">Personlig skyldig beløp</div>
                  <div className="font-display text-2xl font-bold text-red-700 mt-1">{nok(detail.person.debt)}</div>
                </Card>
                <Card className="p-4 bg-amber-50 border-amber-200">
                  <div className="text-xs uppercase font-semibold text-amber-800">Lagets skyldig beløp (totalt)</div>
                  <div className="font-display text-2xl font-bold text-amber-700 mt-1">
                    {nok((detail.teams || []).reduce((s, t) => s + (t.debt || 0), 0))}
                  </div>
                </Card>
              </div>
              <div>
                <h4 className="font-semibold text-sm mb-2">Tilknyttede lag</h4>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                  {(detail.teams || []).map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-3 text-sm">
                      <span className="font-semibold">{t.team_name} <span className="text-slate-500 font-normal">({t.age_class})</span></span>
                      <span className={t.debt > 0 ? "text-red-700 font-semibold" : "text-slate-500"}>{nok(t.debt)}</span>
                    </div>
                  ))}
                  {(detail.teams || []).length === 0 && <div className="p-3 text-sm text-slate-500">Ingen lag</div>}
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-sm mb-2">Utlånshistorikk</h4>
                <div className="border border-slate-200 rounded-md max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0"><tr>
                      <th className="text-left p-2">Dato</th><th className="text-left p-2">Vare</th><th className="text-left p-2">Antall</th><th className="text-left p-2">Status</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {(detail.history || []).map((h) => (
                        <tr key={h.id}>
                          <td className="p-2">{new Date(h.loan_date).toLocaleDateString("nb-NO")}</td>
                          <td className="p-2">{h.item_name}</td>
                          <td className="p-2">{h.quantity}</td>
                          <td className="p-2">{h.status === "returned" ? "Returnert" : "Utlånt"}</td>
                        </tr>
                      ))}
                      {(detail.history || []).length === 0 && <tr><td colSpan={4} className="p-3 text-center text-slate-500">Ingen historikk</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent></DialogContent>
      </Dialog>
      <InvoiceDialog
        open={!!invoiceFor}
        onOpenChange={(o) => !o && setInvoiceFor(null)}
        personId={invoiceFor?.id}
        recipientName={invoiceFor?.name}
      />
    </div>
  );
}
