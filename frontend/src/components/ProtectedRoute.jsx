import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import UpgradeCTA from "@/components/UpgradeCTA";

export default function ProtectedRoute({ children, module, level = "read", feature, ownerOnly, needsTenant = true }) {
  const { user, loading, hasPerm, hasFeature, tenantId } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Laster…</div>;
  if (!user) return <Navigate to="/innlogging" replace />;
  if (ownerOnly && user.role !== "platform_owner") return <Navigate to="/app" replace />;

  // Owner without impersonation → send to owner panel
  if (needsTenant && user.role === "platform_owner" && !tenantId) {
    return <Navigate to="/eier" replace />;
  }

  if (module && !hasPerm(module, level)) {
    return <div className="p-8 text-center"><h2 className="text-xl font-semibold">Ingen tilgang</h2><p className="text-slate-600 text-sm mt-1">Du har ikke rettigheter til denne siden.</p></div>;
  }
  if (feature && !hasFeature(feature)) {
    return <UpgradeCTA feature={feature} />;
  }
  return children;
}
