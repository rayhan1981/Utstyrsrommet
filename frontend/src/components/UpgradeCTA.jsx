import React from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { Crown, Sparkles } from "lucide-react";

/**
 * CTA-banner som peker brukere mot Deluxe når de møter en Deluxe-feature.
 * Vis `inline` for liten banner midt i siden, eller full-page for route-level block.
 */
export default function UpgradeCTA({ feature = "qr_codes", title, description, inline = false }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const titles = {
    qr_codes: "QR-koder er med i Klubb Deluxe",
    product_images: "Produktbilder er med i Klubb Deluxe",
  };
  const descs = {
    qr_codes: "Generer unike QR-koder for alle varer og størrelser, skann dem fra mobilen for å lyn-raskt registrere utlån, og skriv ut etiketter med klubblogo i senter.",
    product_images: "Legg til hovedbilde på hver vare samt eget bilde pr. størrelse eller draktnummer, slik at utstyret er lett å kjenne igjen både i varetabellen og ved utlån.",
  };
  const t = title || titles[feature] || "Krever oppgradering";
  const d = description || descs[feature] || "Denne funksjonen er med i Klubb Deluxe-pakken.";

  const canUpgrade = user?.role === "admin";

  const Inner = (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
        <Crown className="h-6 w-6 text-amber-700" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-bold text-lg flex items-center gap-2">
          {t}
          <Sparkles className="h-4 w-4 text-amber-500" />
        </h3>
        <p className="text-sm text-slate-600 mt-1">{d}</p>
      </div>
      {canUpgrade ? (
        <Button onClick={() => nav("/app/abonnement")} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold" data-testid="upgrade-cta-btn">
          Oppgrader til Deluxe
        </Button>
      ) : (
        <span className="text-xs text-slate-500 italic">Kontakt klubbens admin for å oppgradere</span>
      )}
    </div>
  );

  if (inline) {
    return (
      <Card className="p-5 border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white" data-testid={`upgrade-cta-${feature}`}>
        {Inner}
      </Card>
    );
  }

  return (
    <div className="p-6 sm:p-10 max-w-3xl mx-auto">
      <Card className="p-6 sm:p-8 border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white" data-testid={`upgrade-cta-${feature}`}>
        {Inner}
      </Card>
    </div>
  );
}
