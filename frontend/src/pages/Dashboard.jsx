import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Package, ArrowLeftRight, Users as UsersIcon, UserCircle, TrendingUp, AlertTriangle } from "lucide-react";

function Stat({ icon: Icon, label, value, color = "emerald", testid }) {
  return (
    <Card className="p-5" data-testid={testid}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
          <div className="font-display text-2xl font-extrabold mt-1 text-slate-900">{value}</div>
        </div>
        <div className={`h-10 w-10 rounded-md flex items-center justify-center bg-${color}-100 text-${color}-800`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { customer, plan } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => { api.get("/dashboard/stats").then((r) => setStats(r.data)).catch(() => {}); }, []);

  if (!stats) return <div className="text-slate-500">Laster…</div>;
  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="font-display text-3xl font-extrabold text-slate-900">Dashboard</h1>
        <p className="text-slate-600 text-sm mt-1">
          {customer?.club_name && <>Velkommen, <strong>{customer.club_name}</strong>. </>}Pakke: <strong>{plan?.name || "-"}</strong>
          {customer?.status === "trial" && <span className="ml-2 inline-block text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">Prøveperiode</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Package} label="Varer" value={stats.total_items} testid="stat-items" />
        <Stat icon={ArrowLeftRight} label="Aktive utlån" value={stats.active_loans} testid="stat-loans" />
        <Stat icon={UsersIcon} label="Lag" value={stats.teams} testid="stat-teams" />
        <Stat icon={UserCircle} label="Personer" value={stats.people} testid="stat-people" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg font-bold">Økonomisk oversikt</h3>
            <TrendingUp className="h-5 w-5 text-emerald-700" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="border border-slate-200 rounded-md p-4">
              <div className="text-xs uppercase font-semibold text-slate-500">Lagerverdi</div>
              <div className="font-display text-xl font-bold text-emerald-900 mt-1">{nok(stats.stock_value)}</div>
            </div>
            <div className="border border-slate-200 rounded-md p-4">
              <div className="text-xs uppercase font-semibold text-slate-500">Lag skylder</div>
              <div className="font-display text-xl font-bold text-red-700 mt-1">{nok(stats.team_debt)}</div>
            </div>
            <div className="border border-slate-200 rounded-md p-4">
              <div className="text-xs uppercase font-semibold text-slate-500">Personer skylder</div>
              <div className="font-display text-xl font-bold text-red-700 mt-1">{nok(stats.person_debt)}</div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="font-display text-lg font-bold">Lav beholdning</h3>
          </div>
          {stats.low_stock_items.length === 0 ? (
            <p className="text-sm text-slate-500">Ingen varer med lav beholdning.</p>
          ) : (
            <ul className="space-y-2">
              {stats.low_stock_items.map((i) => (
                <li key={i.name} className="flex items-center justify-between text-sm">
                  <span className="truncate">{i.name}</span>
                  <span className="font-semibold text-amber-700">{i.total_stock}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-display text-lg font-bold mb-3">Siste aktivitet</h3>
        {stats.recent_loans.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen utlån registrert ennå.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {stats.recent_loans.map((l) => (
              <div key={l.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{l.item_name} × {l.quantity}</div>
                  <div className="text-xs text-slate-500">{new Date(l.loan_date).toLocaleString("nb-NO")}</div>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${l.status === "returned" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>
                  {l.status === "returned" ? "Returnert" : "Utlånt"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
