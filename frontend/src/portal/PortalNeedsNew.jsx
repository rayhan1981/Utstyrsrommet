import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { portalApi, formatPortalError } from "./portalApi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2, Send, Search, CheckCircle2 } from "lucide-react";

export default function PortalNeedsNew() {
  const { me } = useOutletContext();
  const nav = useNavigate();

  // 3-dagers minimumsdato (Europe/Oslo tilnærmes lokalt – backend håndhever)
  const minDate = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  }, []);

  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [wantedDate, setWantedDate] = useState(minDate);
  const [lines, setLines] = useState([]);  // [{item, size, jersey_number, quantity_requested, note}]
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    portalApi.get("/items").then((r) => setItems(r.data)).catch((e) => toast.error(formatPortalError(e.response?.data?.detail)));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((it) => {
      const hay = [
        it.name, it.main_item_number, it.category, it.main_group, it.sub_group,
        ...(it.sizes || []).map((s) => `${s.size} ${s.jersey_number || ""} ${s.full_number || ""}`)
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).slice(0, 50);
  }, [search, items]);

  const addLine = (item, variant = null) => {
    setLines((xs) => [...xs, {
      item,
      size: variant?.size || "",
      jersey_number: variant?.jersey_number || "",
      quantity_requested: 1,
      note: "",
    }]);
  };

  const updateLine = (i, patch) => setLines((xs) => xs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i) => setLines((xs) => xs.filter((_, idx) => idx !== i));

  const canSubmit = () => {
    if (!contact.name.trim() || !contact.phone.trim() || !contact.email.trim()) return false;
    if (!wantedDate || wantedDate < minDate) return false;
    if (lines.length === 0) return false;
    return lines.every((l) => Number.isInteger(l.quantity_requested) && l.quantity_requested > 0);
  };

  const submit = async () => {
    if (!canSubmit()) { toast.error("Fyll ut alle felt og legg til minst én varelinje."); return; }
    setBusy(true);
    try {
      const payload = {
        contact_name: contact.name.trim(),
        contact_phone: contact.phone.trim(),
        contact_email: contact.email.trim(),
        wanted_date: wantedDate,
        comment: comment.trim(),
        lines: lines.map((l) => ({
          item_id: l.item.id,
          size: l.size,
          jersey_number: l.jersey_number,
          quantity_requested: l.quantity_requested,
          note: l.note,
        })),
      };
      const { data } = await portalApi.post("/needs", payload);
      toast.success(`Behovsmelding ${data.number} er sendt`);
      nav(`/behov/${data.id}`);
    } catch (e) {
      toast.error(formatPortalError(e.response?.data?.detail));
    } finally { setBusy(false); setConfirming(false); }
  };

  return (
    <div className="space-y-5" data-testid="portal-new-need">
      <div>
        <h1 className="text-2xl font-bold">Meld utstyrsbehov</h1>
        <p className="text-sm text-slate-500">Lag: <strong>{me.team.name}</strong> · Klubb: <strong>{me.club.name}</strong></p>
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-sm">Kontaktperson</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Navn *</Label>
            <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} required data-testid="portal-need-contact-name" />
          </div>
          <div>
            <Label>Telefonnummer *</Label>
            <Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} required data-testid="portal-need-contact-phone" />
          </div>
          <div>
            <Label>E-postadresse *</Label>
            <Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} required data-testid="portal-need-contact-email" />
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-sm">Ønsket dato</h2>
        <div>
          <Label>Når trenger laget utstyret? *</Label>
          <Input type="date" min={minDate} value={wantedDate} onChange={(e) => setWantedDate(e.target.value)} data-testid="portal-need-wanted-date" />
          <p className="text-[11px] text-slate-500 mt-1">Tidligste mulige dato er {minDate} (minst 3 kalenderdager etter innsending).</p>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-bold text-sm">Varer og antall</h2>
          <span className="text-xs text-slate-500">{lines.length} valgte linje{lines.length === 1 ? "" : "r"}</span>
        </div>

        <div>
          <Label>Søk etter vare</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Navn, kategori, varenummer..." className="pl-8" data-testid="portal-need-search" />
          </div>
          {search && (
            <div className="mt-2 max-h-64 overflow-y-auto border border-slate-200 rounded">
              {filtered.length === 0 ? (
                <div className="text-sm text-slate-500 p-3">Ingen treff.</div>
              ) : filtered.map((it) => (
                <div key={it.id} className="border-b last:border-0 border-slate-100 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{it.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {[it.category, it.main_group, it.sub_group].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {(it.sizes || []).length === 0 && (
                      <Button type="button" size="sm" variant="outline" onClick={() => addLine(it)} data-testid={`portal-add-item-${it.id}`}>
                        <Plus className="h-3 w-3 mr-1" />Legg til
                      </Button>
                    )}
                  </div>
                  {(it.sizes || []).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {it.sizes.map((s, i) => (
                        <button type="button" key={i}
                                onClick={() => addLine(it, s)}
                                className="text-[11px] bg-slate-100 hover:bg-red-100 border border-slate-200 rounded px-1.5 py-0.5"
                                data-testid={`portal-add-variant-${it.id}-${s.size}`}>
                          {s.size}{s.jersey_number && s.jersey_number !== "X" ? ` #${s.jersey_number}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-100">
            {lines.map((l, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded p-2 flex-wrap" data-testid={`portal-line-${idx}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{l.item.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {l.size ? `Størrelse ${l.size}${l.jersey_number && l.jersey_number !== "X" ? ` · #${l.jersey_number}` : ""}` : "Uten størrelse"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-[11px]">Antall</Label>
                  <Input type="number" min="1" step="1" value={l.quantity_requested}
                         onChange={(e) => updateLine(idx, { quantity_requested: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                         className="w-20 h-8" data-testid={`portal-qty-${idx}`} />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(idx)} data-testid={`portal-remove-${idx}`}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <Label>Kommentar (valgfri)</Label>
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Noe klubben bør vite?" data-testid="portal-need-comment" />
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => nav("/")}>Avbryt</Button>
        <Button onClick={() => setConfirming(true)} disabled={!canSubmit()} className="bg-red-900 hover:bg-red-800" data-testid="portal-need-submit">
          <Send className="h-4 w-4 mr-2" />Gå videre til bekreftelse
        </Button>
      </div>

      {confirming && (
        <Card className="p-5 border-red-300 bg-red-50/40" data-testid="portal-need-confirm-panel">
          <h2 className="font-bold text-red-900 flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />Bekreft innsending</h2>
          <ul className="mt-3 text-sm space-y-1">
            <li><strong>Kontakt:</strong> {contact.name} · {contact.phone} · {contact.email}</li>
            <li><strong>Ønsket dato:</strong> {wantedDate}</li>
            <li><strong>Varelinjer:</strong> {lines.length}</li>
            {lines.map((l, i) => (
              <li key={i} className="pl-4 text-xs text-slate-600">• {l.quantity_requested}× {l.item.name}{l.size ? ` (${l.size})` : ""}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)}>Avbryt</Button>
            <Button onClick={submit} disabled={busy} className="bg-red-900 hover:bg-red-800" data-testid="portal-need-confirm">
              {busy ? "Sender…" : "Send inn behovsmelding"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
