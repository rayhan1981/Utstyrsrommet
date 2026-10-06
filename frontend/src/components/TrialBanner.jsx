import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Sparkles, AlertTriangle, Clock } from "lucide-react";

export default function TrialBanner() {
  const { customer, me } = useAuth();
  const status = customer?.subscription_status || customer?.status;
  const daysLeft = me?.trial_days_left ?? 0;

  const content = useMemo(() => {
    if (status === "expired") {
      return { label: "Prøveperioden er avsluttet", tone: "red", icon: AlertTriangle };
    }
    if (status === "trial") {
      if (daysLeft <= 1) return { label: "Prøveperioden avsluttes i morgen", tone: "amber", icon: Clock };
      return { label: `Deluxe prøveperiode • ${daysLeft} dag${daysLeft === 1 ? "" : "er"} igjen`, tone: "emerald", icon: Sparkles };
    }
    return null;
  }, [status, daysLeft]);

  if (!content) return null;

  if (content.tone === "amber" && daysLeft <= 0) {
    content.label = "Siste dag av prøveperioden";
  }
  const toneCls = {
    red: "bg-red-50 border-red-200 text-red-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
  }[content.tone];
  const Icon = content.icon;

  return (
    <Link to="/app/abonnement" className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${toneCls} hover:opacity-80 transition`} data-testid="trial-banner">
      <Icon className="h-3.5 w-3.5" />
      {content.label}
    </Link>
  );
}
