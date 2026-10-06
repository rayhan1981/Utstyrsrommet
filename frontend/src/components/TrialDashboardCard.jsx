import React from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { Sparkles, Crown, AlertTriangle } from "lucide-react";

export default function TrialDashboardCard() {
  const nav = useNavigate();
  const { customer, me } = useAuth();
  const status = customer?.subscription_status || customer?.status;
  const daysLeft = me?.trial_days_left ?? 0;

  if (status === "expired") {
    return (
      <Card className="p-5 border-red-200 bg-gradient-to-br from-red-50 via-white to-white" data-testid="trial-card-expired">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg">Prøveperioden er avsluttet</h3>
            <p className="text-sm text-slate-600 mt-1">Din 7-dagers prøveperiode med Utstyrsrommet Deluxe er ferdig. Alle dataene dine er trygt lagret. Velg abonnement for å fortsette å administrere utstyr og lager.</p>
            <Button onClick={() => nav("/app/abonnement")} className="mt-3 bg-emerald-900 hover:bg-emerald-800" data-testid="trial-cta-expired">Velg abonnement</Button>
          </div>
        </div>
      </Card>
    );
  }

  if (status !== "trial") return null;

  // Dag 6 eller mindre → tydeligere varsel
  if (daysLeft <= 1) {
    return (
      <Card className="p-5 border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white" data-testid="trial-card-urgent">
        <div className="flex items-start gap-3">
          <Crown className="h-6 w-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg">{daysLeft === 1 ? "Siste dag av prøveperioden" : "Prøveperioden avsluttes snart"}</h3>
            <p className="text-sm text-slate-600 mt-1">Dataene dine er trygt lagret. Velg Basic, Pro eller Deluxe for å fortsette å bruke alle funksjonene i Utstyrsrommet.</p>
            <Button onClick={() => nav("/app/abonnement")} className="mt-3 bg-emerald-900 hover:bg-emerald-800" data-testid="trial-cta-urgent">Velg abonnement</Button>
          </div>
        </div>
      </Card>
    );
  }

  // Dag 4-5 → vennlig CTA
  if (daysLeft <= 3) {
    return (
      <Card className="p-5 border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white" data-testid="trial-card-midterm">
        <div className="flex items-start gap-3">
          <Sparkles className="h-6 w-6 text-emerald-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg">Liker du Utstyrsrommet?</h3>
            <p className="text-sm text-slate-600 mt-1">Du bruker nå Deluxe-versjonen med full tilgang. Når prøveperioden er ferdig kan du velge mellom Basic, Pro og Deluxe. {daysLeft} dag{daysLeft === 1 ? "" : "er"} igjen.</p>
            <Button variant="outline" onClick={() => nav("/app/abonnement")} className="mt-3" data-testid="trial-cta-midterm">Se abonnementene</Button>
          </div>
        </div>
      </Card>
    );
  }

  // Dag 1-3 → diskret kort
  return (
    <Card className="p-5 border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white" data-testid="trial-card-early">
      <div className="flex items-start gap-3">
        <Sparkles className="h-6 w-6 text-emerald-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-display font-bold text-lg">Prøv hele Utstyrsrommet</h3>
          <p className="text-sm text-slate-600 mt-1">Du bruker nå Deluxe og har tilgang til alle funksjoner. {daysLeft} dag{daysLeft === 1 ? "" : "er"} igjen av prøveperioden.</p>
          <Button variant="outline" onClick={() => nav("/app/abonnement")} className="mt-3" data-testid="trial-cta-early">Se abonnement</Button>
        </div>
      </div>
    </Card>
  );
}
