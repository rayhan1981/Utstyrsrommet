import React, { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users as UsersIcon, UserCircle, Package, ArrowLeftRight,
  ClipboardCheck, ShieldCheck, Settings, LogOut, Menu, X, CreditCard, Crown, Eye, Building2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const BASE_NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, module: "dashboard", feature: null },
  { to: "/app/lag", label: "Lag", icon: UsersIcon, module: "teams", feature: null },
  { to: "/app/personer", label: "Personer", icon: UserCircle, module: "people", feature: null },
  { to: "/app/utstyr", label: "Utstyr", icon: Package, module: "inventory", feature: null },
  { to: "/app/utlan", label: "Utlån & Retur", icon: ArrowLeftRight, module: "loans", feature: null },
  { to: "/app/varetelling", label: "Varetelling", icon: ClipboardCheck, module: "stock_audit", feature: "stock_audit" },
  { to: "/app/brukere", label: "Brukere", icon: ShieldCheck, module: "users", adminOnly: true, feature: null },
  { to: "/app/innstillinger", label: "Innstillinger", icon: Settings, module: "settings", feature: "settings" },
  { to: "/app/abonnement", label: "Abonnement", icon: CreditCard, module: null, adminOnly: true, feature: null },
];

export default function Layout() {
  const { user, customer, plan, impersonating, logout, hasPerm, hasFeature, stopImpersonate } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => { await logout(); nav("/innlogging"); };
  const stop = async () => { await stopImpersonate(); nav("/app"); };

  const visible = BASE_NAV.filter((n) => {
    if (n.adminOnly && !(user?.role === "admin" || user?.role === "platform_owner")) return false;
    if (n.feature && !hasFeature(n.feature)) return false;
    if (n.module && !hasPerm(n.module, "read")) return false;
    return true;
  });

  const isOwner = user?.role === "platform_owner";

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <button data-testid="mobile-menu-toggle" className="lg:hidden fixed top-3 left-3 z-50 bg-white border border-slate-200 rounded-md p-2 shadow-sm" onClick={() => setOpen((o) => !o)}>
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      <aside className={`fixed lg:static inset-y-0 left-0 w-64 bg-white border-r border-slate-200 z-40 flex flex-col transform transition-transform ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="h-16 flex items-center px-5 border-b border-slate-200 brand-gradient">
          <Link to="/app" className="font-display text-white text-xl font-extrabold tracking-tight">UTSTYRS<span className="text-emerald-200">ROMMET</span></Link>
        </div>
        {customer && (
          <div className={`px-4 py-3 border-b border-slate-200 ${isOwner && !impersonating ? "bg-amber-50" : "bg-slate-50"}`}>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              {isOwner && !impersonating && <Crown className="h-3 w-3 text-amber-700" />}
              {isOwner && !impersonating ? "Plattformeier - din klubb" : "Kunde"}
            </div>
            <div className="font-semibold text-sm truncate">{customer.club_name}</div>
            <div className="text-xs text-slate-500 mt-0.5">Kundenr: <span className="font-mono font-semibold">{customer.customer_number}</span></div>
            {plan && <div className="mt-1 inline-block text-xs font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">{plan.name}</div>}
          </div>
        )}
        <nav className="p-3 space-y-1 overflow-y-auto flex-1" onClick={() => setOpen(false)}>
          {isOwner && (
            <div className="mb-2 pb-2 border-b border-slate-200 space-y-1">
              <button
                type="button"
                data-testid="nav-my-dashboard"
                onClick={async () => { if (impersonating) { await stopImpersonate(); } nav("/app"); }}
                className={`sidebar-link w-full ${!impersonating ? "bg-amber-50 text-amber-900 ring-2 ring-amber-400" : "bg-amber-50 text-amber-900 hover:ring-2 hover:ring-amber-300"}`}
              >
                <Crown className="h-4 w-4" />Mitt dashboard
              </button>
              <NavLink
                to="/app/kunder"
                data-testid="nav-customers"
                className={({ isActive }) => `sidebar-link bg-amber-50 text-amber-900 ${isActive ? "ring-2 ring-amber-500" : "hover:ring-2 hover:ring-amber-300"}`}
              >
                <Building2 className="h-4 w-4" />Kunder & imitasjon
              </NavLink>
            </div>
          )}
          {visible.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/app"} data-testid={`nav-${n.module || "sub"}`} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <n.icon className="h-4 w-4" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 bg-white">
          <div className="p-3">
            <div className="text-xs text-slate-500 mb-2 px-2">
              <div className="font-semibold text-slate-800 truncate">{user?.name}</div>
              <div className="truncate">{user?.email}</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={handleLogout} data-testid="logout-btn">
              <LogOut className="h-4 w-4 mr-2" />Logg ut
            </Button>
          </div>
          <div className="px-4 py-3 text-[10px] leading-relaxed text-slate-500 border-t border-slate-100 bg-slate-50 space-y-0.5">
            <div className="font-semibold text-slate-700">Hansen Logistikk</div>
            <div>Designet og utviklet av Raymond Dalgård Hansen</div>
            <div>Versjon 1.00 · 2026</div>
            <div><a href="mailto:hansenlogistikk@gmail.com" className="hover:text-emerald-800">hansenlogistikk@gmail.com</a></div>
            <div>Tlf. 90 96 70 88</div>
            <div className="pt-1 text-slate-400">© 2026 - 2036 Hansen Logistikk</div>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {impersonating && (
          <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2"><Eye className="h-4 w-4" /><span><strong>Imitasjonsmodus:</strong> Du jobber som <strong>{customer?.club_name}</strong> ({customer?.customer_number})</span></div>
            <Button size="sm" variant="secondary" onClick={stop} data-testid="stop-impersonate-btn">Tilbake til mitt dashboard</Button>
          </div>
        )}
        <div className="p-4 sm:p-6 lg:p-8 pt-16 lg:pt-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
