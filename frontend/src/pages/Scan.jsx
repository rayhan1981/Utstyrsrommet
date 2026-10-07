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
import { Camera, ArrowLeft, QrCode, CheckCircle2, RefreshCw } from "lucide-react";
import LoanDialog from "@/components/LoanDialog";

export default function Scan() {
  const nav = useNavigate();
  const scannerRef = useRef(null);
  const [item, setItem] = useState(null);
  const [people, setPeople] = useState([]);
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scannedSize, setScannedSize] = useState("");
  const [loanOpen, setLoanOpen] = useState(false);

  const nok = (v) => (v || 0).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

  useEffect(() => {
    Promise.all([api.get("/people"), api.get("/teams"), api.get("/items")]).then(([p, t, i]) => {
      setPeople(p.data); setTeams(t.data); setItems(i.data);
    });
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

  const handleScan = async (decoded) => {
    await stop();
    try {
      let itemId = decoded;
      let sz = "";
      if (decoded && decoded.includes("#")) {
        const parts = decoded.split("#", 2);
        itemId = parts[0]; sz = parts[1] || "";
      }
      const { data } = await api.get(`/items/${itemId}`);
      setItem(data);
      setScannedSize(sz);
      toast.success(`Fant: ${data.name}${sz ? " - " + sz : ""}`);
      setLoanOpen(true);
    } catch (e) {
      toast.error("Ukjent QR-kode - vare ikke funnet");
    }
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
            <Button onClick={start} className="w-full bg-red-900 hover:bg-red-800" data-testid="start-scan-btn">
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
          <div className="flex items-center gap-3 bg-red-50 rounded-md p-3">
            <CheckCircle2 className="h-6 w-6 text-red-700" />
            <div className="flex-1">
              <div className="font-bold">{item.name}</div>
              <div className="text-xs text-slate-600">{nok(item.price)} · lager: {item.total_stock} · {item.location || "ingen lokasjon"}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setItem(null); setLoanOpen(false); }} className="flex-1 flex-col h-auto py-2" data-testid="scan-cancel-btn">
              <RefreshCw className="h-4 w-4 mb-1" />
              <span className="text-xs">Skann ny vare</span>
            </Button>
            <Button onClick={() => setLoanOpen(true)} className="flex-1 bg-red-900 hover:bg-red-800 flex-col h-auto py-2" data-testid="scan-open-loan-btn">
              <QrCode className="h-4 w-4 mb-1" />
              <span className="text-xs">Fortsett til utlån</span>
            </Button>
          </div>

          <p className="text-xs text-slate-500 text-center">Klikk "Fortsett til utlån" for å legge til flere varer, velge utlevering/utlån og egen frist pr vare.</p>
        </Card>
      )}

      <LoanDialog
        open={loanOpen}
        onOpenChange={(o) => { setLoanOpen(o); if (!o) setItem(null); }}
        items={items} teams={teams} people={people}
        context={item ? { itemId: item.id, size: scannedSize, title: `Utlån – skannet ${item.name}` } : {}}
        onSaved={() => { setLoanOpen(false); setItem(null); }}
      />
    </div>
  );
}
