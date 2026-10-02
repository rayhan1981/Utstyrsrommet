import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

export const api = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("utr_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function formatError(detail) {
  if (detail == null) return "Noe gikk galt. Prøv igjen.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export const PERMS = ["none", "read", "write", "admin"];
export const MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "teams", label: "Lag" },
  { key: "people", label: "Personer" },
  { key: "inventory", label: "Utstyr" },
  { key: "loans", label: "Utlån" },
  { key: "stock_audit", label: "Varetelling" },
  { key: "users", label: "Brukere" },
  { key: "settings", label: "Innstillinger" },
];

export const BALL_SIZES = ["00 Mykball", "Street håndball", "00", "0", "1", "2", "3"];

export const TEAM_NAME_OPTIONS = [
  "Jenter 7", "Jenter 8", "Jenter 9", "Jenter 10", "Jenter 11", "Jenter 12", "Jenter 13",
  "Jenter 14", "Jenter 15", "Jenter 16", "Jenter 17", "Jenter 18", "Jenter 19", "Jenter 20",
  "Gutter 7", "Gutter 8", "Gutter 9", "Gutter 10", "Gutter 11", "Gutter 12", "Gutter 13",
  "Gutter 14", "Gutter 15", "Gutter 16", "Gutter 17", "Gutter 18", "Gutter 19", "Gutter 20",
  "6. divisjon", "5. divisjon", "4. divisjon", "3. divisjon", "2. divisjon", "1. divisjon",
  "Senior Herrer", "Senior Damer",
];

export const YEARS_ENGAGED = ["< 1 år", "1 år", "2 år", "3 år", "4 år", "5 år", "6-10 år", "10+ år"];
