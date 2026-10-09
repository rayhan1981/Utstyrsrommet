import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { api, formatError } from "@/lib/api";
import { STAFF_ROLES } from "@/components/StaffDialog";

/**
 * Dialog for å knytte en EKSISTERENDE person til et annet lag (med egen rolle for det laget).
 * Props:
 *  - open, onOpenChange
 *  - person: eksisterende person-dokument (må ha id + team_memberships / team_ids)
 *  - teams: liste over tilgjengelige lag
 *  - excludeTeamIds: lag-ids personen allerede tilhører
 *  - onSaved(person): callback med oppdatert person-dokument
 */
export default function AddToTeamDialog({ open, onOpenChange, person, teams = [], excludeTeamIds = [], onSaved }) {
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setTeamId(""); setRole(""); } }, [open]);

  const available = (teams || []).filter((t) => !(excludeTeamIds || []).includes(t.id));
  const canSave = teamId && role;

  const save = async () => {
    if (!canSave || !person?.id) return;
    setSaving(true);
    try {
      // Beregn ny membership-liste – seed fra team_ids hvis memberships mangler (eldre data)
      let memberships = Array.isArray(person.team_memberships) ? person.team_memberships.slice() : [];
      if (memberships.length === 0 && (person.team_ids || []).length > 0) {
        memberships = (person.team_ids || []).map((tid) => ({ team_id: tid, role: person.role || "" }));
      }
      // Erstatt eller legg til for valgt lag
      const idx = memberships.findIndex((m) => m.team_id === teamId);
      if (idx >= 0) memberships[idx] = { team_id: teamId, role };
      else memberships.push({ team_id: teamId, role });
      const team_ids = Array.from(new Set(memberships.map((m) => m.team_id).filter(Boolean)));

      const payload = {
        name: person.name,
        first_name: person.first_name || "",
        last_name: person.last_name || "",
        role: person.role || role,  // behold primærrolle hvis satt
        phone: person.phone || "",
        email: person.email || "",
        street_address: person.street_address || "",
        postal_code: person.postal_code || "",
        postal_city: person.postal_city || "",
        notes: person.notes || "",
        team_ids,
        team_memberships: memberships,
      };
      const { data } = await api.put(`/people/${person.id}`, payload);
      toast.success(`Lagt til i «${(teams.find((t) => t.id === teamId) || {}).team_name || "laget"}»`);
      onSaved?.(data);
      onOpenChange(false);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Legg til i annet lag</DialogTitle>
          <DialogDescription>
            Velg hvilket lag <strong>{person?.name}</strong> skal knyttes til, og hvilken rolle personen har i det laget.
            All annen informasjon beholdes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Lag *</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger data-testid="add-to-team-select"><SelectValue placeholder={available.length ? "Velg lag" : "Personen er allerede på alle lag"} /></SelectTrigger>
              <SelectContent>
                {available.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.team_name}{t.age_class ? ` (${t.age_class})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {teamId && (
            <div>
              <Label>Rolle i dette laget *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger data-testid="add-to-team-role-select"><SelectValue placeholder="Velg rolle" /></SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={save} disabled={!canSave || saving} className="bg-red-900 hover:bg-red-800" data-testid="save-add-to-team-btn">
            {saving ? "Lagrer…" : "Legg til"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
