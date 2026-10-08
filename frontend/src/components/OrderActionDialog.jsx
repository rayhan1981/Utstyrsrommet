import React, { useState } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Printer, Mail, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Dialog som vises rett etter at en bestilling er opprettet (via quick-order e.l.).
 * Gir brukeren 3 valg:
 *  - Lagre lokalt (last ned PDF)
 *  - Skriv ut (åpner PDF i ny fane for print)
 *  - Send e-post til leverandør (med PDF-vedlegg)
 */
export default function OrderActionDialog({ open, onClose, order, supplier }) {
  const [sending, setSending] = useState(false);
  const [emailOverride, setEmailOverride] = useState("");
  const BASE = process.env.REACT_APP_BACKEND_URL;

  if (!order) return null;

  const fetchPdfBlob = async () => {
    const token = localStorage.getItem("utr_token");
    const res = await fetch(`${BASE}/api/orders/${order.id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Kunne ikke hente PDF");
    return await res.blob();
  };

  const saveLocal = async () => {
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bestilling_${order.po_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF lastet ned");
    } catch (e) { toast.error(e.message || "Ukjent feil"); }
  };

  const printPdf = async () => {
    try {
      const blob = await fetchPdfBlob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        toast.error("Pop-up blokkert – tillat pop-ups for denne siden");
        return;
      }
      // Vent litt så PDF-en rekker å lastes, trigger så print-dialog
      setTimeout(() => { try { win.print(); } catch {} }, 1000);
    } catch (e) { toast.error(e.message || "Ukjent feil"); }
  };

  const sendEmail = async () => {
    const to = (emailOverride || supplier?.email || "").trim();
    if (!to || !/^[^@]+@[^@]+\.[^@]+$/.test(to)) {
      toast.error("Angi en gyldig e-postadresse til leverandør");
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post(`/orders/${order.id}/send`, { to });
      toast.success(`Bestilling sendt til ${data.to} med PDF-vedlegg`);
      onClose && onClose();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Bestilling {order.po_number} opprettet
          </DialogTitle>
          <DialogDescription>
            Velg hva du vil gjøre med PDF-en nå. Du kan alltid komme tilbake til bestillingen under «Bestillinger».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Button onClick={saveLocal} variant="outline" className="w-full justify-start h-auto py-3"
                  data-testid="order-action-save">
            <Download className="h-4 w-4 mr-3 text-sky-700" />
            <div className="text-left">
              <div className="font-semibold">Lagre lokalt</div>
              <div className="text-xs text-slate-500">Last ned bestilling_{order.po_number}.pdf til din PC</div>
            </div>
          </Button>

          <Button onClick={printPdf} variant="outline" className="w-full justify-start h-auto py-3"
                  data-testid="order-action-print">
            <Printer className="h-4 w-4 mr-3 text-slate-700" />
            <div className="text-left">
              <div className="font-semibold">Skriv ut</div>
              <div className="text-xs text-slate-500">Åpner PDF i ny fane og starter utskrift</div>
            </div>
          </Button>

          <div className="border border-slate-200 rounded-md p-3 space-y-2 bg-slate-50">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Mail className="h-4 w-4 text-red-700" />Send til leverandør
            </div>
            <div>
              <Label className="text-xs">E-post{supplier?.email ? "" : " (leverandør mangler e-post)"}</Label>
              <Input
                type="email"
                placeholder={supplier?.email || "ordre@leverandor.no"}
                defaultValue={supplier?.email || ""}
                onChange={(e) => setEmailOverride(e.target.value)}
                data-testid="order-action-email-input"
              />
            </div>
            <Button onClick={sendEmail} disabled={sending} className="w-full bg-red-700 hover:bg-red-800"
                    data-testid="order-action-send-email">
              <Mail className="h-4 w-4 mr-2" />{sending ? "Sender…" : "Send med PDF-vedlegg"}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
