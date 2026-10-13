import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
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
import HelpCenter from "@/pages/HelpCenter";
import Subscription from "@/pages/Subscription";
import SubscriptionSuccess from "@/pages/SubscriptionSuccess";
import OwnerPanel from "@/pages/OwnerPanel";
import Scan from "@/pages/Scan";
import Varemottak from "@/pages/Varemottak";
import Leverandorer from "@/pages/Leverandorer";
import Bestillinger from "@/pages/Bestillinger";
import Behov from "@/pages/Behov";
import Terms from "@/pages/Terms";
import TeamPortalAccounts from "@/pages/TeamPortalAccounts";
import NeedsRequests from "@/pages/NeedsRequests";
import PortalApp from "@/portal/PortalApp";
import { Toaster } from "sonner";

// Portal-kontekst: aktiveres av `/portal/*`-path (produksjon), `portal.*`-hostname
// (hvis plattformen senere støtter flere domener), eller `?portal=1` (preview-fallback).
function detectPortalContext() {
  if (typeof window === "undefined") return { portal: false, basename: "" };
  const host = (window.location.hostname || "").toLowerCase();
  const path = window.location.pathname || "";
  const search = window.location.search || "";
  if (host.startsWith("portal.")) return { portal: true, basename: "" };
  if (path === "/portal" || path.startsWith("/portal/")) return { portal: true, basename: "/portal" };
  if (search.includes("portal=1")) return { portal: true, basename: "" };
  return { portal: false, basename: "" };
}

function App() {
  const ctx = detectPortalContext();
  // Lagsportalen monteres helt uten klubbappens AuthProvider / routes.
  if (ctx.portal) {
    return (
      <BrowserRouter basename={ctx.basename}>
        <PortalApp />
      </BrowserRouter>
    );
  }
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/innlogging" element={<Login />} />
          <Route path="/registrer" element={<Signup />} />
          <Route path="/sett-passord" element={<SetPassword />} />
          <Route path="/vilkar" element={<Terms />} />
          <Route path="/abonnement/suksess" element={<SubscriptionSuccess />} />
          <Route path="/app" element={<ProtectedRoute needsTenant={false}><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="lag" element={<ProtectedRoute module="teams"><Teams /></ProtectedRoute>} />
            <Route path="personer" element={<ProtectedRoute module="people"><People /></ProtectedRoute>} />
            <Route path="utstyr" element={<ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>} />
            <Route path="utlan" element={<ProtectedRoute module="loans"><Loans /></ProtectedRoute>} />
            <Route path="varetelling" element={<ProtectedRoute module="stock_audit" feature="stock_audit"><StockAudit /></ProtectedRoute>} />
            <Route path="brukere" element={<ProtectedRoute module="users"><Users /></ProtectedRoute>} />
            <Route path="innstillinger" element={<ProtectedRoute module="settings" feature="settings"><Settings /></ProtectedRoute>} />
            <Route path="abonnement" element={<Subscription />} />
            <Route path="kunder" element={<ProtectedRoute ownerOnly needsTenant={false}><OwnerPanel /></ProtectedRoute>} />
            <Route path="skann" element={<ProtectedRoute module="loans" feature="qr_codes"><Scan /></ProtectedRoute>} />
            <Route path="varemottak" element={<ProtectedRoute module="inventory"><Varemottak /></ProtectedRoute>} />
            <Route path="leverandorer" element={<ProtectedRoute module="inventory"><Leverandorer /></ProtectedRoute>} />
            <Route path="bestillinger" element={<ProtectedRoute module="teams"><Bestillinger /></ProtectedRoute>} />
            <Route path="behov" element={<ProtectedRoute module="teams"><Behov /></ProtectedRoute>} />
            <Route path="innmeldte-behov" element={<ProtectedRoute module="teams"><NeedsRequests /></ProtectedRoute>} />
            <Route path="innmeldte-behov/:id" element={<ProtectedRoute module="teams"><NeedsRequests /></ProtectedRoute>} />
            <Route path="lagspalogginger" element={<ProtectedRoute module="teams"><TeamPortalAccounts /></ProtectedRoute>} />
            <Route path="hjelpesenter" element={<HelpCenter />} />
          </Route>
          <Route path="/eier" element={<Navigate to="/app/kunder" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
