import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { portalApi, formatPortalError } from "./portalApi";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

const STATUS_PILL = {
  sendt: "bg-slate-200 text-slate-700",
  under_behandling: "bg-blue-100 text-blue-800",
  behandlet_ma_bestilles: "bg-amber-100 text-amber-800",
  behandlet_dellevering: "bg-orange-100 text-orange-900",
  kan_leveres_omgaende: "bg-green-100 text-green-800",
  avsluttet: "bg-slate-100 text-slate-600",
  trukket_tilbake: "bg-slate-100 text-slate-500 line-through",
};

export default function PortalNeedsList() {
  const [list, setList] = useState(null);
  useEffect(() => {
    portalApi.get("/needs")
      .then((r) => setList(r.data))
      .catch((e) => toast.error(formatPortalError(e.response?.data?.detail)));
  }, []);
  if (list === null) return <div className="text-center text-slate-500 py-8">Laster…</div>;
  return (
    <Card className="p-5" data-testid="portal-needs-list">
      <h1 className="text-xl font-bold mb-3">Behovsmeldinger</h1>
      {list.length === 0 ? <div className="text-sm text-slate-500 italic">Ingen behovsmeldinger ennå.</div> : (
        <ul className="divide-y divide-slate-100">
          {list.map((n) => (
            <li key={n.id} className="py-3 flex items-center gap-3 flex-wrap">
              <Link to={`/behov/${n.id}`} className="font-mono text-sm font-bold hover:underline">{n.number}</Link>
              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${STATUS_PILL[n.status] || "bg-slate-100 text-slate-600"}`}>{n.status_label}</span>
              <span className="text-sm text-slate-600">Ønsket: {n.wanted_date}</span>
              <span className="text-xs text-slate-400 ml-auto">{new Date(n.created_at).toLocaleString("nb-NO")}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
