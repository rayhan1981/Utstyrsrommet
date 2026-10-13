import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

// Egen axios-instans for lagsportalen (utstyrsrommet.no/portal) – isolert fra klubbappens api.
export const portalApi = axios.create({
  baseURL: `${BASE}/api/portal`,
  withCredentials: true,
});

const PORTAL_TOKEN_KEY = "portal_token";

portalApi.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(PORTAL_TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export function setPortalToken(token) {
  if (token) localStorage.setItem(PORTAL_TOKEN_KEY, token);
  else localStorage.removeItem(PORTAL_TOKEN_KEY);
}

export function getPortalToken() {
  return localStorage.getItem(PORTAL_TOKEN_KEY);
}

// Helper for å gjøre set-password/reset-password mot hovedbakenden (ikke under /api/portal/...-prefikset)
export const portalRootApi = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
});

export function formatPortalError(detail) {
  if (!detail) return "Noe gikk galt. Prøv igjen.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg || JSON.stringify(d)).join(", ");
  return JSON.stringify(detail);
}
