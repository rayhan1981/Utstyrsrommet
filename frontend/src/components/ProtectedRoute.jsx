import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function ProtectedRoute({ children, module, level = "read" }) {
  const { user, loading, hasPerm } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Laster…</div>;
  if (!user) return <Navigate to="/innlogging" replace />;
  if (module && !hasPerm(module, level)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Ingen tilgang</h2>
          <p className="text-slate-600 text-sm">Du har ikke rettigheter til denne siden.</p>
        </div>
      </div>
    );
  }
  return children;
}
