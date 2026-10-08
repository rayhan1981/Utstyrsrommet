import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackagePlus, Camera, CheckCircle2, QrCode, Search } from "lucide-react";
import { toast } from "sonner";
import { sortSizesNatural } from "@/lib/sizeSort";

export default function Varemottak() {
  const [items, setItems] = useState([]);
  const [recent, setRecent] = useState([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(null); // {item, size, jersey_number}
  const [qty, setQty] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef(null);

  const load = async () => {
    const [it, rc] = await Promise.all([api.get("/items"), api.get("/stock-receipts")]);
    setItems(it.data); setRecent(rc.data);
  };
  useEffect(() => { load(); }, []);

  const matches = items.filter((i) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (i.name || "").toLowerCase().includes(q) ||
      (i.category || "").toLowerCase().includes(q) ||
      (i.main_group || "").toLowerCase().includes(q) ||
      (i.sub_group || "").toLowerCase().includes(q) ||
      (i.sizes || []).some((s) => (s.size || "").toLowerCase().includes(q))
    );
  }).slice(0, 200);

  // Gruppere matches per Kategori → Hovedgruppe for ryddigere oversikt
  const matchesGrouped = (() => {
    const groups = {};
    matches.forEach((i) => {
      const cat = (i.category || "Uten kategori").trim() || "Uten kategori";
      const grp = (i.main_group || "Uten hovedgruppe").trim() || "Uten hovedgruppe";
      const key = `${cat} · ${grp}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(i);
    });
    return Object.keys(groups).sort().map((k) => ({ key: k, items: groups[k] }));
  })();

  const pickItem = (i, size = null, jersey_number = null) => {
    setPicked({ item: i, size, jersey_number });
    setQty("");
  };

  const currentQty = () => {
    if (!picked) return 0;
    const { item, size, jersey_number } = picked;
    if (item.is_clothing || item.is_ball) {
      const s = (item.sizes || []).find((x) => x.size === size && (!jersey_number || x.jersey_number === jersey_number));
      return s?.quantity ?? 0;
    }
    return item.total_stock ?? 0;
  };

  const submit = async () => {
    if (!picked) return;
    const q = parseInt(qty, 10);
    if (!Number.isInteger(q) || q <= 0) { toast.error("Antall må være et positivt heltall"); return; }
    if ((picked.item.is_clothing || picked.item.is_ball) && !picked.size) {
      toast.error("Velg størrelse først"); return;
    }
    setSubmitting(true);
    try {
      const reqId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      await api.post("/stock-receipts", {
        request_id: reqId,
        item_id: picked.item.id,
        size: picked.size || null,
        jersey_number: picked.jersey_number || null,
        quantity: q,
        order_ref: orderRef, comment,
      });
      toast.success(`Varemottak registrert: +${q} ${picked.item.name}${picked.size ? ` (${picked.size})` : ""}`);
      setPicked(null); setQty(""); setOrderRef(""); setComment("");
      await load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setSubmitting(false); }
  };

  const startScan = async () => {
    try {
      setScanning(true);
      const s = new Html5Qrcode("qr-reader-receipt");
      scannerRef.current = s;
      await s.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (code) => { await handleScan(code); },
        () => {}
      );
    } catch (e) {
      toast.error("Kunne ikke åpne kamera");
      setScanning(false);
    }
  };
  const stopScan = async () => {
    if (scannerRef.current) { try { await scannerRef.current.stop(); await scannerRef.current.clear(); } catch {} scannerRef.current = null; }
    setScanning(false);
  };
  useEffect(() => () => { stopScan(); }, []);

  const handleScan = async (code) => {
    await stopScan();
    try {
      const { data } = await api.post("/stock-receipts/resolve-qr", { code });
      let size = data.size || null;
      let jersey = null;
      if (size && data.item.is_clothing) {
        const s = (data.item.sizes || []).find((x) => x.size === size);
        jersey = s?.jersey_number || null;
      }
      setPicked({ item: data.item, size, jersey_number: jersey });
      toast.success(`Fant: ${data.item.name}${size ? ` (${size})` : ""}`);
    } catch (e) {
      toast.error("Ukjent QR-kode. Velg vare manuelt i stedet.");
    }
  };

  return (
    <div className="space-y-5" data-testid="varemottak-page">
      <div>
        <h1 className="font-display text-3xl font-extrabold flex items-center gap-2">
          <PackagePlus className="h-7 w-7 text-red-700" />Varemottak
        </h1>
        <p className="text-slate-600 text-sm mt-1">Registrer mottatte varer og oppdater beholdningen</p>
      </div>

      {picked ? (
        <Card className="p-5 space-y-4" data-testid="receipt-form">
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-md p-3">
            <CheckCircle2 className="h-6 w-6 text-red-700" />
            <div className="flex-1">
              <div className="font-bold">{picked.item.name}</div>
              <div className="text-xs text-slate-600">
                {picked.size ? `Str: ${picked.size}` : "Ingen størrelse"}
                {picked.jersey_number ? ` · #${picked.jersey_number}` : ""}
                {picked.item.location ? ` · @ ${picked.item.location}` : ""}
              </div>
            </div>
          </div>

          {(picked.item.is_clothing || picked.item.is_ball) && !picked.size && (
            <div>
              <Label>Størrelse</Label>
              <Select value={picked.size || ""} onValueChange={(v) => {
                const s = (picked.item.sizes || []).find((x) => x.size === v);
                setPicked({ ...picked, size: v, jersey_number: s?.jersey_number || null });
              }}>
                <SelectTrigger data-testid="receipt-size-select"><SelectValue placeholder="Velg størrelse" /></SelectTrigger>
                <SelectContent>
                  {sortSizesNatural((picked.item.sizes || []), (s) => s.size).map((s) => (
                    <SelectItem key={`${s.size}-${s.jersey_number || ""}`} value={s.size}>
                      {s.size}{picked.item.is_clothing && s.jersey_number && s.jersey_number !== "X" ? ` · #${s.jersey_number}` : ""} (lager: {s.quantity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Mottatt antall</Label>
              <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="receipt-qty-input" />
            </div>
            <div>
              <Label>Beholdning før</Label>
              <Input value={currentQty()} readOnly className="bg-slate-50" />
            </div>
            <div>
              <Label>Beholdning etter</Label>
              <Input value={currentQty() + (parseInt(qty, 10) || 0)} readOnly className="bg-slate-50 font-semibold text-red-700" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Bestillingsreferanse (valgfri)</Label><Input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} data-testid="receipt-orderref" /></div>
            <div><Label>Kommentar (valgfri)</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} data-testid="receipt-comment" /></div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPicked(null)} className="flex-1">Avbryt</Button>
            <Button onClick={submit} disabled={submitting} className="flex-1 bg-red-700 hover:bg-red-800" data-testid="confirm-receipt-btn">
              {submitting ? "Lagrer…" : "Bekreft varemottak"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list" data-testid="tab-receipt-list"><Search className="h-4 w-4 mr-1" />Velg vare fra liste</TabsTrigger>
              <TabsTrigger value="qr" data-testid="tab-receipt-qr"><QrCode className="h-4 w-4 mr-1" />Motta vare QR</TabsTrigger>
            </TabsList>
            <TabsContent value="list" className="pt-4 space-y-3">
              <Input placeholder="Søk varenavn, kategori, størrelse…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="receipt-search" />
              <p className="text-xs text-slate-500">💡 Varer gruppert etter Kategori · Hovedgruppe. Klikk størrelse for å velge variant.</p>
              <div className="max-h-[520px] overflow-y-auto space-y-3">
                {matchesGrouped.length === 0 && <div className="text-center text-slate-500 py-6 border border-dashed rounded-md">Ingen treff</div>}
                {matchesGrouped.map((g) => (
                  <div key={g.key} className="border border-slate-200 rounded-md overflow-hidden">
                    <div className="bg-red-50/60 border-b border-red-100 px-3 py-2 font-semibold text-xs text-red-900">{g.key} <span className="text-slate-500">({g.items.length})</span></div>
                    <Table>
                      <TableHeader><TableRow><TableHead>Vare</TableHead><TableHead>Undergruppe</TableHead><TableHead>Varianter / Beholdning</TableHead><TableHead></TableHead></TableRow></TableHeader>
                      <TableBody>
                        {g.items.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="font-semibold">{i.name}</TableCell>
                            <TableCell className="text-xs text-slate-600">{i.sub_group || "-"}</TableCell>
                            <TableCell className="text-xs">
                              {(i.is_clothing || i.is_ball) ? (
                                <div className="flex flex-wrap gap-1">
                                  {sortSizesNatural((i.sizes || []), (s) => s.size).map((s) => (
                                    <button key={`${s.size}-${s.jersey_number || ""}`}
                                            onClick={() => pickItem(i, s.size, s.jersey_number)}
                                            className="text-xs px-2 py-0.5 rounded bg-slate-100 hover:bg-red-100 hover:text-red-800"
                                            data-testid={`pick-variant-${i.id}-${s.size}`}>
                                      {s.size}{i.is_clothing && s.jersey_number && s.jersey_number !== "X" ? `·#${s.jersey_number}` : ""} ({s.quantity})
                                    </button>
                                  ))}
                                </div>
                              ) : <span className="text-slate-500">Lager: {i.total_stock}</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {!(i.is_clothing || i.is_ball) && (
                                <Button size="sm" variant="outline" onClick={() => pickItem(i)} data-testid={`pick-item-${i.id}`}>Velg</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="qr" className="pt-4 space-y-3">
              <div id="qr-reader-receipt" className="rounded-md overflow-hidden" style={{ minHeight: scanning ? 280 : 0 }}></div>
              {!scanning ? (
                <Button onClick={startScan} className="w-full bg-red-700 hover:bg-red-800" data-testid="start-scan-receipt">
                  <Camera className="h-5 w-5 mr-2" />Start QR-skanning
                </Button>
              ) : (
                <Button onClick={stopScan} variant="outline" className="w-full">Stopp skanning</Button>
              )}
              <p className="text-xs text-slate-500">Rett kameraet mot varens QR-kode. Hvis QR ikke gjenkjennes, bruk «Velg vare fra liste»-fanen.</p>
            </TabsContent>
          </Tabs>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-semibold text-sm mb-3">Siste varemottak ({recent.length})</h3>
        <div className="max-h-[300px] overflow-y-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Dato</TableHead><TableHead>Vare</TableHead><TableHead>Str</TableHead><TableHead className="text-right">Antall</TableHead><TableHead className="text-right">Før→Etter</TableHead><TableHead>Bruker</TableHead></TableRow></TableHeader>
            <TableBody>
              {recent.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-6">Ingen mottak ennå</TableCell></TableRow>}
              {recent.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("nb-NO")}</TableCell>
                  <TableCell>{r.item_name}</TableCell>
                  <TableCell>{r.size || "-"}</TableCell>
                  <TableCell className="text-right font-semibold text-red-700">+{r.quantity}</TableCell>
                  <TableCell className="text-right text-xs text-slate-500">{r.qty_before} → {r.qty_after}</TableCell>
                  <TableCell className="text-xs">{r.user_name || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
