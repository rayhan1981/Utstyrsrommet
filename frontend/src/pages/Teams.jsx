import React, { useEffect, useMemo, useState } from "react";
import { api, formatError, TEAM_NAME_OPTIONS, YEARS_ENGAGED } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus, Download, Eye, HandCoins, FileText, Mail, Send, UserPlus, Info } from "lucide-react";
import LoanDialog from "@/components/LoanDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import DataTable from "@/components/DataTable";
import InvoiceDialog from "@/components/InvoiceDialog";
import TeamNeedsTab from "@/components/TeamNeedsTab";
import StaffDialog from "@/components/StaffDialog";
import AddToTeamDialog from "@/components/AddToTeamDialog";

const EMPTY_TEAM = {
  team_name: "", age_class: "", email: "",
  training_times: Array(7).fill(""),
  contact_person: "", key_responsible: "", key_serial: "",
};

function TrainerFields() { return null; }  // Erstattet av StaffDialog + «+ Legg til støtteapparat»

export default function Teams() {
  const { hasPerm } = useAuth();
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_TEAM);
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loanFor, setLoanFor] = useState(null);
  const [invoiceFor, setInvoiceFor] = useState(null);
  // Støtteapparat-dialog
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffEditing, setStaffEditing] = useState(null);
  const [pendingStaff, setPendingStaff] = useState([]);  // kun brukt når editId == null
  const [personDetail, setPersonDetail] = useState(null);
  const [addToTeamFor, setAddToTeamFor] = useState(null);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const load = async () => {
    const [t, i, p] = await Promise.all([api.get("/teams"), api.get("/items"), api.get("/people")]);
    setTeams(t.data); setItems(i.data); setPeople(p.data);
  };
  useEffect(() => { load(); }, []);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  // Person-map pr lag – brukes for å finne «Hovedtrener» i lista og vise støtteapparat i detaljvisning.
  const peopleByTeam = useMemo(() => {
    const map = new Map();
    for (const p of people) {
      for (const tid of p.team_ids || []) {
        if (!map.has(tid)) map.set(tid, []);
        map.get(tid).push(p);
      }
    }
    return map;
  }, [people]);

  const headCoachForTeam = (teamId) => {
    const list = peopleByTeam.get(teamId) || [];
    // Finn personen hvis rolle PÅ DETTE laget er Hovedtrener (fra team_memberships, med fallback til root-role)
    return list.find((p) => roleForTeam(p, teamId) === "Hovedtrener") || null;
  };

  // Resolver rollen en person har PÅ et spesifikt lag. Faller tilbake til p.role for eldre data.
  const roleForTeam = (person, teamId) => {
    if (!person) return "";
    const m = (person.team_memberships || []).find((x) => x.team_id === teamId);
    return (m?.role) || person.role || "";
  };

  const openNew = () => { setEditId(null); setForm(EMPTY_TEAM); setPendingStaff([]); setOpen(true); };
  const openEdit = (t) => {
    setEditId(t.id);
    setForm({ ...EMPTY_TEAM, ...t, training_times: [...(t.training_times || []), ...Array(7).fill("")].slice(0, 7) });
    setPendingStaff([]);
    setOpen(true);
  };

  const showDetail = async (id) => {
    const { data } = await api.get(`/teams/${id}`);
    setDetail(data);
  };

  const openQuickLoan = (t) => { setLoanFor(t); };

  const save = async () => {
    try {
      const payload = { ...form, training_times: form.training_times.filter((t) => t.trim()) };
      let saved;
      if (editId) {
        const res = await api.put(`/teams/${editId}`, payload);
        saved = res.data;
      } else {
        const res = await api.post("/teams", payload);
        saved = res.data;
        // Hvis vi har pending støtteapparat-personer – lagre dem med det nye lagets id
        for (const sp of pendingStaff) {
          const { _pending, ...clean } = sp;
          try { await api.post("/people", { ...clean, team_ids: [saved.id] }); }
          catch (e) { toast.error(formatError(e.response?.data?.detail)); }
        }
      }
      toast.success("Lagret"); setOpen(false); setPendingStaff([]); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const del = async (id) => {
    if (!window.confirm("Slette dette laget?")) return;
    try { await api.delete(`/teams/${id}`); toast.success("Slettet"); load(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  // Støtteapparat-handlinger
  const openAddStaff = () => { setStaffEditing(null); setStaffOpen(true); };
  const openEditStaff = (p) => { setStaffEditing(p); setStaffOpen(true); };
  const onStaffSaved = (person) => {
    if (!editId) {
      // Legg til lokalt – lagres når laget opprettes
      if (person._pending) {
        if (staffEditing) {
          setPendingStaff((xs) => xs.map((x) => (x === staffEditing ? person : x)));
        } else {
          setPendingStaff((xs) => [...xs, person]);
        }
      }
    } else {
      // API har lagret personen – oppdater lista
      load();
    }
  };
  const removePendingStaff = (p) => setPendingStaff((xs) => xs.filter((x) => x !== p));
  const deleteStaff = async (p) => {
    if (!window.confirm(`Slette ${p.name} fra støtteapparatet?`)) return;
    try { await api.delete(`/people/${p.id}`); toast.success("Slettet"); load(); if (detail) showDetail(detail.team.id); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };
  const emailStaff = (p) => {
    if (!p.email) { toast.error("Personen har ingen e-postadresse"); return; }
    window.location.href = `mailto:${p.email}`;
  };

  const exportTeam = (id, name) => {
    const token = localStorage.getItem("utr_token");
    const url = `${BASE}/api/export/team/${id}`;
    fetch(url, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob())
      .then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = `utstyr_${name}.pdf`; a.click(); URL.revokeObjectURL(u);
      });
  };

  const [sendFor, setSendFor] = useState(null);
  const [sendForm, setSendForm] = useState({ to: "", cc: "", message: "" });
  const openSendList = (team) => {
    const tm = team.team_manager || {}; const hc = team.head_coach || {};
    setSendFor(team);
    setSendForm({ to: tm.email || hc.email || team.email || "", cc: "", message: "" });
  };
  const sendList = async () => {
    if (!sendForm.to) { toast.error("Angi mottakers e-post"); return; }
    try {
      const payload = { to: sendForm.to };
      if (sendForm.cc) payload.cc = sendForm.cc;
      if (sendForm.message) payload.message = sendForm.message;
      const { data } = await api.post(`/teams/${sendFor.id}/send-equipment-list`, payload);
      toast.success(`Utstyrsoversikt sendt til ${data.sent_to}`);
      setSendFor(null); load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6" data-testid="teams-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Lag</h1>
          <p className="text-slate-600 text-sm mt-1">Administrer lag, trenere og lagledere</p>
        </div>
        {hasPerm("teams", "write") && (
          <Button onClick={openNew} data-testid="new-team-btn" className="bg-red-900 hover:bg-red-800">
            <Plus className="h-4 w-4 mr-2" /> Nytt lag
          </Button>
        )}
      </div>

      <Card className="p-3">
        <DataTable
          rows={teams}
          emptyLabel="Ingen lag registrert."
          searchPlaceholder="Søk lag, aldersklasse, trener…"
          columns={[
            { key: "team_name", label: "Lagsnavn", filter: "text", render: (t) => <span className="font-semibold">{t.team_name}</span> },
            { key: "age_class", label: "Aldersklasse", filter: "text" },
            { key: "contact_person", label: "Kontaktperson", filter: "text", render: (t) => t.contact_person || "-" },
            { key: "head_coach_name", label: "Hovedtrener", filter: "text",
              accessor: (t) => headCoachForTeam(t.id)?.name || t.head_coach?.name || "",
              render: (t) => headCoachForTeam(t.id)?.name || t.head_coach?.name || "-" },
            { key: "debt", label: "Skyldig", filter: "number", accessor: (t) => t.debt || 0, render: (t) => <span className={t.debt > 0 ? "text-red-700 font-semibold" : ""}>{nok(t.debt)}</span> },
          ]}
          actions={(t) => (
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {hasPerm("loans", "write") && (
                <Button variant="outline" size="sm" onClick={() => openQuickLoan(t)} data-testid={`quick-loan-team-${t.id}`} className="flex flex-col items-center h-auto py-1.5 px-2.5 gap-0.5">
                  <HandCoins className="h-4 w-4" />
                  <span className="text-[9px] font-semibold">Lån ut</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => showDetail(t.id)} data-testid={`view-team-${t.id}`} className="flex flex-col items-center h-auto py-1.5 px-2 gap-0.5">
                <Eye className="h-4 w-4" />
                <span className="text-[9px]">Detaljer</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => exportTeam(t.id, t.team_name)} data-testid={`export-team-${t.id}`} className="flex flex-col items-center h-auto py-1.5 px-2 gap-0.5">
                <Download className="h-4 w-4" />
                <span className="text-[9px]">Last ned</span>
              </Button>
              {hasPerm("teams", "write") && (
                <Button variant="ghost" size="sm" onClick={() => openEdit(t)} data-testid={`edit-team-${t.id}`} className="flex flex-col items-center h-auto py-1.5 px-2 gap-0.5">
                  <Pencil className="h-4 w-4" />
                  <span className="text-[9px]">Rediger</span>
                </Button>
              )}
              {hasPerm("teams", "admin") && (
                <Button variant="ghost" size="sm" onClick={() => del(t.id)} data-testid={`del-team-${t.id}`} className="flex flex-col items-center h-auto py-1.5 px-2 gap-0.5">
                  <Trash2 className="h-4 w-4 text-red-600" />
                  <span className="text-[9px] text-red-600">Slett</span>
                </Button>
              )}
            </div>
          )}
        />
      </Card>

      <LoanDialog
        open={!!loanFor}
        onOpenChange={(o) => !o && setLoanFor(null)}
        items={items} teams={teams} people={[]}
        context={loanFor ? { teamId: loanFor.id, title: `Nytt utlån til ${loanFor.team_name}` } : {}}
        onSaved={() => { setLoanFor(null); load(); }}
      />

      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent></DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Rediger lag" : "Nytt lag"}</DialogTitle>
            <DialogDescription>Fyll ut lagets detaljer, kontaktpersoner og roller.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Lagsnavn</Label>
                <Select value={form.team_name} onValueChange={(v) => setForm({ ...form, team_name: v })}>
                  <SelectTrigger data-testid="team-name-select"><SelectValue placeholder="Velg lagsnavn" /></SelectTrigger>
                  <SelectContent>{TEAM_NAME_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Aldersklasse (f.eks. 2019)</Label>
                <Input value={form.age_class} onChange={(e) => setForm({ ...form, age_class: e.target.value })} />
              </div>
              <div>
                <Label>E-post til laget</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Kontaktperson</Label>
                <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div>
                <Label>Nøkkelansvarlig</Label>
                <Input value={form.key_responsible} onChange={(e) => setForm({ ...form, key_responsible: e.target.value })} />
              </div>
              <div>
                <Label>Serienummer på nøkkel</Label>
                <Input value={form.key_serial} onChange={(e) => setForm({ ...form, key_serial: e.target.value })} />
              </div>
            </div>

            <div>
              <Label>Treningstider (opptil 7 pr uke)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                {form.training_times.map((t, i) => (
                  <Input key={i} placeholder={`Treningstid ${i + 1} (f.eks. Mandag 17-19)`} value={t}
                    onChange={(e) => { const arr = [...form.training_times]; arr[i] = e.target.value; setForm({ ...form, training_times: arr }); }} />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Støtteapparat erstatter de gamle Hovedtrener/Lagleder/Trener-feltene */}
              <div className="lg:col-span-2 border border-slate-200 rounded-md p-3 bg-slate-50/40 space-y-2" data-testid="support-staff-section">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-semibold text-sm text-red-900">Støtteapparat</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <Info className="h-3 w-3" />
                      Personer som er knyttet til dette laget. Blir også tilgjengelig i «Mottatt av» og «Returnert av».
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={openAddStaff} data-testid="add-staff-btn">
                    <UserPlus className="h-4 w-4 mr-1" /> Legg til støtteapparat
                  </Button>
                </div>
                {(() => {
                  const list = editId
                    ? (peopleByTeam.get(editId) || [])
                    : pendingStaff;
                  if (list.length === 0) {
                    return <div className="text-xs text-slate-400 italic py-2">Ingen personer lagt til ennå.</div>;
                  }
                  return (
                    <div className="space-y-1">
                      {list.map((p, idx) => (
                        <div key={p.id || `pending-${idx}`} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 text-sm" data-testid={`staff-row-${idx}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-bold uppercase bg-red-100 text-red-800 px-1.5 py-0.5 rounded shrink-0">{p.role}</span>
                            <span className="font-semibold truncate">{p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim()}</span>
                            {p.phone && <span className="text-xs text-slate-500 shrink-0">{p.phone}</span>}
                            {p._pending && <span className="text-[10px] text-amber-700 italic shrink-0">(lagres ved «Lagre»)</span>}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button type="button" variant="ghost" size="sm" onClick={() => openEditStaff(p)} data-testid={`edit-staff-${idx}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => (p._pending ? removePendingStaff(p) : deleteStaff(p))} data-testid={`del-staff-${idx}`}>
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} data-testid="save-team-btn" className="bg-red-900 hover:bg-red-800">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>{detail?.team?.team_name} {detail?.team?.age_class && `(${detail.team.age_class})`}</span>
              {detail?.team?.debt > 0 && (
                <Button size="sm" variant="outline" onClick={() => setInvoiceFor({ id: detail.team.id, name: detail.team.team_name })} data-testid="team-invoice-btn">
                  <FileText className="h-3 w-3 mr-1" />Lag faktura
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>
              Skyldig beløp: <span className={detail?.team?.debt > 0 ? "text-red-700 font-semibold" : ""}>{nok(detail?.team?.debt)}</span>
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <Tabs defaultValue="info">
              <TabsList>
                <TabsTrigger value="info" data-testid="team-tab-info">Oversikt</TabsTrigger>
                <TabsTrigger value="needs" data-testid="team-tab-needs">Innmeldt Behov</TabsTrigger>
              </TabsList>
              <TabsContent value="info" className="space-y-4 pt-4">
              <div>
                <h4 className="font-semibold text-sm mb-2">Personer tilknyttet laget ({detail.people.length})</h4>
                <div className="border border-slate-200 rounded-md divide-y divide-slate-100" data-testid="team-detail-staff-list">
                  {detail.people.length === 0 && <div className="text-center text-slate-500 py-4 text-sm">Ingen personer.</div>}
                  {detail.people.map((p) => {
                    const rolleHer = roleForTeam(p, detail.team.id);
                    const antallLag = (p.team_ids || []).length;
                    return (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5" data-testid={`team-detail-person-${p.id}`}>
                      <div className="min-w-0 flex-1">
                        {rolleHer && (
                          <div className="text-[10px] font-bold uppercase tracking-wide text-red-800 leading-tight">
                            {rolleHer}
                            {antallLag > 1 && (
                              <span className="ml-2 text-[9px] font-semibold text-slate-500 italic normal-case" title={`Også på ${antallLag - 1} andre lag`}>
                                +{antallLag - 1} andre lag
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                          <span className="font-semibold text-sm truncate">{p.name}</span>
                          <span className="text-slate-400 text-xs">·</span>
                          <span className="text-slate-700 text-sm">{p.phone || "–"}</span>
                          {p.debt > 0 && <span className="text-xs text-red-700 font-semibold ml-1">Skyldig: {nok(p.debt)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => setPersonDetail(p)} title="Vis informasjon" data-testid={`view-person-${p.id}`} className="h-8 w-8 p-0">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEditStaff(p)} title="Rediger informasjon" data-testid={`edit-person-${p.id}`} className="h-8 w-8 p-0">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => emailStaff(p)} title={p.email ? `Send e-post til ${p.email}` : "Mangler e-post"} data-testid={`email-person-${p.id}`} disabled={!p.email} className="h-8 w-8 p-0">
                          <Mail className={`h-4 w-4 ${p.email ? "text-red-700" : "text-slate-300"}`} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteStaff(p, detail.team.id)} title={antallLag > 1 ? "Fjern fra dette laget" : "Slett person"} data-testid={`del-person-${p.id}`} className="h-8 w-8 p-0">
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  );})}
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-sm mb-2">Utlånshistorikk ({detail.history.length})</h4>
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr><th className="text-left p-2">Dato</th><th className="text-left p-2">Vare</th><th className="text-left p-2">Antall</th><th className="text-left p-2">Status</th><th className="text-right p-2">Skyldig</th></tr></thead>
                    <tbody>
                      {detail.history.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-4">Ingen utlån.</td></tr>}
                      {detail.history.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="p-2 text-xs">{new Date(l.loan_date).toLocaleDateString("nb-NO")}</td>
                          <td className="p-2">{l.item_name}{l.size ? ` (${l.size})` : ""}</td>
                          <td className="p-2">{l.quantity}</td>
                          <td className="p-2"><span className={`text-xs font-semibold px-2 py-1 rounded ${l.status === "returned" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{l.status === "returned" ? "Returnert" : "Utlånt"}</span></td>
                          <td className={`p-2 text-right ${l.amount_owed > 0 ? "text-red-700 font-semibold" : ""}`}>{nok(l.amount_owed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              </TabsContent>
              <TabsContent value="needs" className="pt-4">
                <TeamNeedsTab teamId={detail.team.id} teamName={detail.team.team_name} />
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDetail(null)}>Lukk</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent></DialogContent>
      </Dialog>

      <InvoiceDialog
        open={!!invoiceFor}
        onOpenChange={(o) => !o && setInvoiceFor(null)}
        teamId={invoiceFor?.id}
        recipientName={invoiceFor?.name}
      />

      <StaffDialog
        open={staffOpen}
        onOpenChange={setStaffOpen}
        initial={staffEditing}
        teamId={editId || detail?.team?.id || null}
        mode={(editId || staffEditing?.id) ? "api" : "local"}
        onSaved={onStaffSaved}
      />

      <AddToTeamDialog
        open={!!addToTeamFor}
        onOpenChange={(o) => !o && setAddToTeamFor(null)}
        person={addToTeamFor}
        teams={teams}
        excludeTeamIds={addToTeamFor?.team_ids || []}
        onSaved={(updated) => { setAddToTeamFor(null); setPersonDetail(updated); load(); }}
      />

      <Dialog open={!!personDetail} onOpenChange={(o) => !o && setPersonDetail(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{personDetail?.name}</DialogTitle>
            <DialogDescription>
              {personDetail?.role && <span className="inline-block text-[10px] font-bold uppercase bg-red-100 text-red-800 px-1.5 py-0.5 rounded mr-2">{personDetail.role}</span>}
              Personinformasjon
            </DialogDescription>
          </DialogHeader>
          {personDetail && (
            <div className="space-y-2 text-sm">
              <div><span className="text-slate-500 w-32 inline-block">Telefon:</span> {personDetail.phone || "–"}</div>
              <div><span className="text-slate-500 w-32 inline-block">E-post:</span> {personDetail.email || "–"}</div>
              <div><span className="text-slate-500 w-32 inline-block">Adresse:</span> {personDetail.street_address || "–"}</div>
              <div><span className="text-slate-500 w-32 inline-block">Postnr/sted:</span> {[personDetail.postal_code, personDetail.postal_city].filter(Boolean).join(" ") || "–"}</div>

              <div className="pt-3 border-t border-slate-100 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-slate-500 text-xs">Lag og rolle</div>
                  <Button variant="outline" size="sm" onClick={() => setAddToTeamFor(personDetail)} data-testid="add-to-team-btn">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Legg til i annet lag
                  </Button>
                </div>
                {(() => {
                  const memberships = Array.isArray(personDetail.team_memberships) && personDetail.team_memberships.length > 0
                    ? personDetail.team_memberships
                    : (personDetail.team_ids || []).map((tid) => ({ team_id: tid, role: personDetail.role || "" }));
                  if (memberships.length === 0) return <div className="text-xs italic text-slate-400">Ikke knyttet til noe lag.</div>;
                  return (
                    <div className="space-y-1" data-testid="person-memberships-list">
                      {memberships.map((m) => {
                        const t = teams.find((x) => x.id === m.team_id);
                        return (
                          <div key={m.team_id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-100 rounded px-2 py-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-sm truncate">{t?.team_name || "(ukjent lag)"}{t?.age_class ? ` (${t.age_class})` : ""}</span>
                              <span className="text-slate-400">·</span>
                              <span className="text-[10px] font-bold uppercase bg-red-100 text-red-800 px-1.5 py-0.5 rounded">{m.role || "—"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {personDetail.notes && (
                <div className="pt-2 border-t border-slate-100 mt-2">
                  <div className="text-slate-500 text-xs mb-1">Notater / Kommentarer</div>
                  <div className="whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded p-2 text-sm">{personDetail.notes}</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPersonDetail(null)}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
