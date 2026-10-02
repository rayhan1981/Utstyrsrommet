import React, { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Filter, X } from "lucide-react";

/**
 * Columns: [{ key, label, sortable=true, filter: null | 'text' | 'select' | 'number' | 'boolean',
 *            options: [{value,label}], accessor: row => value, render: row => node, className? }]
 */
export default function DataTable({ columns, rows, emptyLabel = "Ingen data.", getRowId = (r) => r.id, actions, searchPlaceholder = "Søk…", initialSort }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(initialSort || null); // { key, dir: 'asc'|'desc' }
  const [filters, setFilters] = useState({}); // { key: {op?, value|min|max} }

  const get = (col, row) => (col.accessor ? col.accessor(row) : row[col.key]);

  const activeFilterCount = Object.keys(filters).filter((k) => {
    const f = filters[k]; if (!f) return false;
    if (f.value !== undefined && f.value !== "" && f.value !== "all") return true;
    if (f.min !== undefined && f.min !== "") return true;
    if (f.max !== undefined && f.max !== "") return true;
    return false;
  }).length;

  const filteredSorted = useMemo(() => {
    let out = [...rows];
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) => columns.some((c) => {
        const v = get(c, r);
        return v != null && String(v).toLowerCase().includes(q);
      }));
    }
    for (const col of columns) {
      const f = filters[col.key]; if (!f) continue;
      const t = col.filter;
      if (t === "text" && f.value) {
        const q = String(f.value).toLowerCase();
        out = out.filter((r) => String(get(col, r) ?? "").toLowerCase().includes(q));
      } else if (t === "select" && f.value && f.value !== "all") {
        out = out.filter((r) => String(get(col, r) ?? "") === String(f.value));
      } else if (t === "boolean" && f.value && f.value !== "all") {
        const want = f.value === "true";
        out = out.filter((r) => Boolean(get(col, r)) === want);
      } else if (t === "number") {
        const min = f.min !== "" && f.min != null ? Number(f.min) : null;
        const max = f.max !== "" && f.max != null ? Number(f.max) : null;
        out = out.filter((r) => {
          const v = Number(get(col, r) ?? 0);
          if (min != null && v < min) return false;
          if (max != null && v > max) return false;
          return true;
        });
      }
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out.sort((a, b) => {
          const va = get(col, a), vb = get(col, b);
          if (va == null) return 1;
          if (vb == null) return -1;
          if (typeof va === "number" && typeof vb === "number") return sort.dir === "asc" ? va - vb : vb - va;
          return sort.dir === "asc" ? String(va).localeCompare(String(vb), "nb") : String(vb).localeCompare(String(va), "nb");
        });
      }
    }
    return out;
  }, [rows, search, sort, filters, columns]);

  const toggleSort = (k) => setSort((s) => s?.key === k ? (s.dir === "asc" ? { key: k, dir: "desc" } : null) : { key: k, dir: "asc" });

  const clearFilters = () => { setFilters({}); setSearch(""); setSort(null); };

  const filterableCols = columns.filter((c) => c.filter);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="dt-search" />
        </div>
        {filterableCols.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" data-testid="dt-filter-btn">
                <Filter className="h-4 w-4 mr-2" />Filter {activeFilterCount > 0 && <span className="ml-1.5 bg-emerald-900 text-white rounded-full px-1.5 text-xs">{activeFilterCount}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-h-[70vh] overflow-y-auto">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm">Filtre</div>
                  <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-3 w-3 mr-1" />Nullstill</Button>
                </div>
                {filterableCols.map((c) => (
                  <div key={c.key}>
                    <div className="text-xs font-semibold text-slate-600 mb-1">{c.label}</div>
                    {c.filter === "text" && (
                      <Input value={filters[c.key]?.value || ""} onChange={(e) => setFilters({ ...filters, [c.key]: { value: e.target.value } })} placeholder={`Filtrer…`} />
                    )}
                    {c.filter === "select" && (
                      <Select value={filters[c.key]?.value || "all"} onValueChange={(v) => setFilters({ ...filters, [c.key]: { value: v } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Alle</SelectItem>
                          {(c.options || []).map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {c.filter === "boolean" && (
                      <Select value={filters[c.key]?.value || "all"} onValueChange={(v) => setFilters({ ...filters, [c.key]: { value: v } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Alle</SelectItem>
                          <SelectItem value="true">Ja</SelectItem>
                          <SelectItem value="false">Nei</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {c.filter === "number" && (
                      <div className="flex gap-2">
                        <Input type="number" placeholder="Min" value={filters[c.key]?.min || ""} onChange={(e) => setFilters({ ...filters, [c.key]: { ...filters[c.key], min: e.target.value } })} />
                        <Input type="number" placeholder="Maks" value={filters[c.key]?.max || ""} onChange={(e) => setFilters({ ...filters, [c.key]: { ...filters[c.key], max: e.target.value } })} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {(search || sort || activeFilterCount > 0) && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="dt-clear"><X className="h-3 w-3 mr-1" />Nullstill</Button>
        )}
        <span className="text-xs text-slate-500 ml-auto">{filteredSorted.length} av {rows.length} rader</span>
      </div>

      <div className="border border-slate-200 rounded-md overflow-x-auto bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.className}>
                  {c.sortable !== false ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-emerald-800" data-testid={`dt-sort-${c.key}`}>
                      {c.label}
                      {sort?.key === c.key ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-50" />}
                    </button>
                  ) : c.label}
                </TableHead>
              ))}
              {actions && <TableHead className="text-right">Handlinger</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSorted.length === 0 && (
              <TableRow><TableCell colSpan={columns.length + (actions ? 1 : 0)} className="text-center text-slate-500 py-8">{emptyLabel}</TableCell></TableRow>
            )}
            {filteredSorted.map((r) => (
              <TableRow key={getRowId(r)} data-testid={`dt-row-${getRowId(r)}`}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>{c.render ? c.render(r) : get(c, r)}</TableCell>
                ))}
                {actions && <TableCell className="text-right space-x-1">{actions(r)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
