import React, { useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Save, X, Crown } from "lucide-react";
import { toast } from "sonner";

/**
 * Plattformeier-overstyring av et enkelt felt på et dokument i den impersonerte kundens tenant.
 * - Kun synlig når user.role === "platform_owner" OG impersonating=true
 * - Blyant-ikon ved siden av feltet, klikk → inline input → lagre via POST /owner/field-override
 * - Verdi vises som read-only når ikke redigering er aktiv
 */
export default function OwnerFieldOverride({
  collection,
  documentId,
  field,
  value,
  label,
  type = "text",      // text | number | datetime | boolean | password
  onSaved,
  display,           // optional custom render for display mode
}) {
  const { user, impersonating } = useAuth();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  const [busy, setBusy] = useState(false);

  if (user?.role !== "platform_owner" || !impersonating) return null;

  const start = () => {
    setVal(value ?? "");
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const save = async () => {
    setBusy(true);
    try {
      let v = val;
      if (type === "number") v = v === "" ? null : Number(v);
      if (type === "boolean") v = Boolean(v);
      const { data } = await api.post("/owner/field-override", { collection, document_id: documentId, field, value: v });
      toast.success(`Felt '${field}' overstyrt`);
      setEditing(false);
      if (onSaved) onSaved(data.document);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const displayVal = display ? display(value) : (value === null || value === undefined || value === "" ? <span className="text-slate-400 italic">–</span> : String(value));

  return (
    <div className="group flex items-start gap-2" data-testid={`override-${collection}-${field}`}>
      <div className="min-w-0 flex-1">
        {label && <div className="text-xs font-semibold uppercase text-slate-500 flex items-center gap-1">
          {label}
          <Crown className="h-3 w-3 text-amber-600" title="Plattformeier-felt" />
        </div>}
        {editing ? (
          <div className="flex items-center gap-1 mt-1">
            {type === "boolean" ? (
              <select
                value={val ? "true" : "false"}
                onChange={(e) => setVal(e.target.value === "true")}
                className="h-9 border border-slate-300 rounded px-2 text-sm"
                data-testid={`override-input-${field}`}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <Input
                type={type === "datetime" ? "text" : type === "number" ? "number" : "text"}
                value={val ?? ""}
                onChange={(e) => setVal(e.target.value)}
                placeholder={type === "datetime" ? "YYYY-MM-DDTHH:MM:SS+00:00 eller tom for null" : ""}
                className="h-9 text-sm"
                autoFocus
                data-testid={`override-input-${field}`}
              />
            )}
            <Button size="sm" onClick={save} disabled={busy} className="bg-amber-700 hover:bg-amber-800 h-9" data-testid={`override-save-${field}`}>
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={cancel} className="h-9" data-testid={`override-cancel-${field}`}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="font-mono text-sm text-slate-800 mt-0.5 break-all">{displayVal}</div>
        )}
      </div>
      {!editing && (
        <button
          type="button"
          onClick={start}
          title="Overstyr dette feltet (kun plattformeier)"
          className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-amber-700 hover:bg-amber-100 border border-amber-200 bg-amber-50 opacity-70 hover:opacity-100 transition"
          data-testid={`override-pencil-${field}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
