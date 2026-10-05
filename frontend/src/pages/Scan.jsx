import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, ArrowLeft, QrCode, CheckCircle2 } from "lucide-react";

export default function Scan() {
  const nav = useNavigate();
  const scannerRef = useRef(null);
  const [item, setItem] = useState(null);
  const [people, setPeople] = useState([]);
  const [teams, setTeams] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState({ quantity: 1, person_id: "none", team_id: "none", loan_target: "person", size: "", jersey_number: "", due_in_days: 30, notes: "" });

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  useEffect(() => {
    Promise.all([api.get("/people"), api.get("/teams")]).then(([p, t]) => { setPeople(p.data); setTeams(t.data); });
  }, []);

  const start = async () => {
    try {
      setScanning(true);
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded) => { await handleScan(decoded); },
        () => {}
      );
    } catch (e) {
      toast.error("Kunne ikke åpne kamera: " + (e.message || "ukjent feil"));
      setScanning(false);
    }
  };

  const stop = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); await scannerRef.current.clear(); } catch (e) {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const handleScan = async (itemId) => {
    await stop();
    try {
      const { data } = await api.get(`/items/${itemId}`);
      setItem(data);
      setForm((f) => ({ ...f, size: "", jersey_number: "" }));
      toast.success(`Fant: ${data.name}`);
    } catch (e) {
      toast.error("Ukjent QR-kode - vare ikke funnet");
    }
  };

  const register = async () => {
    try {
      if (form.loan_target === "person" && form.person_id === "none") { toast.error("Velg person"); return; }
      if (form.loan_target === "team" && form.team_id === "none") { toast.error("Velg lag"); return; }
      await api.post("/loans", {
        mode: "loan", charge_price: true,
        item_id: item.id,
        quantity: parseInt(form.quantity) || 1,
        team_id: form.team_id === "none" ? null : form.team_id,
        person_id: form.person_id === "none" ? null : form.person_id,
        loan_target: form.loan_target,
        size: form.size || null,
        jersey_number: form.jersey_number || null,
        due_in_days: parseInt(form.due_in_days),
        notes: form.notes,
      });
      toast.success("Utlån registrert!");
      setItem(null);
      setForm({ quantity: 1, person_id: "none", team_id: "none", loan_target: "person", size: "", jersey_number: "", due_in_days: 30, notes: "" });
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  useEffect(() => () => { stop(); }, []);

  return (
    <div className="space-y-4 max-w-2xl mx-auto" data-testid="scan-page">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav("/app")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="font-display text-2xl font-extrabold">Skann QR-kode</h1>
      </div>

      {!item && (
        <Card className="p-4 space-y-3">
          <div id="qr-reader" className="rounded-md overflow-hidden" style={{ minHeight: scanning ? 280 : 0 }}></div>
          {!scanning ? (
            <Button onClick={start} className="w-full bg-emerald-900 hover:bg-emerald-800" data-testid="start-scan-btn">
              <Camera className="h-5 w-5 mr-2" />Start kamera-skanning
            </Button>
          ) : (
            <Button onClick={stop} variant="outline" className="w-full" data-testid="stop-scan-btn">Stopp skanning</Button>
          )}
          <p className="text-xs text-slate-500 text-center">Rett kameraet mot QR-koden på varen. Første gang må du gi tillatelse til kamera i nettleseren.</p>
        </Card>
      )}

      {item && (
        <Card className="p-4 space-y-3" data-testid="scan-loan-form">
          <div className="flex items-center gap-3 bg-emerald-50 rounded-md p-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-700" />
            <div>
              <div className="font-bold">{item.name}</div>
              <div className="text-xs text-slate-600">{nok(item.price)} · lager: {item.total_stock} · {item.location || "ingen lokasjon"}</div>
            </div>
          </div>

          <div className="border border-slate-200 rounded-md p-3 bg-emerald-50/50">
            <Label className="text-sm font-semibold">Skyldig beløp går til</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button type="button" onClick={() => setForm({ ...form, loan_target: "person" })} className={`py-2 px-3 rounded-md text-sm font-semibold transition ${form.loan_target === "person" ? "bg-emerald-900 text-white" : "bg-white border border-slate-200"}`} data-testid="scan-target-person">Person</button>
              <button type="button" onClick={() => setForm({ ...form, loan_target: "team" })} className={`py-2 px-3 rounded-md text-sm font-semibold transition ${form.loan_target === "team" ? "bg-emerald-900 text-white" : "bg-white border border-slate-200"}`} data-testid="scan-target-team">Lag</button>
            </div>
          </div>

          {form.loan_target === "person" ? (
            <div>
              <Label>Person</Label>
              <Select value={form.person_id} onValueChange={(v) => setForm({ ...form, person_id: v })}>
                <SelectTrigger data-testid="scan-person-select"><SelectValue placeholder="Velg person" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Velg person</SelectItem>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>Lag</Label>
              <Select value={form.team_id} onValueChange={(v) => setForm({ ...form, team_id: v })}>
                <SelectTrigger data-testid="scan-team-select"><SelectValue placeholder="Velg lag" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Velg lag</SelectItem>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.team_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {(item.is_clothing || item.is_ball) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Størrelse</Label>
                <Select value={form.size} onValueChange={(v) => {
                  const s = (item.sizes || []).find((x) => x.size === v);
                  setForm({ ...form, size: v, jersey_number: s?.jersey_number || (item.is_ball ? "" : "X") });
                }}>
                  <SelectTrigger><SelectValue placeholder="Str" /></SelectTrigger>
                  <SelectContent>{(item.sizes || []).map((s) => <SelectItem key={s.size} value={s.size}>{s.size} (lager: {s.quantity})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {item.is_clothing && <div><Label>Draktnr</Label><Input value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} /></div>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Antall</Label><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="scan-qty" /></div>
            <div>
              <Label>Forfallsfrist</Label>
              <Select value={String(form.due_in_days)} onValueChange={(v) => setForm({ ...form, due_in_days: parseInt(v) })}>
                <SelectTrigger data-testid="scan-due"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="7">7 dager</SelectItem><SelectItem value="14">14 dager</SelectItem><SelectItem value="30">30 dager</SelectItem></SelectContent>
              </Select>
            </div>
          </div>

          <div><Label>Notater</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setItem(null)} className="flex-1" data-testid="scan-cancel-btn">Avbryt / Skann ny</Button>
            <Button onClick={register} className="flex-1 bg-emerald-900 hover:bg-emerald-800" data-testid="scan-register-btn">Registrer utlån</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
