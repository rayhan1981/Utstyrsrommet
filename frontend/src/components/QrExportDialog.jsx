import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, QrCode } from "lucide-react";

const BASE = process.env.REACT_APP_BACKEND_URL;

export default function QrExportDialog({ open, onOpenChange }) {
  const [filters, setFilters] = useState({ items: [], main_groups: [], sub_groups: [], total: 0 });
  const [scope, setScope] = useState("all");
  const [value, setValue] = useState("");
  const [size, setSize] = useState("medium");

  useEffect(() => {
    if (!open) return;
    api.get("/inventory/qr-filters")
      .then((r) => setFilters(r.data))
      .catch((e) => toast.error(formatError(e.response?.data?.detail)));
  }, [open]);

  const download = async () => {
    try {
      const params = new URLSearchParams({ scope, size });
      if (scope !== "all") params.set("value", value);
      const token = localStorage.getItem("utr_token");
      const r = await fetch(`${BASE}/api/inventory/qr-labels?${params.toString()}`, {
        credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: "Nedlasting feilet" }));
        toast.error(err.detail || "Nedlasting feilet");
        return;
      }
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = `qr-etiketter-${size}.pdf`; a.click(); URL.revokeObjectURL(u);
      toast.success("QR-koder lastet ned");
      onOpenChange(false);
    } catch (e) { toast.error(formatError(e.message)); }
  };

  const canDownload = scope === "all" || !!value;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />Eksporter QR-koder</DialogTitle>
          <DialogDescription>Velg omfang og størrelse for PDF-eksport. Varer uten QR-kode utelates.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Omfang</Label>
            <Select value={scope} onValueChange={(v) => { setScope(v); setValue(""); }}>
              <SelectTrigger data-testid="qr-scope-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle varer med QR ({filters.total})</SelectItem>
                <SelectItem value="item">Enkelt vare</SelectItem>
                <SelectItem value="main_group" disabled={filters.main_groups.length === 0}>Hovedgruppe</SelectItem>
                <SelectItem value="sub_group" disabled={filters.sub_groups.length === 0}>Undergruppe</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scope === "item" && (
            <div>
              <Label>Velg vare</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger data-testid="qr-item-select"><SelectValue placeholder="Velg…" /></SelectTrigger>
                <SelectContent>{filters.items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {scope === "main_group" && (
            <div>
              <Label>Velg hovedgruppe</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger data-testid="qr-main-select"><SelectValue placeholder="Velg…" /></SelectTrigger>
                <SelectContent>{filters.main_groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {scope === "sub_group" && (
            <div>
              <Label>Velg undergruppe</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger data-testid="qr-sub-select"><SelectValue placeholder="Velg…" /></SelectTrigger>
                <SelectContent>{filters.sub_groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Størrelse</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {[
                { k: "small", label: "Liten", desc: "2×2 cm" },
                { k: "medium", label: "Medium", desc: "6×6 cm" },
                { k: "large", label: "Stor", desc: "10×10 cm" },
              ].map((s) => (
                <button
                  key={s.k}
                  type="button"
                  onClick={() => setSize(s.k)}
                  className={`py-3 px-2 rounded-md text-xs transition border ${size === s.k ? "bg-red-900 text-white border-red-900" : "bg-white border-slate-200 hover:border-red-700"}`}
                  data-testid={`qr-size-${s.k}`}
                >
                  <div className="font-semibold">{s.label}</div>
                  <div className={size === s.k ? "text-red-100" : "text-slate-500"}>{s.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">Varenavn vises alltid under QR-koden. Klubblogo (hvis lastet opp) legges automatisk i senter.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={download} disabled={!canDownload} className="bg-red-900 hover:bg-red-800" data-testid="qr-download-btn">
            <Download className="h-4 w-4 mr-2" />Last ned PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
