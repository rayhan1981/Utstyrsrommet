import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import Dashboard from "@/pages/Dashboard";
import Teams from "@/pages/Teams";
import People from "@/pages/People";
import Inventory from "@/pages/Inventory";
import Loans from "@/pages/Loans";
import StockAudit from "@/pages/StockAudit";
import Users from "@/pages/Users";
import Settings from "@/pages/Settings";
import { Toaster } from "sonner";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/innlogging" element={<Login />} />
          <Route path="/sett-passord" element={<SetPassword />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/lag" element={<ProtectedRoute module="teams"><Teams /></ProtectedRoute>} />
            <Route path="/personer" element={<ProtectedRoute module="people"><People /></ProtectedRoute>} />
            <Route path="/utstyr" element={<ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>} />
            <Route path="/utlan" element={<ProtectedRoute module="loans"><Loans /></ProtectedRoute>} />
            <Route path="/varetelling" element={<ProtectedRoute module="stock_audit"><StockAudit /></ProtectedRoute>} />
            <Route path="/brukere" element={<ProtectedRoute module="users"><Users /></ProtectedRoute>} />
            <Route path="/innstillinger" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
