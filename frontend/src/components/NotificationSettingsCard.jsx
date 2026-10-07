import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bell, Info, X, Plus } from "lucide-react";
import { toast } from "sonner";

const DEFAULTS = { enabled: true, reminder_before_days: [14, 7], reminder_after_days: [1] };

export default function NotificationSettingsCard() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newBefore, setNewBefore] = useState("");
  const [newAfter, setNewAfter] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/notification-settings");
      setCfg({ ...DEFAULTS, ...data });
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/notification-settings", cfg);
      toast.success("Varselinnstillinger lagret");
      await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const addDay = (field, value) => {
    const v = parseInt(value, 10);
    if (!Number.isFinite(v) || v < 0 || v > 180) return;
    const arr = [...(cfg[field] || [])];
    if (arr.includes(v)) return;
    arr.push(v); arr.sort((a, b) => b - a);
    setCfg({ ...cfg, [field]: arr });
  };
  const removeDay = (field, v) => setCfg({ ...cfg, [field]: (cfg[field] || []).filter((x) => x !== v) });

  if (!cfg) return null;

  return (
    <Card className="p-5" data-testid="notification-settings-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-md bg-red-900/10 flex items-center justify-center shrink-0">
          <Bell className="h-5 w-5 text-red-800" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-bold">Varsler ved frist for retur</h3>
          <p className="text-xs text-slate-500 mt-1">
            Automatisk e-post til lagleder (med PDF-oversikt) før/etter forfallsdato.
            Standard: 14 og 7 dager før frist + 1 dag etter frist (kopi til alle brukere ved forfall).
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!!cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} data-testid="notifications-enabled" />
          <span>{cfg.enabled ? "På" : "Av"}</span>
        </label>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="font-semibold">Dager før frist</Label>
          <p className="text-[11px] text-slate-500 mb-2 flex items-start gap-1">
            <Info className="h-3 w-3 mt-[2px] shrink-0" />
            <span>Lagleder får e-post så mange dager før fristdato. Legg til flere intervaller etter behov.</span>
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {(cfg.reminder_before_days || []).map((d) => (
              <span key={d} className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-full px-3 py-1" data-testid={`before-chip-${d}`}>
                {d} dager før
                <button type="button" onClick={() => removeDay("reminder_before_days", d)} className="hover:bg-emerald-200 rounded-full"><X className="h-3 w-3" /></button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <Input type="number" min="1" max="180" placeholder="f.eks. 30"
                value={newBefore} onChange={(e) => setNewBefore(e.target.value)}
                className="w-28" data-testid="new-before-input" />
              <Button type="button" variant="outline" size="sm" onClick={() => { addDay("reminder_before_days", newBefore); setNewBefore(""); }} data-testid="add-before-btn">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <div>
          <Label className="font-semibold">Dager etter frist (med kopi til alle brukere)</Label>
          <p className="text-[11px] text-slate-500 mb-2 flex items-start gap-1">
            <Info className="h-3 w-3 mt-[2px] shrink-0" />
            <span>Varsel sendt etter at fristen har passert. Alle aktive brukere i klubben får kopi (slik at admin/leder er orientert).</span>
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {(cfg.reminder_after_days || []).map((d) => (
              <span key={d} className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-900 text-sm rounded-full px-3 py-1" data-testid={`after-chip-${d}`}>
                {d} dager etter
                <button type="button" onClick={() => removeDay("reminder_after_days", d)} className="hover:bg-red-200 rounded-full"><X className="h-3 w-3" /></button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <Input type="number" min="1" max="180" placeholder="f.eks. 7"
                value={newAfter} onChange={(e) => setNewAfter(e.target.value)}
                className="w-28" data-testid="new-after-input" />
              <Button type="button" variant="outline" size="sm" onClick={() => { addDay("reminder_after_days", newAfter); setNewAfter(""); }} data-testid="add-after-btn">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <Button onClick={save} disabled={saving} className="bg-red-900 hover:bg-red-800" data-testid="save-notification-settings">
            {saving ? "Lagrer..." : "Lagre varselinnstillinger"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
