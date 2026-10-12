import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { portalApi, setPortalToken, getPortalToken, formatPortalError } from "./portalApi";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, FilePlus2, ListChecks } from "lucide-react";
import { toast } from "sonner";

/** Avleder klubbens initialer til bruk når logo mangler. */
function clubInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "KL";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PortalLayout() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [portalDown, setPortalDown] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!getPortalToken()) { nav("/innlogging"); return; }
    portalApi.get("/auth/me")
      .then((r) => setMe(r.data))
      .catch((err) => {
        const status = err.response?.status;
        const detail = err.response?.data?.detail;
        if (status === 402) {
          setPortalDown(detail || "Klubbens portaltilgang er ikke aktiv. Kontakt klubbens administrator.");
          return;
        }
        if (status === 401 || status === 403) {
          toast.error(formatPortalError(detail));
          setPortalToken(null);
          nav("/innlogging");
          return;
        }
        toast.error(formatPortalError(detail));
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    try { await portalApi.post("/auth/logout"); } catch { /* noop */ }
    setPortalToken(null);
    nav("/innlogging");
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Laster…</div>;

  if (portalDown) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md bg-white border border-amber-300 rounded-lg p-6 shadow-sm" data-testid="portal-disabled-notice">
          <h2 className="text-lg font-bold text-amber-900">Lagsportal ikke aktiv</h2>
          <p className="text-sm text-slate-700 mt-2">{portalDown}</p>
          <Button className="mt-4" variant="outline" onClick={() => { setPortalToken(null); nav("/innlogging"); }}>Tilbake til innlogging</Button>
        </div>
      </div>
    );
  }

  if (!me) return null;

  const logo = me.club?.logo_url || "";

  return (
    <div className="min-h-screen bg-slate-50 relative">
      {/* Subtil sportsstripe-bakgrunn */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.035]"
        style={{
          backgroundImage: "repeating-linear-gradient(135deg, #7f1d1d 0 2px, transparent 2px 24px)",
        }}
      />
      <header className="relative bg-red-900 text-white border-b-4 border-amber-300 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {logo ? (
              <img
                src={logo}
                alt={me.club.name}
                className="h-12 w-12 rounded-full bg-white object-contain p-1 ring-2 ring-amber-300 shrink-0"
                data-testid="portal-club-logo"
              />
            ) : (
              <div
                className="h-12 w-12 rounded-full bg-white text-red-900 font-black flex items-center justify-center ring-2 ring-amber-300 shrink-0"
                data-testid="portal-club-initials"
              >
                {clubInitials(me.club.name)}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] opacity-70">Lagsportal</div>
              <div className="font-bold truncate text-lg leading-tight" data-testid="portal-header-club">{me.club.name}</div>
              <div className="text-sm opacity-90 truncate" data-testid="portal-header-team">
                {me.team.name}{me.team.age_class ? ` · ${me.team.age_class}` : ""}
              </div>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={logout} data-testid="portal-logout">
            <LogOut className="h-4 w-4 mr-1" />Logg ut
          </Button>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 text-sm">
          {[
            { to: "/", label: "Oversikt", icon: LayoutDashboard, end: true },
            { to: "/behov", label: "Behovsmeldinger", icon: ListChecks },
            { to: "/behov/nytt", label: "Meld utstyrsbehov", icon: FilePlus2 },
          ].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={`portal-nav-${n.to.replace(/\//g, "-") || "root"}`}
              className={({ isActive }) =>
                `px-3 py-2 flex items-center gap-1.5 border-b-2 ${isActive ? "border-amber-300 text-amber-200" : "border-transparent text-white/80 hover:text-white"}`
              }
            >
              <n.icon className="h-4 w-4" />{n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="relative max-w-5xl mx-auto px-4 py-6">
        <Outlet context={{ me }} />
      </main>
      <footer className="relative text-center text-[11px] text-slate-400 py-6">
        {me.club.name} · Lagsportal · drevet av <span className="font-semibold text-slate-500">UTSTYRSROMMET</span>
      </footer>
    </div>
  );
}
