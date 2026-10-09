import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { api, formatError } from "@/lib/api";

// Rolle-valgene i rekkefølgen brukeren spesifiserte
export const STAFF_ROLES = [
  "Hovedtrener",
  "Lagleder",
  "Trener",
  "Dugnadsansvarlig",
  "Foreldrekontakt",
  "Kasserer",
  "Annet",
];

const EMPTY_STAFF = {
  role: "",
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  street_address: "",
  postal_code: "",
  postal_city: "",
  notes: "",
};

/**
 * Dialog for å legge til eller redigere en person i støtteapparatet.
 *
 * Props:
 *  - open, onOpenChange
 *  - initial: eksisterende person (for redigering) eller null for ny
 *  - teamId: lagets id – legges til team_ids ved opprettelse (valgfri)
 *  - onSaved(person): callback som får den lagrede personen (inkl. id, name)
 *  - mode: "api" (lagre direkte via /api/people) eller "local" (returner uten API-kall – for nye lag)
 */
export default function StaffDialog({ open, onOpenChange, initial, teamId, onSaved, mode = "api" }) {
  const [form, setForm] = useState(EMPTY_STAFF);
  const [saving, setSaving] = useState(false);
  const [lookingUpPostal, setLookingUpPostal] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      // Hvis person er knyttet til et spesifikt lag, bruk rollen fra membership for det laget
      let effectiveRole = initial.role || "";
      if (teamId && Array.isArray(initial.team_memberships)) {
        const m = initial.team_memberships.find((x) => x.team_id === teamId);
        if (m?.role) effectiveRole = m.role;
      }
      setForm({
        role: effectiveRole,
        first_name: initial.first_name || "",
        last_name: initial.last_name || "",
        phone: initial.phone || "",
        email: initial.email || "",
        street_address: initial.street_address || "",
        postal_code: initial.postal_code || "",
        postal_city: initial.postal_city || "",
        notes: initial.notes || "",
      });
    } else {
      setForm(EMPTY_STAFF);
    }
  }, [open, initial, teamId]);

  // Automatisk oppslag av poststed via Kartverket (geonorge) når 4-sifret postnr er fylt inn
  useEffect(() => {
    const zip = (form.postal_code || "").trim();
    if (!/^\d{4}$/.test(zip)) return;
    let cancelled = false;
    setLookingUpPostal(true);
    fetch(`https://ws.geonorge.kartverket.no/adresser/v1/sok?postnummer=${zip}&treffPerSide=1`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const sted = data?.adresser?.[0]?.poststed || "";
        if (sted) {
          setForm((f) => ({ ...f, postal_city: sted }));
        }
      })
      .catch(() => { /* stille – brukeren kan taste manuelt */ })
      .finally(() => { if (!cancelled) setLookingUpPostal(false); });
    return () => { cancelled = true; };
  }, [form.postal_code]);

  const canSave = form.role && form.first_name.trim() && form.last_name.trim();

  const save = async () => {
    if (!canSave) {
      toast.error("Rolle, fornavn og etternavn må fylles ut");
      return;
    }
    const payload = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      name: `${form.first_name.trim()} ${form.last_name.trim()}`.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      street_address: form.street_address.trim(),
      postal_code: form.postal_code.trim(),
      postal_city: form.postal_city.trim(),
      notes: form.notes.trim(),
    };
    // "Local"-modus brukes når laget ikke er lagret ennå – vi returnerer bare dataene til parent.
    if (mode === "local" && !initial) {
      onSaved?.({ ...payload, _pending: true });
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      if (initial?.id) {
        // Oppdater – oppdater (eller legg til) membership for aktivt teamId med den valgte rollen
        const existingMemberships = Array.isArray(initial.team_memberships) ? initial.team_memberships : [];
        let memberships = existingMemberships.slice();
        if (teamId) {
          const idx = memberships.findIndex((m) => m.team_id === teamId);
          if (idx >= 0) memberships[idx] = { team_id: teamId, role: form.role };
          else memberships.push({ team_id: teamId, role: form.role });
        }
        // Hvis person ikke hadde memberships fra før (eldre data), lag en fra team_ids + root role
        if (existingMemberships.length === 0 && (initial.team_ids || []).length > 0) {
          const seeded = (initial.team_ids || [])
            .filter((tid) => tid !== teamId)
            .map((tid) => ({ team_id: tid, role: initial.role || "" }));
          memberships = [...seeded, ...memberships];
        }
        const team_ids = Array.from(new Set(memberships.map((m) => m.team_id).filter(Boolean)));
        const { data } = await api.put(`/people/${initial.id}`, { ...payload, team_memberships: memberships, team_ids });
        toast.success("Oppdatert");
        onSaved?.(data);
      } else {
        const team_memberships = teamId ? [{ team_id: teamId, role: form.role }] : [];
        const team_ids = teamId ? [teamId] : [];
        const { data } = await api.post("/people", { ...payload, team_memberships, team_ids });
        toast.success("Lagt til i støtteapparatet");
        onSaved?.(data);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Rediger støtteapparat-person" : "Nytt støtteapparat"}</DialogTitle>
          <DialogDescription>
            Velg rolle først. Deretter kan du fylle ut kontaktinformasjon og eventuelle notater.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Rolle *</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger data-testid="staff-role-select"><SelectValue placeholder="Velg rolle" /></SelectTrigger>
              <SelectContent>
                {STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {form.role && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Fornavn *</Label>
                  <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="staff-first-name" />
                </div>
                <div>
                  <Label>Etternavn *</Label>
                  <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="staff-last-name" />
                </div>
                <div>
                  <Label>Telefonnummer</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+47 ..." data-testid="staff-phone" />
                </div>
                <div>
                  <Label>E-postadresse</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="staff-email" />
                </div>
              </div>

              <div>
                <Label>Gateadresse og gatenummer</Label>
                <Input value={form.street_address} onChange={(e) => setForm({ ...form, street_address: e.target.value })} placeholder="Storgata 12B" data-testid="staff-street" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Postnummer</Label>
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={form.postal_code}
                    onChange={(e) => setForm({ ...form, postal_code: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    placeholder="0000"
                    data-testid="staff-postal-code"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Stedsnavn {lookingUpPostal && <span className="text-[10px] text-slate-400 ml-1">(henter...)</span>}</Label>
                  <Input value={form.postal_city} readOnly disabled className="bg-slate-50 text-slate-600" data-testid="staff-postal-city" />
                </div>
              </div>

              <div>
                <Label>Notater / Kommentarer <span className="text-[10px] text-slate-400 font-normal">(vises kun i detaljvisningen)</span></Label>
                <Textarea rows={5} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="staff-notes" />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={save} disabled={!canSave || saving} className="bg-red-900 hover:bg-red-800" data-testid="save-staff-btn">
            {saving ? "Lagrer…" : "Lagre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
