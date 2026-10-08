import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { FolderTree, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

/**
 * Admin-kort for å omdøpe eller slette kategorier/hovedgrupper/undergrupper.
 * Vises på Innstillinger-siden. Henter hierarkiet fra GET /items/taxonomy.
 */
export default function TaxonomyAdminCard() {
  const [tree, setTree] = useState({ categories: [] });
  const [expanded, setExpanded] = useState({});
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameForm, setRenameForm] = useState({ level: "", old_name: "", new_name: "", parent_category: "", parent_main_group: "" });

  const load = async () => {
    const { data } = await api.get("/items/taxonomy");
    setTree(data);
  };
  useEffect(() => { load(); }, []);

  const toggle = (k) => setExpanded((e) => ({ ...e, [k]: !e[k] }));

  const openRename = (level, old_name, parent_category = "", parent_main_group = "") => {
    setRenameForm({ level, old_name, new_name: old_name, parent_category, parent_main_group });
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const newName = renameForm.new_name.trim();
    if (!newName) { toast.error("Nytt navn er påkrevd"); return; }
    if (newName === renameForm.old_name) { toast.info("Ingen endring"); setRenameOpen(false); return; }
    try {
      const { data } = await api.post("/items/taxonomy/rename", {
        level: renameForm.level,
        old_name: renameForm.old_name,
        new_name: newName,
        parent_category: renameForm.parent_category || null,
        parent_main_group: renameForm.parent_main_group || null,
      });
      toast.success(`Omdøpt – ${data.updated} varer oppdatert`);
      setRenameOpen(false);
      await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const delNode = async (level, old_name, parent_category = "", parent_main_group = "") => {
    const label = `${level === "category" ? "kategorien" : level === "main_group" ? "hovedgruppen" : "undergruppen"} «${old_name}»`;
    if (!window.confirm(`Slette ${label}?\n\nAlle varer under denne noden beholdes, men mister sin ${level === "category" ? "kategori" : level === "main_group" ? "hovedgruppe" : "undergruppe"}.`)) return;
    try {
      const { data } = await api.post("/items/taxonomy/delete", {
        level, old_name, new_name: "",
        parent_category: parent_category || null,
        parent_main_group: parent_main_group || null,
      });
      toast.success(`${data.updated} varer flyttet ut av ${label}`);
      await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  return (
    <Card className="p-5" data-testid="taxonomy-admin-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-red-700" />Kategorier, hovedgrupper og undergrupper
          </h3>
          <p className="text-xs text-slate-500 mt-1">Omdøp eller slett grupper. Alle berørte varer oppdateres automatisk.</p>
        </div>
      </div>

      {(tree.categories || []).length === 0 && (
        <p className="text-sm text-slate-500 py-4">Ingen kategorier opprettet ennå. Opprett en kategori via «Nytt utstyr» først.</p>
      )}

      <div className="space-y-1">
        {(tree.categories || []).map((c) => {
          const catKey = `cat:${c.name}`;
          const openCat = !!expanded[catKey];
          return (
            <div key={catKey} className="border border-slate-200 rounded-md overflow-hidden">
              <div className="bg-red-50 px-3 py-2 flex items-center gap-2 border-b border-red-100">
                <button onClick={() => toggle(catKey)} className="hover:bg-red-100 rounded p-0.5" data-testid={`tax-expand-${c.name}`}>
                  {openCat ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <span className="font-semibold text-red-900 flex-1">{c.name}</span>
                <span className="text-xs text-red-700">{(c.main_groups || []).length} hovedgrupper</span>
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openRename("category", c.name)} data-testid={`tax-rename-cat-${c.name}`}>
                  <Pencil className="h-3 w-3 mr-1" />Omdøp
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600" onClick={() => delNode("category", c.name)} data-testid={`tax-del-cat-${c.name}`}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {openCat && (
                <div className="divide-y divide-slate-100">
                  {(c.main_groups || []).length === 0 && <div className="text-xs text-slate-500 px-6 py-2">Ingen hovedgrupper.</div>}
                  {(c.main_groups || []).map((mg) => {
                    const mgKey = `mg:${c.name}:${mg.name}`;
                    const openMg = !!expanded[mgKey];
                    return (
                      <div key={mgKey}>
                        <div className="bg-amber-50/60 px-6 py-1.5 flex items-center gap-2">
                          <button onClick={() => toggle(mgKey)} className="hover:bg-amber-100 rounded p-0.5">
                            {openMg ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                          <span className="font-medium text-amber-900 flex-1 text-sm">{mg.name}</span>
                          <span className="text-xs text-amber-700">{(mg.sub_groups || []).length} undergrupper</span>
                          <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => openRename("main_group", mg.name, c.name)} data-testid={`tax-rename-mg-${mg.name}`}>
                            <Pencil className="h-3 w-3 mr-1" /><span className="text-xs">Omdøp</span>
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-red-600" onClick={() => delNode("main_group", mg.name, c.name)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        {openMg && (mg.sub_groups || []).map((sg) => (
                          <div key={sg} className="bg-sky-50/50 pl-12 pr-6 py-1 flex items-center gap-2 text-sm border-t border-slate-100">
                            <span className="flex-1 text-sky-900">{sg}</span>
                            <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => openRename("sub_group", sg, c.name, mg.name)} data-testid={`tax-rename-sg-${sg}`}>
                              <Pencil className="h-3 w-3 mr-1" /><span className="text-xs">Omdøp</span>
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-red-600" onClick={() => delNode("sub_group", sg, c.name, mg.name)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Omdøp {renameForm.level === "category" ? "kategori" : renameForm.level === "main_group" ? "hovedgruppe" : "undergruppe"}</DialogTitle>
            <DialogDescription>Alle varer med dette navnet blir oppdatert umiddelbart.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Gammelt navn</Label><Input value={renameForm.old_name} disabled /></div>
            <div>
              <Label>Nytt navn</Label>
              <Input autoFocus value={renameForm.new_name}
                     onChange={(e) => setRenameForm({ ...renameForm, new_name: e.target.value })}
                     data-testid="tax-rename-input" />
            </div>
            {renameForm.parent_category && (
              <div className="text-xs text-slate-500">
                Sti: {renameForm.parent_category}
                {renameForm.parent_main_group ? ` > ${renameForm.parent_main_group}` : ""}
                {" > "}<span className="font-semibold">{renameForm.old_name}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Avbryt</Button>
            <Button onClick={submitRename} className="bg-red-900 hover:bg-red-800" data-testid="tax-rename-save">Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
