import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertTriangle, Trash2, Download, ShieldAlert, Package, Users as UsersIcon, UserCircle, Truck, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const SECTIONS = [
  { key: "inventory", label: "Utstyr", icon: Package, desc: "Alle varer, variasjoner, bilder og tilknyttede utlån", export: "/api/export/items" },
  { key: "suppliers", label: "Leverandører", icon: Truck, desc: "Leverandørregister, bestillinger og behovsskjema", export: null },
  { key: "teams", label: "Lag", icon: UsersIcon, desc: "Alle lag og lagleder-/trenerinformasjon", export: null },
  { key: "people", label: "Personer", icon: UserCircle, desc: "Alle personer/medlemmer og deres gjeld", export: null },
  { key: "users", label: "Brukere", icon: UserCog, desc: "Alle brukere unntatt admin (ingen passordtilbakestilling nødvendig)", export: null, adminOnly: true },
];

export default function DataResetCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "platform_owner";
  const myResetPerms = user?.reset_permissions || [];
  const allowed = (s) => isAdmin || myResetPerms.includes(s.key);

  const [target, setTarget] = useState(null); // section-obj
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ password: "", confirm: false, understand: false });
  const [busy, setBusy] = useState(false);

  const openReset = async (s) => {
    setTarget(s); setForm({ password: "", confirm: false, understand: false }); setPreview(null);
    try {
      const { data } = await api.get(`/reset/preview/${s.key}`);
      setPreview(data);
    } catch (e) { setPreview({ counts: {} }); }
  };

  const doReset = async () => {
    if (!form.password) { toast.error("Skriv inn passordet ditt"); return; }
    if (!form.understand || !form.confirm) { toast.error("Du må bekrefte begge sjekkbokser"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/reset/${target.key}`, {
        password: form.password, confirm: true, section: target.key,
      });
      const deletedTxt = Object.entries(data.deleted).map(([k, v]) => `${v} ${k}`).join(", ");
      toast.success(`Nullstilling fullført (${deletedTxt || "0 rader"})`);
      setTarget(null);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);
  if (!isAdmin && myResetPerms.length === 0) return null;

  return (
    <Card className="p-5 border-red-200" data-testid="data-reset-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-md bg-red-100 flex items-center justify-center shrink-0">
          <ShieldAlert className="h-5 w-5 text-red-700" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-bold text-red-900">Nullstill klubbens data</h3>
          <p className="text-xs text-slate-600 mt-1">
            Sletter all data i valgt seksjon for denne klubben.
            Handlingen er <strong>permanent</strong> og kan ikke angres. Tips: eksporter data først.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleSections.map((s) => {
          const can = allowed(s);
          return (
            <div key={s.key} className={`border rounded-md p-3 ${can ? "border-slate-200" : "border-slate-100 opacity-50"}`} data-testid={`reset-section-${s.key}`}>
              <div className="flex items-start gap-2 mb-2">
                <s.icon className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-sm">{s.label}</div>
                  <div className="text-[11px] text-slate-500">{s.desc}</div>
                </div>
              </div>
              <Button size="sm" variant="outline"
                      className="w-full border-red-300 text-red-800 hover:bg-red-50"
                      onClick={() => openReset(s)}
                      disabled={!can}
                      data-testid={`reset-btn-${s.key}`}>
                <Trash2 className="h-3 w-3 mr-1" />Nullstill {s.label.toLowerCase()}
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-5 w-5" />Nullstill {target?.label}?
            </DialogTitle>
            <DialogDescription>
              Dette sletter <strong>permanent</strong> all data i seksjonen for denne klubben.
              <br />Handlingen kan ikke angres og dataene kan ikke gjenopprettes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {preview?.counts && Object.keys(preview.counts).length > 0 && (
              <div className="border border-red-200 rounded-md p-3 bg-red-50">
                <div className="text-xs font-semibold text-red-900 mb-1.5">Følgende vil bli slettet:</div>
                <ul className="text-xs text-red-900 space-y-0.5">
                  {Object.entries(preview.counts).map(([k, v]) => (
                    <li key={k}>• <strong>{v}</strong> {k.replace("_", " ")}</li>
                  ))}
                </ul>
              </div>
            )}

            {target?.export && (
              <div className="border border-amber-200 rounded-md p-3 bg-amber-50 flex items-start gap-2">
                <Download className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 flex-1">
                  <strong>Tips:</strong> Eksporter dataene først slik at du kan importere dem igjen senere ved behov.
                  <a href={`${process.env.REACT_APP_BACKEND_URL}${target.export}`} target="_blank" rel="noreferrer"
                     className="inline-block ml-1 text-amber-900 underline font-semibold">Last ned eksport →</a>
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.understand} onChange={(e) => setForm({ ...form, understand: e.target.checked })}
                     className="mt-0.5" data-testid="reset-understand" />
              <span>Jeg forstår at <strong>all data for {target?.label.toLowerCase()} vil slettes for godt</strong> og at dette ikke kan gjenopprettes.</span>
            </label>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })}
                     className="mt-0.5" data-testid="reset-confirm" />
              <span>Jeg er sikker på at jeg vil utføre denne handlingen.</span>
            </label>

            <div>
              <Label>Bekreft med ditt innloggingspassord *</Label>
              <Input type="password" value={form.password}
                     onChange={(e) => setForm({ ...form, password: e.target.value })}
                     placeholder="Ditt passord" autoFocus
                     data-testid="reset-password" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Avbryt</Button>
            <Button onClick={doReset} disabled={busy || !form.password || !form.confirm || !form.understand}
                    className="bg-red-700 hover:bg-red-800 text-white"
                    data-testid="confirm-reset-btn">
              <Trash2 className="h-4 w-4 mr-1" />{busy ? "Sletter..." : `Slett ${target?.label.toLowerCase()} permanent`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
