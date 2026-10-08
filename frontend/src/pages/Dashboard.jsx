import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, ArrowLeftRight, Users as UsersIcon, UserCircle, TrendingUp, AlertTriangle, Clock, Mail, Building2, Users2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import TrialDashboardCard from "@/components/TrialDashboardCard";

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

function NavTile({ icon: Icon, title, subtitle, to, testid }) {
  const nav = useNavigate();
  return (
    <button type="button" onClick={() => nav(to)} data-testid={testid}
            className="group relative overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-red-900 to-red-700 text-white p-6 flex flex-col items-start gap-2 hover:shadow-xl hover:scale-[1.02] transition">
      <div className="h-12 w-12 rounded-md bg-white/10 flex items-center justify-center ring-1 ring-white/20 group-hover:bg-white/20 transition">
        <Icon className="h-6 w-6" />
      </div>
      <div className="text-left">
        <div className="font-display font-bold text-xl uppercase tracking-wide">{title}</div>
        <div className="text-xs opacity-80 mt-0.5">{subtitle}</div>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const { customer, plan } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [clubLogo, setClubLogo] = useState("");

  useEffect(() => {
    api.get("/dashboard/stats").then((r) => setStats(r.data)).catch(() => {});
    api.get("/activity-log", { params: { limit: 10 } }).then((r) => setActivity(r.data)).catch(() => {});
    api.get("/clubs").then((r) => {
      const first = (r.data || [])[0];
      if (first?.logo_url) setClubLogo(first.logo_url);
    }).catch(() => {});
  }, []);

  const loadAllActivity = async () => {
    try {
      const { data } = await api.get("/activity-log", { params: { limit: 100 } });
      setActivity(data); setShowAllActivity(true);
    } catch { toast.error("Kunne ikke hente aktivitet"); }
  };

  if (!stats) return <div className="text-slate-500">Laster…</div>;
  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {/* Klubblogo + Velkomst */}
      <div className="flex flex-col items-center gap-3 pb-2">
        <div className="h-24 w-24 rounded-full bg-white border-2 border-red-900 flex items-center justify-center overflow-hidden shadow-lg">
          {clubLogo ? (
            <img src={clubLogo} alt={customer?.club_name || "Klubb"} className="h-full w-full object-contain" data-testid="dashboard-club-logo" />
          ) : (
            <ImageIcon className="h-10 w-10 text-slate-300" />
          )}
        </div>
        <div className="text-center">
          <h1 className="font-display text-3xl font-extrabold text-slate-900">{customer?.club_name || "Dashboard"}</h1>
          <p className="text-slate-600 text-sm mt-1">
            Pakke: <strong>{plan?.name || "-"}</strong>
            {customer?.status === "trial" && <span className="ml-2 inline-block text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">Prøveperiode</span>}
          </p>
        </div>
      </div>

      {/* Hurtignavigasjon */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <NavTile icon={Building2} title="KLUBB" subtitle="Logo, kontaktinfo og klubbinnstillinger" to="/app/klubb" testid="nav-tile-klubb" />
        <NavTile icon={UserCircle} title="PERSONER" subtitle="Medlemmer, spillere og trenere" to="/app/personer" testid="nav-tile-personer" />
        <NavTile icon={Users2} title="LAG" subtitle="Lag, trenere og lagledere" to="/app/lag" testid="nav-tile-lag" />
      </div>

      <TrialDashboardCard />

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
            <TrendingUp className="h-5 w-5 text-red-700" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="border border-slate-200 rounded-md p-4"><div className="text-xs uppercase font-semibold text-slate-500">Lagerverdi</div><div className="font-display text-xl font-bold text-red-900 mt-1">{nok(stats.stock_value)}</div></div>
            <div className="border border-slate-200 rounded-md p-4"><div className="text-xs uppercase font-semibold text-slate-500">Lag skylder</div><div className="font-display text-xl font-bold text-red-700 mt-1">{nok(stats.team_debt)}</div></div>
            <div className="border border-slate-200 rounded-md p-4"><div className="text-xs uppercase font-semibold text-slate-500">Personer skylder</div><div className="font-display text-xl font-bold text-red-700 mt-1">{nok(stats.person_debt)}</div></div>
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

      {/* Siste aktivitet */}
      <Card className="p-5" data-testid="activity-feed">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg font-bold">Siste aktivitet</h3>
          {!showAllActivity && activity.length >= 10 && (
            <Button variant="outline" size="sm" onClick={loadAllActivity} data-testid="show-more-activity">Vis mer (opp til 100)</Button>
          )}
        </div>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen aktivitet registrert ennå.</p>
        ) : (
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {activity.map((a) => (
              <div key={a.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{a.description}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {a.by_name || a.by || "System"} · {new Date(a.at).toLocaleString("nb-NO")}
                  </div>
                </div>
                <span className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 shrink-0">{(a.action || "").replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <DueSoonWidget rows={stats.due_soon || []} />
    </div>
  );
}

function DueSoonWidget({ rows }) {
  const grouped = rows.reduce((acc, r) => {
    const k = r.team_id || "__none__";
    acc[k] = acc[k] || { team_name: r.team_name || "Uten lag", team_id: r.team_id, loans: [] };
    acc[k].loans.push(r);
    return acc;
  }, {});
  const teams = Object.values(grouped);

  return (
    <Card className="p-5" data-testid="due-soon-widget">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-5 w-5 text-amber-600" />
        <h3 className="font-display text-lg font-bold">Lån med frist denne uka</h3>
        <span className="text-xs text-slate-500 ml-auto">{rows.length} linjer</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Ingen lån har frist de neste 7 dagene.</p>
      ) : (
        <div className="space-y-3">
          {teams.map((t) => (
            <div key={t.team_id || "none"} className="border border-slate-200 rounded-md overflow-hidden" data-testid={`due-team-${t.team_id || "none"}`}>
              <div className="bg-slate-50 px-3 py-2 font-semibold text-sm">{t.team_name} <span className="text-slate-500 font-normal">({t.loans.length})</span></div>
              <ul className="divide-y divide-slate-100 text-sm">
                {t.loans.map((l) => {
                  const label = l.is_overdue ? `${Math.abs(l.days_until_due)} dag(er) over frist` :
                                 l.days_until_due === 0 ? "Forfaller i dag" :
                                 `${l.days_until_due} dager igjen`;
                  const color = l.is_overdue ? "bg-red-100 text-red-800" :
                                 l.days_until_due <= 2 ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800";
                  return (
                    <li key={l.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="truncate">
                        <span className="font-medium">{l.item_name}</span>
                        {l.size && <span className="text-xs text-slate-500 ml-1 font-mono">{l.size}</span>}
                        <span className="text-xs text-slate-500 ml-2">× {l.quantity}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {l.amount_owed > 0 && <span className="text-xs text-red-700 font-semibold">{(l.amount_owed || 0).toLocaleString("nb-NO", { style:"currency", currency:"NOK", maximumFractionDigits:0 })}</span>}
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${color}`}>{label}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
