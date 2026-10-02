import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import SetPassword from "@/pages/SetPassword";
import Dashboard from "@/pages/Dashboard";
import Teams from "@/pages/Teams";
import People from "@/pages/People";
import Inventory from "@/pages/Inventory";
import Loans from "@/pages/Loans";
import StockAudit from "@/pages/StockAudit";
import Users from "@/pages/Users";
import Settings from "@/pages/Settings";
import Subscription from "@/pages/Subscription";
import SubscriptionSuccess from "@/pages/SubscriptionSuccess";
import OwnerPanel from "@/pages/OwnerPanel";
import { Button } from "@/components/ui/button";
import { Crown, LogOut } from "lucide-react";
import { Toaster } from "sonner";

function OwnerShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-700" />
            <div className="font-display font-bold text-amber-900">UTSTYRSROMMET · Eier-panel</div>
            <span className="text-sm text-amber-800 ml-2">{user?.name}</span>
          </div>
          <Button variant="outline" size="sm" onClick={async () => { await logout(); nav("/innlogging"); }} data-testid="owner-logout-btn">
            <LogOut className="h-4 w-4 mr-2" />Logg ut
          </Button>
        </div>
      </header>
      <div className="max-w-7xl mx-auto p-6">
        <OwnerPanel />
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/innlogging" element={<Login />} />
          <Route path="/registrer" element={<Signup />} />
          <Route path="/sett-passord" element={<SetPassword />} />
          <Route path="/abonnement/suksess" element={<SubscriptionSuccess />} />
          <Route path="/eier" element={<ProtectedRoute ownerOnly needsTenant={false}><OwnerShell /></ProtectedRoute>} />
          <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="lag" element={<ProtectedRoute module="teams"><Teams /></ProtectedRoute>} />
            <Route path="personer" element={<ProtectedRoute module="people"><People /></ProtectedRoute>} />
            <Route path="utstyr" element={<ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>} />
            <Route path="utlan" element={<ProtectedRoute module="loans"><Loans /></ProtectedRoute>} />
            <Route path="varetelling" element={<ProtectedRoute module="stock_audit" feature="stock_audit"><StockAudit /></ProtectedRoute>} />
            <Route path="brukere" element={<ProtectedRoute module="users"><Users /></ProtectedRoute>} />
            <Route path="innstillinger" element={<ProtectedRoute module="settings" feature="settings"><Settings /></ProtectedRoute>} />
            <Route path="abonnement" element={<Subscription />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
