import React, { useEffect, useState, useCallback } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";

/**
 * NotificationCenter has two parts:
 * 1) Bell button (for Layout header) with unread count
 * 2) Forced popup when there are undismissed overdue notifications
 */
export default function NotificationCenter() {
  const [data, setData] = useState({ overdue: [], unseen: [], unseen_count: 0 });
  const [open, setOpen] = useState(false);         // bell dialog (user-opened)
  const [popup, setPopup] = useState(false);       // forced popup (unseen)
  const [extendFor, setExtendFor] = useState(null);
  const [extendDays, setExtendDays] = useState("7");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications");
      setData(data);
      if (data.unseen_count > 0) setPopup(true);
    } catch (e) {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const dismiss = async () => {
    try { await api.post("/notifications/dismiss"); setPopup(false); await load(); } catch (e) {}
  };

  const extend = async () => {
    try {
      await api.post(`/loans/${extendFor.id}/extend`, { due_in_days: parseInt(extendDays) });
      toast.success(`Ny forfallsdato satt (${extendDays} dager)`);
      setExtendFor(null);
      await load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  };

  const fmt = (iso) => new Date(iso).toLocaleDateString("nb-NO");

  const List = ({ items }) => (
    <div className="space-y-2 max-h-[55vh] overflow-y-auto">
      {items.length === 0 && <p className="text-sm text-slate-500 text-center py-6">Ingen forfalte utlån 🎉</p>}
      {items.map((l) => (
        <div key={l.id} className="border border-red-200 bg-red-50/50 rounded-md p-3 flex items-start gap-3" data-testid={`notif-${l.id}`}>
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{l.item_name}{l.size ? ` (${l.size})` : ""} × {l.quantity}</div>
            <div className="text-xs text-slate-600 mt-0.5">Forfalt: <strong className="text-red-700">{fmt(l.due_date)}</strong></div>
            {l.notes && <div className="text-xs text-slate-500 mt-0.5">{l.notes}</div>}
          </div>
          <Button size="sm" variant="outline" onClick={() => { setExtendFor(l); setExtendDays("7"); }} data-testid={`extend-${l.id}`}>
            <Clock className="h-3 w-3 mr-1" />Forleng
          </Button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <button onClick={() => setOpen(true)} className="relative p-2 rounded-md hover:bg-slate-100" title="Varsler" data-testid="notif-bell">
        <Bell className="h-5 w-5 text-slate-700" />
        {data.unseen_count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center" data-testid="notif-count">{data.unseen_count}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Varslingssenter</DialogTitle>
            <DialogDescription>Alle forfalte utlån ({data.overdue.length})</DialogDescription>
          </DialogHeader>
          <List items={data.overdue} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Lukk</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={popup} onOpenChange={() => { /* kan ikke lukkes utenfra - må bekreftes */ }}>
        <DialogContent className="max-w-xl" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-red-700 flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Forfalte utlån</DialogTitle>
            <DialogDescription>Du har {data.unseen_count} forfalt{data.unseen_count === 1 ? "" : "e"} utlån. Håndter dem nedenfor.</DialogDescription>
          </DialogHeader>
          <List items={data.unseen} />
          <DialogFooter>
            <Button className="bg-red-900 hover:bg-red-800" onClick={dismiss} data-testid="notif-confirm-btn">Bekreft og lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extendFor} onOpenChange={(o) => !o && setExtendFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forleng frist</DialogTitle>
            <DialogDescription>{extendFor?.item_name} - velg ny forfallsfrist</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Select value={extendDays} onValueChange={setExtendDays}>
              <SelectTrigger data-testid="extend-days-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 dager</SelectItem>
                <SelectItem value="14">14 dager</SelectItem>
                <SelectItem value="30">30 dager</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">Nytt varsel genereres når den nye datoen overskrides.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendFor(null)}>Avbryt</Button>
            <Button onClick={extend} className="bg-red-900 hover:bg-red-800" data-testid="confirm-extend-btn">Sett ny frist</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
