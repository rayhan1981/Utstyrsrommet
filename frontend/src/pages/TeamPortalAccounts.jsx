import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Plus, Send, UserX, CheckCircle2, Clock, AlertCircle, Copy, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const EMPTY = { team_id: "", email: "", display_name: "", phone: "" };

export default function TeamPortalAccounts() {
  const { hasPerm } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [teams, setTeams] = useState([]);
  const [portalStatus, setPortalStatus] = useState({ active: false, plan: null });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [inviteDialog, setInviteDialog] = useState(null); // {link, email}

  const load = async () => {
    try {
      const [s, t] = await Promise.all([api.get("/team-portal/status"), api.get("/teams")]);
      setPortalStatus(s.data);
      setTeams(t.data);
      if (s.data.active) {
        const a = await api.get("/team-portal/accounts");
        setAccounts(a.data);
      } else {
        setAccounts([]);
      }
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setOpen(true); };

  const save = async () => {
    if (!form.team_id || !form.email.trim()) {
      toast.error("Velg lag og fyll inn e-postadresse"); return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/team-portal/accounts", form);
      toast.success("Konto opprettet. Invitasjon sendt på e-post.");
      setOpen(false); setForm(EMPTY);
      if (data.invite_link) setInviteDialog({ link: data.invite_link, email: data.email });
      load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const toggleActive = async (acc) => {
    const next = !acc.active;
    if (!window.confirm(`${next ? "Aktiver" : "Deaktiver"} tilgangen for ${acc.email}?`)) return;
    try {
      await api.put(`/team-portal/accounts/${acc.id}`, { active: next });
      toast.success(next ? "Aktivert" : "Deaktivert");
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const resendInvite = async (acc) => {
    if (!window.confirm(`Sende ny invitasjon til ${acc.email}? Dette ugyldiggjør en eventuell tidligere invitasjon.`)) return;
    try {
      const { data } = await api.post(`/team-portal/accounts/${acc.id}/resend-invite`);
      toast.success("Ny invitasjon sendt");
      if (data.invite_link) setInviteDialog({ link: data.invite_link, email: acc.email });
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const teamName = (tid) => teams.find((t) => t.id === tid)?.team_name || "(ukjent lag)";

  if (!portalStatus.active) {
    return (
      <Card className="p-6 border-amber-300 bg-amber-50/40">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-amber-900">Lagsportal krever Deluxe</h2>
            <p className="text-sm text-slate-700 mt-1">
              Lagsportalen (portal.utstyrsrommet.no) er kun tilgjengelig for klubber med aktiv Deluxe-plan.
              Oppgrader abonnementet under <strong>Abonnement</strong> for å opprette lagspålogginger.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Nåværende plan: <span className="font-semibold">{portalStatus.plan || "ukjent"}</span>
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Lagspålogginger</h1>
          <p className="text-sm text-slate-500">
            Administrer tilganger til lagsportalen (portal.utstyrsrommet.no). En konto er bundet til ett spesifikt lag.
          </p>
        </div>
        {hasPerm("teams", "admin") && (
          <Button onClick={openNew} className="bg-red-900 hover:bg-red-800" data-testid="new-portal-account-btn">
            <Plus className="h-4 w-4 mr-2" />Ny lagspålogging
          </Button>
        )}
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lag</TableHead>
              <TableHead>E-post</TableHead>
              <TableHead>Navn</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sist innlogget</TableHead>
              <TableHead className="text-right">Handlinger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-6">Ingen lagspålogginger opprettet ennå.</TableCell></TableRow>
            )}
            {accounts.map((a) => (
              <TableRow key={a.id} data-testid={`portal-acc-${a.id}`}>
                <TableCell className="font-semibold">{teamName(a.team_id)}</TableCell>
                <TableCell className="font-mono text-xs">{a.email}</TableCell>
                <TableCell>{a.display_name || "–"}</TableCell>
                <TableCell>{a.phone || "–"}</TableCell>
                <TableCell>
                  {a.active ? (
                    a.pending_invite ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        <Clock className="h-3 w-3" />Venter på første innlogging
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-green-800 bg-green-100 px-1.5 py-0.5 rounded">
                        <CheckCircle2 className="h-3 w-3" />Aktiv
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                      <UserX className="h-3 w-3" />Deaktivert
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-slate-500">{a.last_login_at ? new Date(a.last_login_at).toLocaleString("nb-NO") : "–"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => resendInvite(a)} title="Send ny invitasjon" data-testid={`resend-${a.id}`}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    <Switch checked={a.active} onCheckedChange={() => toggleActive(a)} data-testid={`toggle-${a.id}`} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ny lagspålogging</DialogTitle>
            <DialogDescription>Lagleder/trener får en e-post med lenke for å sette passord.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Lag *</Label>
              <Select value={form.team_id} onValueChange={(v) => setForm({ ...form, team_id: v })}>
                <SelectTrigger data-testid="portal-team-select"><SelectValue placeholder="Velg lag" /></SelectTrigger>
                <SelectContent>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name}{t.age_class ? ` (${t.age_class})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>E-postadresse *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="portal-email" />
            </div>
            <div>
              <Label>Visningsnavn</Label>
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="F.eks. Ola Normann (Lagleder)" data-testid="portal-name" />
            </div>
            <div>
              <Label>Telefon</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="portal-phone" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} disabled={saving} className="bg-red-900 hover:bg-red-800" data-testid="save-portal-account">
              {saving ? "Oppretter…" : "Opprett og send invitasjon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inviteDialog} onOpenChange={(o) => !o && setInviteDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><LinkIcon className="h-5 w-5" />Invitasjonslenke</DialogTitle>
            <DialogDescription>Invitasjonen er sendt per e-post til {inviteDialog?.email}. Du kan også kopiere lenken manuelt:</DialogDescription>
          </DialogHeader>
          <div className="bg-slate-50 border border-slate-200 rounded p-3 font-mono text-xs break-all">{inviteDialog?.link}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(inviteDialog?.link || ""); toast.success("Lenke kopiert"); }}>
              <Copy className="h-4 w-4 mr-1" />Kopier
            </Button>
            <Button onClick={() => setInviteDialog(null)}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
