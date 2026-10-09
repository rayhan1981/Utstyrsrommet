import React, { useState, useMemo, useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users as UsersIcon, UserCircle, Package, ArrowLeftRight,
  ClipboardCheck, ShieldCheck, Settings, LogOut, Menu, X, CreditCard, Crown, Eye, Building2, QrCode,
  ChevronDown, ChevronRight, SlidersHorizontal, PackagePlus, Truck, ShoppingCart, ClipboardList,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import NotificationCenter from "@/components/NotificationCenter";
import TrialBanner from "@/components/TrialBanner";

const PRIMARY_NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, module: "dashboard", feature: null },
  { to: "/app/utstyr", label: "Utstyr", icon: Package, module: "inventory", feature: null },
  { to: "/app/varemottak", label: "Varemottak", icon: PackagePlus, module: "inventory", feature: null },
  { to: "/app/behov", label: "Behov og behovsmeldinger", icon: ClipboardList, module: "teams", feature: null },
  { to: "/app/bestillinger", label: "Bestillinger", icon: ShoppingCart, module: "teams", feature: null },
  { to: "/app/leverandorer", label: "Leverandører", icon: Truck, module: "inventory", feature: null },
  { to: "/app/utlan", label: "Utlån & Retur", icon: ArrowLeftRight, module: "loans", feature: null },
  { to: "/app/skann", label: "Skann QR", icon: QrCode, module: "loans", feature: "qr_codes" },
  { to: "/app/varetelling", label: "Varetelling", icon: ClipboardCheck, module: "stock_audit", feature: "stock_audit" },
];

// Grouped under "Klubbinnstillinger"
const CLUB_NAV = [
  { to: "/app/lag", label: "Lag", icon: UsersIcon, module: "teams", feature: null },
  { to: "/app/personer", label: "Personer", icon: UserCircle, module: "people", feature: null },
  { to: "/app/innstillinger", label: "Klubb (logo/info)", icon: Settings, module: "settings", feature: "settings" },
];

const ADMIN_NAV = [
  { to: "/app/brukere", label: "Brukere", icon: ShieldCheck, module: "users", adminOnly: true, feature: null },
  { to: "/app/abonnement", label: "Abonnement", icon: CreditCard, module: null, adminOnly: true, feature: null },
];

