import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";

/**
 * Kaskaderende dropdowns for Kategori → Hovedgruppe → Undergruppe.
 * Bygger seg selv fra GET /items/taxonomy. Brukeren kan velge eksisterende
 * verdi ELLER legge til en ny inline via "+ Ny …"-knapp som bytter til tekstfelt.
 */
export default function TaxonomyPicker({ value, onChange }) {
  // value = { category, main_group, sub_group }
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

  return (
    <>
      {/* Kategori */}
      <div>
        <Label>Kategori *</Label>
        {customCat ? (
          <div className="flex gap-1">
            <Input autoFocus value={value.category || ""} onChange={(e) => setCat(e.target.value)} placeholder="Ny kategori" data-testid="cat-custom-input" />
            <Button type="button" variant="ghost" size="icon" onClick={() => setCustomCat(false)}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Select value={value.category || ""} onValueChange={setCat}>
              <SelectTrigger data-testid="cat-select"><SelectValue placeholder="Velg kategori" /></SelectTrigger>
              <SelectContent>
                {(tree.categories || []).length === 0 && <SelectItem disabled value="__none__">Ingen kategorier ennå</SelectItem>}
                {(tree.categories || []).map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="icon" onClick={() => { setCustomCat(true); setCat(""); }} title="Legg til ny kategori" data-testid="cat-add-btn">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      {/* Hovedgruppe */}
      <div>
        <Label>Hovedgruppe</Label>
        {customMg || (!catObj && value.category) ? (
          <div className="flex gap-1">
            <Input autoFocus={customMg} value={value.main_group || ""} onChange={(e) => setMg(e.target.value)} placeholder="Ny hovedgruppe" data-testid="mg-custom-input" />
            <Button type="button" variant="ghost" size="icon" onClick={() => setCustomMg(false)}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Select value={value.main_group || ""} onValueChange={setMg} disabled={!value.category}>
              <SelectTrigger data-testid="mg-select"><SelectValue placeholder={value.category ? "Velg hovedgruppe" : "Velg kategori først"} /></SelectTrigger>
              <SelectContent>
                {(catObj?.main_groups || []).length === 0 && <SelectItem disabled value="__none__">Ingen hovedgrupper under {value.category || "–"}</SelectItem>}
                {(catObj?.main_groups || []).map((m) => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="icon" onClick={() => { setCustomMg(true); setMg(""); }} disabled={!value.category} title="Legg til ny hovedgruppe" data-testid="mg-add-btn">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      {/* Undergruppe */}
      <div>
        <Label>Undergruppe</Label>
        {customSg || (!mgObj && value.main_group) ? (
          <div className="flex gap-1">
            <Input autoFocus={customSg} value={value.sub_group || ""} onChange={(e) => setSg(e.target.value)} placeholder="Ny undergruppe" data-testid="sg-custom-input" />
            <Button type="button" variant="ghost" size="icon" onClick={() => setCustomSg(false)}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Select value={value.sub_group || ""} onValueChange={setSg} disabled={!value.main_group}>
              <SelectTrigger data-testid="sg-select"><SelectValue placeholder={value.main_group ? "Velg undergruppe" : "Velg hovedgruppe først"} /></SelectTrigger>
              <SelectContent>
                {(mgObj?.sub_groups || []).length === 0 && <SelectItem disabled value="__none__">Ingen undergrupper under {value.main_group || "–"}</SelectItem>}
                {(mgObj?.sub_groups || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="icon" onClick={() => { setCustomSg(true); setSg(""); }} disabled={!value.main_group} title="Legg til ny undergruppe" data-testid="sg-add-btn">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
