import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    }
  };

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.token) localStorage.setItem("utr_token", data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    localStorage.removeItem("utr_token");
    setUser(false);
  };

  const hasPerm = (module, level = "read") => {
    if (!user) return false;
    if (user.role === "admin") return true;
    const order = { none: 0, read: 1, write: 2, admin: 3 };
    return (order[user.permissions?.[module] || "none"] || 0) >= (order[level] || 0);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, setUser, hasPerm }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
