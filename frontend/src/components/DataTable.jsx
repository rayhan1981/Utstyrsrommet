import React, { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Filter, X, Layers, ChevronRight, ChevronDown } from "lucide-react";

/**
 * Columns: [{ key, label, sortable=true, filter: null | 'text' | 'select' | 'number' | 'boolean',
 *            options: [{value,label}], accessor: row => value, render: row => node, className?,
 *            groupable?: boolean, groupLabel?: (val)=>string }]
 */
export default function DataTable({ columns, rows, emptyLabel = "Ingen data.", getRowId = (r) => r.id, actions, searchPlaceholder = "Søk…", initialSort, initialGroupBy, onDropToGroup, groupPathToTarget }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(initialSort || null);
  const [filters, setFilters] = useState({});
  // groupBy er nå en array av kolonne-nøkler for nøstet gruppering (f.eks. ["category","main_group"]).
  const [groupBy, setGroupBy] = useState(initialGroupBy || []);
  const [collapsed, setCollapsed] = useState({});
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const get = (col, row) => (col.accessor ? col.accessor(row) : row[col.key]);

  const activeFilterCount = Object.keys(filters).filter((k) => {
    const f = filters[k]; if (!f) return false;
    if (f.value !== undefined && f.value !== "" && f.value !== "all") return true;
    if (f.min !== undefined && f.min !== "") return true;
    if (f.max !== undefined && f.max !== "") return true;
    return false;
  }).length;

  const groupableCols = columns.filter((c) => c.groupable);

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

  const grouped = useMemo(() => {
    if (!groupBy || groupBy.length === 0) return null;
    const groupCols = groupBy.map((k) => columns.find((c) => c.key === k)).filter(Boolean);
    if (groupCols.length === 0) return null;

    // Bygg nøstet tre: {label, count, children?, rows?}
    const build = (list, depth) => {
      if (depth >= groupCols.length) return list.map((r) => ({ _row: r }));
      const col = groupCols[depth];
      const map = new Map();
      for (const r of list) {
        const raw = get(col, r);
        const label = col.groupLabel ? col.groupLabel(raw, r) : (raw == null || raw === "" ? "(Uten)" : String(raw));
        if (!map.has(label)) map.set(label, []);
        map.get(label).push(r);
      }
      return Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0], "nb"))
        .map(([label, rowsInGroup]) => ({
          _label: label,
          _depth: depth,
          _count: rowsInGroup.length,
          _path: label,
          _children: build(rowsInGroup, depth + 1),
        }));
    };
    return build(filteredSorted, 0);
  }, [groupBy, columns, filteredSorted]);

  const toggleSort = (k) => setSort((s) => s?.key === k ? (s.dir === "asc" ? { key: k, dir: "desc" } : null) : { key: k, dir: "asc" });
  const toggleGroup = (path) => setCollapsed((c) => ({ ...c, [path]: !c[path] }));
  const clearFilters = () => { setFilters({}); setSearch(""); setSort(null); setGroupBy([]); };
  const filterableCols = columns.filter((c) => c.filter);

  const renderRow = (r, depth = 0) => {
    const id = getRowId(r);
    const draggable = !!onDropToGroup;
    return (
      <TableRow key={id} data-testid={`dt-row-${id}`}
                draggable={draggable}
                onDragStart={draggable ? (e) => { setDraggedId(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); } : undefined}
                onDragEnd={draggable ? () => { setDraggedId(null); setDropTarget(null); } : undefined}
                className={draggedId === id ? "opacity-40" : ""}>
      {columns.map((c, idx) => (
        <TableCell key={c.key} className={c.className}
                   style={idx === 0 && depth > 0 ? { paddingLeft: `${8 + depth * 14}px`, paddingTop: "4px", paddingBottom: "4px" } : { paddingTop: "4px", paddingBottom: "4px" }}>
          {c.render ? c.render(r) : get(c, r)}
        </TableCell>
      ))}
      {actions && <TableCell className="text-right py-1 px-1 sm:px-2">{actions(r)}</TableCell>}
    </TableRow>
    );
  };

  // Rekursiv rendering av nøstede mapper
  const renderGroupNode = (node, parentPath = "") => {
    if (node._row) return renderRow(node._row, (parentPath.match(/›/g) || []).length);
    const path = parentPath ? `${parentPath} › ${node._label}` : node._label;
    const isOpen = !collapsed[path];
    const depth = node._depth || 0;
    const isDropTarget = dropTarget === path;
    // Fargekoding per dybde
    const bgClass = depth === 0 ? "bg-red-50 hover:bg-red-100 border-l-4 border-red-700"
                   : depth === 1 ? "bg-amber-50/70 hover:bg-amber-100/70 border-l-4 border-amber-500"
                   : "bg-sky-50/60 hover:bg-sky-100/60 border-l-4 border-sky-400";
    const highlight = isDropTarget ? "ring-2 ring-emerald-500 bg-emerald-50/60" : "";
    const canDrop = !!onDropToGroup;
    const handleDragOver = canDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(path); } : undefined;
    const handleDragLeave = canDrop ? (e) => { if (dropTarget === path) setDropTarget(null); } : undefined;
    const handleDrop = canDrop ? async (e) => {
      e.preventDefault();
      setDropTarget(null);
      const itemId = e.dataTransfer.getData("text/plain") || draggedId;
      if (!itemId) return;
      // Beregn mål fra path og groupBy-kolonner
      const parts = path.split(" › ");
      const target = {};
      groupBy.forEach((k, idx) => { target[k] = parts[idx] === "(Uten)" ? "" : (parts[idx] || ""); });
      if (groupPathToTarget) {
        Object.assign(target, groupPathToTarget(parts, groupBy) || {});
      }
      await onDropToGroup(itemId, target, path);
      setDraggedId(null);
    } : undefined;
    return (
      <React.Fragment key={path}>
        <TableRow className={`${bgClass} ${highlight} cursor-pointer`} onClick={() => toggleGroup(path)}
                  onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  data-testid={`dt-group-${path.replace(/[^A-Za-z0-9]+/g, "_")}`}>
          <TableCell colSpan={columns.length + (actions ? 1 : 0)}
                     className="font-semibold text-sm py-1.5"
                     style={{ paddingLeft: `${8 + depth * 14}px` }}>
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className={depth === 0 ? "text-red-900 uppercase tracking-wide text-xs" : depth === 1 ? "text-amber-800 text-sm" : "text-sky-800 text-xs"}>
                {node._label}
              </span>
              <span className="text-xs text-slate-500 font-normal">({node._count})</span>
              {isDropTarget && <span className="text-xs text-emerald-700 font-semibold ml-2">↓ Slipp her for å flytte</span>}
            </span>
          </TableCell>
        </TableRow>
        {isOpen && node._children && node._children.map((child) => renderGroupNode(child, path))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="dt-search" />
        </div>
        {groupableCols.length > 0 && (
          <div className="flex gap-1 flex-wrap items-center" data-testid="dt-group-controls">
            <Layers className="h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-600 font-semibold">Grupper:</span>
            {groupableCols.map((c) => {
              const active = groupBy.includes(c.key);
              const level = active ? groupBy.indexOf(c.key) + 1 : null;
              return (
                <button key={c.key} type="button"
                        onClick={() => setGroupBy(active ? groupBy.filter((k) => k !== c.key) : [...groupBy, c.key])}
                        data-testid={`dt-group-toggle-${c.key}`}
                        className={`text-xs px-2 py-1 rounded border transition ${active ? "bg-red-700 text-white border-red-700" : "bg-white border-slate-300 text-slate-600 hover:bg-red-50"}`}>
                  {active && <span className="mr-1 font-bold">#{level}</span>}{c.label}
                </button>
              );
            })}
            {groupBy.length > 0 && (
              <button type="button" onClick={() => setGroupBy([])} className="text-xs px-2 py-1 text-slate-500 hover:text-red-700" data-testid="dt-group-clear">
                <X className="h-3 w-3 inline mr-0.5" />Flatt
              </button>
            )}
          </div>
        )}
        {filterableCols.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" data-testid="dt-filter-btn">
                <Filter className="h-4 w-4 mr-2" />Filter {activeFilterCount > 0 && <span className="ml-1.5 bg-red-900 text-white rounded-full px-1.5 text-xs">{activeFilterCount}</span>}
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
                      <Input value={filters[c.key]?.value || ""} onChange={(e) => setFilters({ ...filters, [c.key]: { value: e.target.value } })} placeholder="Filtrer…" />
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
        {(search || sort || activeFilterCount > 0 || (groupBy && groupBy.length)) && (
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
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-red-800" data-testid={`dt-sort-${c.key}`}>
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
            {!grouped && filteredSorted.map((r) => renderRow(r, 0))}
            {grouped && grouped.map((n) => renderGroupNode(n))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
