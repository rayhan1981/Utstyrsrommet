import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { Plus, X } from "lucide-react";

const NEW_SENTINEL = "__new__";

/**
 * Kaskaderende dropdowns for Kategori → Hovedgruppe → Undergruppe.
 * «+ Opprett ny …»-alternativet ligger ØVERST i hver Select-dropdown (ikke som sibling-knapp)
 * for å unngå at klikk på knappen utløser onInteractOutside → lukker Dialog.
 * Når brukeren velger den switcher komponenten til tekstfelt m/ X-knapp for å gå tilbake.
 */
export default function TaxonomyPicker({ value, onChange }) {
  const [tree, setTree] = useState({ categories: [] });
  const [customCat, setCustomCat] = useState(false);
  const [customMg, setCustomMg] = useState(false);
  const [customSg, setCustomSg] = useState(false);

  useEffect(() => {
    api.get("/items/taxonomy").then((r) => setTree(r.data)).catch(() => {});
  }, []);

  const catObj = (tree.categories || []).find((c) => c.name === value.category);
  const mgObj = (catObj?.main_groups || []).find((m) => m.name === value.main_group);

  const setCat = (v) => onChange({ category: v, main_group: "", sub_group: "" });
  const setMg = (v) => onChange({ ...value, main_group: v, sub_group: "" });
  const setSg = (v) => onChange({ ...value, sub_group: v });

  // Håndter valg av "+ Opprett ny"
  const onPickCat = (v) => {
    if (v === NEW_SENTINEL) { setCustomCat(true); setCat(""); return; }
    setCustomCat(false); setCat(v);
  };
  const onPickMg = (v) => {
    if (v === NEW_SENTINEL) { setCustomMg(true); setMg(""); return; }
    setCustomMg(false); setMg(v);
  };
  const onPickSg = (v) => {
    if (v === NEW_SENTINEL) { setCustomSg(true); setSg(""); return; }
    setCustomSg(false); setSg(v);
  };

  const stop = (e) => { e.stopPropagation(); };

  return (
    <>
      {/* Kategori */}
      <div onPointerDown={stop}>
        <Label>Kategori *</Label>
        {customCat ? (
          <div className="flex gap-1">
            <Input autoFocus value={value.category || ""}
                   onChange={(e) => setCat(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                   placeholder="Skriv navn på ny kategori" data-testid="cat-custom-input" />
            <Button type="button" variant="ghost" size="icon"
                    onClick={(e) => { e.preventDefault(); setCustomCat(false); setCat(""); }}
                    title="Avbryt og velg eksisterende">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Select value={value.category || ""} onValueChange={onPickCat}>
            <SelectTrigger data-testid="cat-select"><SelectValue placeholder="Velg kategori" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_SENTINEL} className="text-emerald-700 font-semibold">
                <span className="inline-flex items-center"><Plus className="h-3.5 w-3.5 mr-1" />Opprett ny kategori…</span>
              </SelectItem>
              <SelectSeparator />
              {(tree.categories || []).length === 0 && <SelectItem disabled value="__none__">Ingen kategorier ennå</SelectItem>}
              {(tree.categories || []).map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Hovedgruppe */}
      <div onPointerDown={stop}>
        <Label>Hovedgruppe</Label>
        {customMg ? (
          <div className="flex gap-1">
            <Input autoFocus value={value.main_group || ""}
                   onChange={(e) => setMg(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                   placeholder="Skriv navn på ny hovedgruppe" data-testid="mg-custom-input" />
            <Button type="button" variant="ghost" size="icon"
                    onClick={(e) => { e.preventDefault(); setCustomMg(false); setMg(""); }}
                    title="Avbryt og velg eksisterende">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Select value={value.main_group || ""} onValueChange={onPickMg} disabled={!value.category}>
            <SelectTrigger data-testid="mg-select">
              <SelectValue placeholder={value.category ? "Velg hovedgruppe" : "Velg kategori først"} />
            </SelectTrigger>
            <SelectContent>
              {value.category && (
                <>
                  <SelectItem value={NEW_SENTINEL} className="text-emerald-700 font-semibold">
                    <span className="inline-flex items-center"><Plus className="h-3.5 w-3.5 mr-1" />Opprett ny hovedgruppe…</span>
                  </SelectItem>
                  <SelectSeparator />
                </>
              )}
              {(catObj?.main_groups || []).length === 0 && (
                <SelectItem disabled value="__none__">Ingen hovedgrupper under {value.category || "–"}</SelectItem>
              )}
              {(catObj?.main_groups || []).map((m) => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Undergruppe */}
      <div onPointerDown={stop}>
        <Label>Undergruppe</Label>
        {customSg ? (
          <div className="flex gap-1">
            <Input autoFocus value={value.sub_group || ""}
                   onChange={(e) => setSg(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                   placeholder="Skriv navn på ny undergruppe" data-testid="sg-custom-input" />
            <Button type="button" variant="ghost" size="icon"
                    onClick={(e) => { e.preventDefault(); setCustomSg(false); setSg(""); }}
                    title="Avbryt og velg eksisterende">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Select value={value.sub_group || ""} onValueChange={onPickSg} disabled={!value.main_group}>
            <SelectTrigger data-testid="sg-select">
              <SelectValue placeholder={value.main_group ? "Velg undergruppe" : "Velg hovedgruppe først"} />
            </SelectTrigger>
            <SelectContent>
              {value.main_group && (
                <>
                  <SelectItem value={NEW_SENTINEL} className="text-emerald-700 font-semibold">
                    <span className="inline-flex items-center"><Plus className="h-3.5 w-3.5 mr-1" />Opprett ny undergruppe…</span>
                  </SelectItem>
                  <SelectSeparator />
                </>
              )}
              {(mgObj?.sub_groups || []).length === 0 && (
                <SelectItem disabled value="__none__">Ingen undergrupper under {value.main_group || "–"}</SelectItem>
              )}
              {(mgObj?.sub_groups || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
    </>
  );
}
