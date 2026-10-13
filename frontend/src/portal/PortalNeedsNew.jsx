import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { portalApi, formatPortalError } from "./portalApi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2, Send, Search, CheckCircle2, X } from "lucide-react";

const EMPTY_DRAFT = { item: null, size: "", jersey_number: "", quantity_requested: 1, note: "" };

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
  const [confirmedLines, setConfirmedLines] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Ref til søkefeltet så vi kan scrolle til og fokusere på det hver gang en ny tom linje dukker opp
  const searchRef = useRef(null);
  const draftRowRef = useRef(null);

  useEffect(() => {
    portalApi.get("/items").then((r) => setItems(r.data)).catch((e) => toast.error(formatPortalError(e.response?.data?.detail)));
  }, []);

  // Når ny tom linje dukker opp (dvs. etter at en vare er bekreftet) scroll og fokuser søkefeltet.
  useEffect(() => {
    if (!draft.item && searchRef.current) {
      searchRef.current.focus();
      // Scroll jevnt så den nye tomme linja + søkefeltet er synlig
      setTimeout(() => {
        draftRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  }, [confirmedLines.length, draft.item]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((it) => {
      const hay = [
        it.name, it.main_item_number, it.category, it.main_group, it.sub_group,
        ...(it.sizes || []).map((s) => `${s.size} ${s.jersey_number || ""} ${s.full_number || ""}`),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).slice(0, 50);
  }, [search, items]);

  const pickItem = (item, variant = null) => {
    setDraft({
      item,
      size: variant?.size || "",
      jersey_number: variant?.jersey_number || "",
      quantity_requested: 1,
      note: "",
    });
    setSearch("");
  };

  const clearDraft = () => {
    setDraft(EMPTY_DRAFT);
    setSearch("");
  };

  const confirmDraft = () => {
    if (!draft.item) { toast.error("Velg en vare først"); return; }
    if (!Number.isInteger(draft.quantity_requested) || draft.quantity_requested < 1) {
      toast.error("Antall må være minst 1"); return;
    }
    setConfirmedLines((xs) => [...xs, { ...draft }]);
    setDraft(EMPTY_DRAFT);  // → effekten over trigger autofokus på nytt søkefelt
    setSearch("");
  };

  const removeConfirmed = (i) => {
    setConfirmedLines((xs) => xs.filter((_, idx) => idx !== i));
  };

  const canSubmit = () => {
    if (!contact.name.trim() || !contact.phone.trim() || !contact.email.trim()) return false;
    if (!wantedDate || wantedDate < minDate) return false;
    if (confirmedLines.length === 0) return false;
    return true;
  };

  const submit = async () => {
    if (!canSubmit()) { toast.error("Fyll ut alle felt og bekreft minst én varelinje."); return; }
    setBusy(true);
    try {
      const payload = {
        contact_name: contact.name.trim(),
        contact_phone: contact.phone.trim(),
        contact_email: contact.email.trim(),
        wanted_date: wantedDate,
        comment: comment.trim(),
        lines: confirmedLines.map((l) => ({
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
          <span className="text-xs text-slate-500">{confirmedLines.length} bekreftet linje{confirmedLines.length === 1 ? "" : "r"}</span>
        </div>

        {/* Bekreftede linjer – listet øverst */}
        {confirmedLines.length > 0 && (
          <div className="space-y-2">
            {confirmedLines.map((l, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded p-2 flex-wrap" data-testid={`portal-confirmed-line-${idx}`}>
                <CheckCircle2 className="h-4 w-4 text-green-700 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{l.item.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {l.size ? `Størrelse ${l.size}${l.jersey_number && l.jersey_number !== "X" ? ` · #${l.jersey_number}` : ""}` : "Uten størrelse"}
                    {l.note ? ` · ${l.note}` : ""}
                  </div>
                </div>
                <div className="text-sm font-bold font-mono bg-white border border-green-200 rounded px-2 py-0.5">{l.quantity_requested} stk</div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeConfirmed(idx)} data-testid={`portal-confirmed-remove-${idx}`} title="Fjern linje">
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Draft-linje: tom før varevalg, utfylt når vare er valgt */}
        <div ref={draftRowRef} className="pt-2">
          {draft.item ? (
            <div className="border border-red-300 bg-red-50/40 rounded p-3 space-y-3" data-testid="portal-draft-row">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">{draft.item.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {[draft.item.category, draft.item.main_group, draft.item.sub_group].filter(Boolean).join(" · ")}
                    {draft.size && ` · Størrelse ${draft.size}`}
                    {draft.jersey_number && draft.jersey_number !== "X" && ` · #${draft.jersey_number}`}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={clearDraft} title="Bytt vare" data-testid="portal-draft-cancel">
                  <X className="h-4 w-4 text-slate-500" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-[11px]">Antall *</Label>
                  <Input
                    type="number" min="1" step="1" value={draft.quantity_requested}
                    onChange={(e) => setDraft({ ...draft, quantity_requested: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                    autoFocus data-testid="portal-draft-qty"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-[11px]">Kommentar til linje (valgfri)</Label>
                  <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="F.eks. 'ekstra store'" data-testid="portal-draft-note" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={confirmDraft} className="bg-red-900 hover:bg-red-800" data-testid="portal-draft-confirm">
                  <Plus className="h-4 w-4 mr-1" />Legg til vare
                </Button>
              </div>
            </div>
          ) : (
            // Tom linje – med søkefelt rett under
            <div className="border border-dashed border-slate-300 rounded p-3 bg-slate-50/50 text-center text-xs text-slate-400" data-testid="portal-empty-row">
              Ingen vare valgt – søk etter en vare under og trykk for å legge til.
            </div>
          )}
        </div>

        {/* Søkefelt er alltid synlig når draft er tom (dvs. forventer nytt varevalg) */}
        {!draft.item && (
          <div className="pt-1">
            <Label>Søk etter vare</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Navn, kategori, varenummer..."
                className="pl-8"
                data-testid="portal-need-search"
              />
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
                        <Button type="button" size="sm" variant="outline" onClick={() => pickItem(it)} data-testid={`portal-pick-item-${it.id}`}>
                          <Plus className="h-3 w-3 mr-1" />Velg
                        </Button>
                      )}
                    </div>
                    {(it.sizes || []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {it.sizes.map((s, i) => (
                          <button type="button" key={i}
                                  onClick={() => pickItem(it, s)}
                                  className="text-[11px] bg-slate-100 hover:bg-red-100 border border-slate-200 rounded px-1.5 py-0.5"
                                  data-testid={`portal-pick-variant-${it.id}-${s.size}`}>
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
            <li><strong>Varelinjer:</strong> {confirmedLines.length}</li>
            {confirmedLines.map((l, i) => (
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
