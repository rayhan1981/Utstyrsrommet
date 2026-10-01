import React, { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users as UsersIcon, UserCircle, Package, ArrowLeftRight,
  ClipboardCheck, ShieldCheck, Settings, LogOut, Menu, X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
  { to: "/lag", label: "Lag", icon: UsersIcon, module: "teams" },
  { to: "/personer", label: "Personer", icon: UserCircle, module: "people" },
  { to: "/utstyr", label: "Utstyr", icon: Package, module: "inventory" },
  { to: "/utlan", label: "Utlån & Retur", icon: ArrowLeftRight, module: "loans" },
  { to: "/varetelling", label: "Varetelling", icon: ClipboardCheck, module: "stock_audit" },
  { to: "/brukere", label: "Brukere", icon: ShieldCheck, module: "users", adminOnly: true },
  { to: "/innstillinger", label: "Innstillinger", icon: Settings, module: "settings" },
];

export default function Layout() {
  const { user, logout, hasPerm } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    nav("/innlogging");
  };

  const visible = NAV.filter((n) => (n.adminOnly ? user?.role === "admin" : hasPerm(n.module, "read")));

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile toggle */}
      <button
        data-testid="mobile-menu-toggle"
        className="lg:hidden fixed top-3 left-3 z-50 bg-white border border-slate-200 rounded-md p-2 shadow-sm"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 w-64 bg-white border-r border-slate-200 z-40 transform transition-transform ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center px-5 border-b border-slate-200 brand-gradient">
          <Link to="/" className="font-display text-white text-xl font-extrabold tracking-tight">
            UTSTYRS<span className="text-emerald-200">ROMMET</span>
          </Link>
        </div>
        <nav className="p-3 space-y-1" onClick={() => setOpen(false)}>
          {visible.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              data-testid={`nav-${n.module}`}
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-200 bg-white">
          <div className="text-xs text-slate-500 mb-2 px-2">
            <div className="font-semibold text-slate-800 truncate">{user?.name}</div>
            <div className="truncate">{user?.email}</div>
            <div className="mt-1 inline-flex items-center gap-1 text-emerald-800 font-semibold">
              {user?.role === "admin" ? "ADMIN" : "BRUKER"}
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout} data-testid="logout-btn">
            <LogOut className="h-4 w-4 mr-2" /> Logg ut
          </Button>
        </div>
      </aside>

      <main className="flex-1 lg:ml-0 min-w-0">
        <div className="p-4 sm:p-6 lg:p-8 pt-16 lg:pt-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
