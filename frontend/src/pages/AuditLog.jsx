import React, { useEffect, useState, useMemo } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Crown, Search, ChevronDown, ChevronRight, FileText, Globe, Filter, X, Calendar } from "lucide-react";

const ACTION_COLORS = {
  owner_field_override: "bg-amber-100 text-amber-900",
  hard_delete: "bg-rose-100 text-rose-900",
  delete_item: "bg-rose-50 text-rose-700",
  delete_variant: "bg-rose-50 text-rose-700",
  team_portal_account_deleted: "bg-rose-50 text-rose-700",
  create_loan: "bg-blue-50 text-blue-800",
  return_loan: "bg-emerald-50 text-emerald-800",
  needs_closed: "bg-slate-100 text-slate-700",
  needs_start_processing: "bg-sky-100 text-sky-800",
};

function actionBadgeCls(action) {
  if (!action) return "bg-slate-100 text-slate-700";
  if (ACTION_COLORS[action]) return ACTION_COLORS[action];
  if (action.includes("delete")) return "bg-rose-50 text-rose-700";
  if (action.includes("create")) return "bg-blue-50 text-blue-800";
  if (action.includes("update") || action.includes("edit")) return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export default function AuditLog() {
  const { user } = useAuth();
  const isOwner = user?.role === "platform_owner";

  const [mode, setMode] = useState(isOwner ? "all" : "own"); // "own" | "all"
  const [filters, setFilters] = useState({ q: "", action: "", user_id: "", tenant_id: "", from_date: "", to_date: "" });
  const [data, setData] = useState({ items: [], total: 0, distinct_actions: [], distinct_users: [] });
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const PAGE_SIZE = 100;

  // Last kundeliste for owner
  useEffect(() => {
    if (!isOwner) return;
    api.get("/owner/customers").then((r) => setCustomers(r.data)).catch(() => {});
  }, [isOwner]);

  const fetchLog = async (resetPage = false) => {
    setLoading(true);
    const skip = resetPage ? 0 : page * PAGE_SIZE;
    if (resetPage) setPage(0);
    try {
      const endpoint = mode === "all" ? "/owner/activity-log/all" : "/activity-log/search";
      const params = { limit: PAGE_SIZE, skip };
      if (filters.q) params.q = filters.q;
      if (filters.action) params.action = filters.action;
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;
      if (mode === "all" && filters.tenant_id) params.tenant_id = filters.tenant_id;
      if (mode === "own" && filters.user_id) params.user_id = filters.user_id;
      const { data } = await api.get(endpoint, { params });
      setData(data);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchLog(true); }, [mode]); // eslint-disable-line
  useEffect(() => { fetchLog(false); }, [page]); // eslint-disable-line

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
  const canOwnerMode = isOwner;
  const activeFilters = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);

  return (
    <div className="space-y-5" data-testid="audit-log-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold flex items-center gap-2">
            {mode === "all" && isOwner && <Crown className="h-6 w-6 text-amber-600" />}
            Aktivitetslogg
          </h1>
          <p className="text-slate-600 text-sm">
            {mode === "all" ? "Kryss-tenant historikk (kun plattformeier)" : "Historikk for klubbens egne handlinger"}
          </p>
        </div>
        {canOwnerMode && (
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setMode("own")}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 ${mode === "own" ? "bg-red-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              data-testid="audit-mode-own"
            >
              <FileText className="h-4 w-4" />Klubbens egen
            </button>
            <button
              type="button"
              onClick={() => setMode("all")}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 ${mode === "all" ? "bg-amber-700 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              data-testid="audit-mode-all"
            >
              <Globe className="h-4 w-4" />Alle kunder
            </button>
          </div>
        )}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-sm flex items-center gap-1.5">
            <Filter className="h-4 w-4" />Filtre {activeFilters > 0 && <span className="text-xs bg-red-100 text-red-800 px-1.5 py-0.5 rounded">{activeFilters}</span>}
          </div>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { setFilters({ q: "", action: "", user_id: "", tenant_id: "", from_date: "", to_date: "" }); setTimeout(() => fetchLog(true), 50); }} data-testid="audit-clear-filters">
              <X className="h-3.5 w-3.5 mr-1" />Nullstill
            </Button>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); fetchLog(true); }} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs">Fritekst</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Beskrivelse, action, bruker…"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                data-testid="audit-search-input"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Handling</Label>
            <Select value={filters.action || "__all__"} onValueChange={(v) => setFilters({ ...filters, action: v === "__all__" ? "" : v })}>
              <SelectTrigger data-testid="audit-action-select"><SelectValue placeholder="Alle" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Alle handlinger</SelectItem>
                {(data.distinct_actions || []).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {mode === "all" ? (
            <div>
              <Label className="text-xs">Klubb</Label>
              <Select value={filters.tenant_id || "__all__"} onValueChange={(v) => setFilters({ ...filters, tenant_id: v === "__all__" ? "" : v })}>
                <SelectTrigger data-testid="audit-tenant-select"><SelectValue placeholder="Alle" /></SelectTrigger>
                <SelectContent className="max-h-[400px]">
                  <SelectItem value="__all__">Alle kunder</SelectItem>
                  {customers.filter((c) => !c.deleted_at).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.customer_number} · {c.club_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Bruker</Label>
              <Select value={filters.user_id || "__all__"} onValueChange={(v) => setFilters({ ...filters, user_id: v === "__all__" ? "" : v })}>
                <SelectTrigger data-testid="audit-user-select"><SelectValue placeholder="Alle" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Alle brukere</SelectItem>
                  {(data.distinct_users || []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />Fra</Label>
            <Input type="date" value={filters.from_date?.slice(0, 10) || ""} onChange={(e) => setFilters({ ...filters, from_date: e.target.value ? `${e.target.value}T00:00:00+00:00` : "" })} data-testid="audit-from-date" />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />Til</Label>
            <Input type="date" value={filters.to_date?.slice(0, 10) || ""} onChange={(e) => setFilters({ ...filters, to_date: e.target.value ? `${e.target.value}T23:59:59+00:00` : "" })} data-testid="audit-to-date" />
          </div>
          <div className="flex items-end md:col-span-2">
            <Button type="submit" className="bg-red-900 hover:bg-red-800 w-full md:w-auto" data-testid="audit-apply-filters">
              <Search className="h-4 w-4 mr-1" />Søk
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between text-sm">
          <div><strong>{data.total}</strong> treff{loading && " (laster…)"}</div>
          <div className="flex items-center gap-2 text-xs">
            <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0 || loading}>← Forrige</Button>
            <span className="font-mono">Side {page + 1} / {totalPages}</span>
            <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1 || loading}>Neste →</Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Tidspunkt</TableHead>
              {mode === "all" && <TableHead>Klubb</TableHead>}
              <TableHead>Bruker</TableHead>
              <TableHead>Handling</TableHead>
              <TableHead>Beskrivelse</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.items || []).length === 0 && (
              <TableRow><TableCell colSpan={mode === "all" ? 6 : 5} className="text-center text-slate-500 py-8">Ingen aktivitetsoppføringer matcher filteret.</TableCell></TableRow>
            )}
            {(data.items || []).map((row) => (
              <React.Fragment key={row.id}>
                <TableRow className="hover:bg-slate-50/40" data-testid={`audit-row-${row.id}`}>
                  <TableCell className="font-mono text-xs text-slate-600 whitespace-nowrap">{new Date(row.at).toLocaleString("nb-NO")}</TableCell>
                  {mode === "all" && (
                    <TableCell>
                      {row.customer_number ? (
                        <span className="text-xs"><span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{row.customer_number}</span> <span className="font-semibold ml-1">{row.club_name}</span></span>
                      ) : <span className="text-slate-400 italic text-xs">(ukjent)</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-sm">{row.by_name || row.by || <span className="text-slate-400 italic">(system)</span>}</TableCell>
                  <TableCell>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded uppercase font-bold ${actionBadgeCls(row.action)}`}>{row.action || "–"}</span>
                  </TableCell>
                  <TableCell className="text-sm max-w-md truncate" title={row.description}>{row.description}</TableCell>
                  <TableCell className="text-right">
                    {row.meta && Object.keys(row.meta).length > 0 && (
                      <button type="button" onClick={() => setExpanded(expanded === row.id ? null : row.id)} className="text-slate-400 hover:text-slate-700" data-testid={`audit-expand-${row.id}`}>
                        {expanded === row.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    )}
                  </TableCell>
                </TableRow>
                {expanded === row.id && row.meta && (
                  <TableRow>
                    <TableCell colSpan={mode === "all" ? 6 : 5} className="bg-slate-50 p-0">
                      <div className="p-3 text-xs">
                        <div className="font-semibold text-slate-700 mb-1">Metadata</div>
                        <pre className="bg-white border border-slate-200 rounded p-2 overflow-x-auto">{JSON.stringify(row.meta, null, 2)}</pre>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>

      {mode === "all" && isOwner && (
        <div className="text-xs text-slate-500 italic">
          <Crown className="inline h-3 w-3 text-amber-600 mr-1" />
          Kryss-tenant visning: Dette er alle klubbers aktivitetslogger. Plattformeiers egne handlinger logges aldri (ingen klubbkontekst), men owner-field-override og hard-delete logges inne i den impersonerte klubbens logg.
        </div>
      )}
    </div>
  );
}