export default function Layout() {
  const [clubLogo, setClubLogo] = useState("");
  useEffect(() => {
    api.get("/clubs").then((r) => {
      const c = (r.data || [])[0];
      if (c?.logo_url) setClubLogo(c.logo_url);
    }).catch(() => {});
  }, []);
  const { user, customer, club: activeClub, plan, impersonating, logout, hasPerm, hasFeature, stopImpersonate } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => { await logout(); nav("/innlogging"); };
  const stop = async () => { await stopImpersonate(); nav("/app"); };

  const canSee = (n) => {
    if (n.adminOnly && !(user?.role === "admin" || user?.role === "platform_owner")) return false;
    if (n.feature && !hasFeature(n.feature)) return false;
    if (n.module && !hasPerm(n.module, "read")) return false;
    return true;
  };

  const primary = PRIMARY_NAV.filter(canSee);
  const club = CLUB_NAV.filter(canSee);
  const admin = ADMIN_NAV.filter(canSee);

  const clubActive = useMemo(() => club.some((n) => loc.pathname.startsWith(n.to)), [club, loc.pathname]);
  const [clubOpen, setClubOpen] = useState(clubActive);
  // Auto-expand group when a child route becomes active
  React.useEffect(() => { if (clubActive) setClubOpen(true); }, [clubActive]);

  const isOwner = user?.role === "platform_owner";

  return (
    <div className="min-h-screen app-shell flex">
      <button data-testid="mobile-menu-toggle" className="lg:hidden fixed top-3 left-3 z-50 bg-white border border-slate-200 rounded-md p-2 shadow-sm" onClick={() => setOpen((o) => !o)}>
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      <aside className={`fixed lg:static inset-y-0 left-0 w-64 bg-white border-r border-slate-200 z-40 flex flex-col transform transition-transform ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="h-16 flex items-center px-4 border-b border-white/10 brand-gradient">
          <Link to="/app" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="UTSTYRSROMMET" className="h-10 w-10 object-contain shrink-0" style={{ filter: "drop-shadow(0 0 8px rgba(220,38,38,0.4))" }} />
            <div className="font-display text-white text-lg font-black tracking-tight leading-none">
              <span className="chrome-text">UTSTYRS</span><span className="red-gloss-text">ROMMET</span>
            </div>
          </Link>
        </div>
        {customer && (
          <div className={`px-4 py-3 border-b border-slate-200 ${isOwner && !impersonating ? "bg-amber-50" : "bg-slate-50"}`}>
            {user?.name && (
              <div className="flex items-start gap-1.5" data-testid="sidebar-user-identity">
                {isOwner && !impersonating && <Crown className="h-3.5 w-3.5 text-amber-700 mt-0.5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{user.name}</div>
                  {user.role_title && (
                    <div className="text-[11px] text-slate-500 truncate" data-testid="sidebar-user-role-title">{user.role_title}</div>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              {clubLogo && <img src={clubLogo} alt={activeClub?.name || customer.club_name} className="h-9 w-9 rounded-full object-cover border border-slate-300 shrink-0" data-testid="sidebar-club-logo" />}
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate" data-testid="sidebar-club-name">{activeClub?.name || customer.club_name}</div>
                <div className="text-xs text-slate-500">Kundenr: <span className="font-mono font-semibold">{customer.customer_number}</span></div>
              </div>
            </div>
            {plan && <div className="mt-1 inline-block text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-800">{plan.name}</div>}
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
          {primary.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/app"} data-testid={`nav-${(n.to.split("/").pop()) || n.module || "sub"}`} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <n.icon className="h-4 w-4" />{n.label}
            </NavLink>
          ))}

          {club.length > 0 && (
            <div className="pt-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setClubOpen((o) => !o)}
                data-testid="nav-klubbinnstillinger"
                className={`sidebar-link w-full justify-between ${clubActive ? "text-red-800 bg-red-50" : ""}`}
              >
                <span className="flex items-center gap-3"><SlidersHorizontal className="h-4 w-4" />Klubbinnstillinger</span>
                {clubOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {clubOpen && (
                <div className="pl-3 mt-1 space-y-1 border-l-2 border-red-200 ml-3" onClick={() => setOpen(false)}>
                  {club.map((n) => (
                    <NavLink key={n.to} to={n.to} data-testid={`nav-${n.module}`} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
                      <n.icon className="h-4 w-4" />{n.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}

          {admin.length > 0 && (
            <div className="pt-2 mt-2 border-t border-slate-200 space-y-1">
              {admin.map((n) => (
                <NavLink key={n.to} to={n.to} data-testid={`nav-${n.module || "sub"}`} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
                  <n.icon className="h-4 w-4" />{n.label}
                </NavLink>
              ))}
            </div>
          )}
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
            <div><a href="mailto:kontakt@utstyrsrommet.no" className="hover:text-red-800">kontakt@utstyrsrommet.no</a></div>
            <div><a href="mailto:support@utstyrsrommet.no" className="hover:text-red-800">support@utstyrsrommet.no</a></div>
            <div>Tlf. 90 96 70 88</div>
            <div className="pt-1 text-slate-400">© 2026 - 2036 Hansen Logistikk</div>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="h-12 border-b border-white/5 brand-gradient text-white flex items-center justify-end px-4 gap-3">
          <TrialBanner />
          <NotificationCenter />
        </div>
        {impersonating && (
          <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2"><Eye className="h-4 w-4" /><span><strong>Imitasjonsmodus:</strong> Du jobber som <strong>{customer?.club_name}</strong> ({customer?.customer_number})</span></div>
            <Button size="sm" variant="secondary" onClick={stop} data-testid="stop-impersonate-btn">Tilbake til mitt dashboard</Button>
          </div>
        )}
        <div className="p-4 sm:p-6 lg:p-8 pt-16 lg:pt-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
