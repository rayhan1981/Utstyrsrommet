import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { data } = await api.get("/auth/me");
      setMe(data);
      return data;
    } catch {
      setMe(false);
      return null;
    }
  };

  useEffect(() => { (async () => { await refresh(); setLoading(false); })(); }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.token) localStorage.setItem("utr_token", data.token);
    const m = await refresh();
    return m;
  };

  const signup = async (payload) => {
    const { data } = await api.post("/signup", payload);
    if (data.token) localStorage.setItem("utr_token", data.token);
    await refresh();
    return data;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("utr_token");
    setMe(false);
  };

  const impersonate = async (customerId) => {
    await api.post(`/owner/impersonate/${customerId}`);
    await refresh();
  };

  const stopImpersonate = async () => {
    await api.post("/owner/stop-impersonate");
    await refresh();
  };

  const user = me?.user;
  const tenantId = me?.tenant_id;
  const customer = me?.customer;
  const club = me?.club;
  const plan = me?.plan;
  const impersonating = me?.impersonating;

  const hasPerm = (module, level = "read") => {
    if (!user) return false;
    if (user.role === "platform_owner") return true;
    // Expired-subscription blokkerer write/admin for alle untatt platform_owner
    const status = customer?.subscription_status || customer?.status;
    const order = { none: 0, read: 1, write: 2, admin: 3 };
    if ((order[level] || 0) >= 2 && (status === "expired" || status === "cancelled")) return false;
    if (user.role === "admin") return true;
    return (order[user.permissions?.[module] || "none"] || 0) >= (order[level] || 0);
  };

  const hasFeature = (feature) => {
    if (user?.role === "platform_owner") return true;
    return !!plan?.[feature];
  };

  return (
    <AuthContext.Provider value={{ me, user, tenantId, customer, club, plan, impersonating, loading, login, signup, logout, refresh, hasPerm, hasFeature, impersonate, stopImpersonate }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
