import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Crown, Building2, UserCheck, UserX, Trash2, TrendingUp, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

function Stat({ label, value, color = "amber", testid }) {
  return (
    <Card className="p-5" data-testid={testid}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-display text-3xl font-black mt-1 text-${color}-800`}>{value}</div>
    </Card>
  );
}

export default function OwnerStandaloneDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/owner/customers")
      .then((r) => setCustomers(r.data))
      .catch((e) => toast.error(formatError(e.response?.data?.detail)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-500">Laster…</div>;

  const total = customers.length;
  const active = customers.filter((c) => c.status === "active" && !c.deleted_at).length;
  const trial = customers.filter((c) => c.subscription_status === "trial" || c.status === "trial").length;
  const inactive = customers.filter((c) => c.status === "inactive" && !c.deleted_at).length;
  const deleted = customers.filter((c) => c.deleted_at).length;
  const deluxe = customers.filter((c) => c.plan === "deluxe" && !c.deleted_at).length;
  const recent = [...customers]
    .filter((c) => !c.deleted_at)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 5);

  return (
    <div className="space-y-6" data-testid="owner-standalone-dashboard">
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center shadow-sm">
          <Crown className="h-7 w-7 text-amber-700" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-extrabold text-slate-900">Plattformeier</h1>
          <p className="text-slate-600 text-sm">
            Velkommen, <strong>{user?.name}</strong>. Du er logget inn som plattformeier – ingen klubbkontekst er aktiv.
          </p>
        </div>
      </div>

      <Card className="p-5 bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <Building2 className="h-6 w-6 text-amber-700 shrink-0" />
          <div className="flex-1">
            <h2 className="font-bold text-amber-900">Logg inn som kunde</h2>
            <p className="text-sm text-slate-700 mt-1">
              For å jobbe inne i en spesifikk klubbs arbeidsområde må du først gå til <strong>Kunder & imitasjon</strong> og trykke
              «Logg inn som» på kunden. Dette aktiverer impersonering og låser opp alle klubbens funksjoner (inkludert
              felt-overstyring og permanent sletting).
            </p>
            <Button onClick={() => nav("/app/kunder")} className="mt-3 bg-amber-700 hover:bg-amber-800 text-white" data-testid="go-to-customers-btn">
              <Building2 className="h-4 w-4 mr-2" />Åpne kunder & imitasjon
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Totalt kunder" value={total} testid="owner-stat-total" />
        <Stat label="Aktive" value={active} color="green" testid="owner-stat-active" />
        <Stat label="Prøveperiode" value={trial} color="blue" testid="owner-stat-trial" />
        <Stat label="Deaktivert" value={inactive} color="rose" testid="owner-stat-inactive" />
        <Stat label="Premium-kunder" value={deluxe} color="purple" testid="owner-stat-deluxe" />
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-5 w-5 text-amber-700" />
          <h3 className="font-display text-lg font-bold">Siste 5 nye kunder</h3>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen kunder enda.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((c) => (
              <li key={c.id} data-testid={`owner-recent-${c.customer_number}`}>
                <button
                  type="button"
                  onClick={() => nav("/app/kunder")}
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-amber-50/60 rounded-md px-2"
                >
                  <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{c.customer_number}</span>
                  <span className="font-semibold flex-1 truncate">{c.club_name}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-100 text-red-800 uppercase">{c.plan}</span>
                  <span className="text-xs text-slate-500">{c.created_at ? new Date(c.created_at).toLocaleDateString("nb-NO") : "–"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {deleted > 0 && (
        <Card className="p-5 border-rose-200 bg-rose-50/60">
          <div className="flex items-center gap-2 text-rose-900 font-semibold">
            <Trash2 className="h-5 w-5" />
            {deleted} kundekonto{deleted === 1 ? "" : "er"} er markert slettet (soft delete). Åpne «Kunder & imitasjon» for å gjenopprette eller slette permanent.
          </div>
        </Card>
      )}
    </div>
  );
}
