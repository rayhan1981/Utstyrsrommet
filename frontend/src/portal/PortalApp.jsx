import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import PortalLogin from "./PortalLogin";
import PortalSetPassword from "./PortalSetPassword";
import PortalLayout from "./PortalLayout";
import PortalDashboard from "./PortalDashboard";
import PortalNeedsNew from "./PortalNeedsNew";
import PortalNeedsDetail from "./PortalNeedsDetail";
import PortalNeedsList from "./PortalNeedsList";

/**
 * Egen rutetre for lagsportal.utstyrsrommet.no.
 * Serveres samme bygg som klubbappen, men hovednivået detekterer hostname
 * (`portal.*`) eller path-prefix `/portal` og rendrer dette komponenten.
 *
 * Så lenge Lagsportalen er montert settes dokumenttittelen til «Portal Utstyrsrommet»
 * (uavhengig av om vi er på portal.utstyrsrommet.no eller preview-fallbacken).
 */
export default function PortalApp() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Portal Utstyrsrommet";
    return () => { document.title = prev; };
  }, []);

  return (
    <>
      <Routes>
        <Route path="innlogging" element={<PortalLogin />} />
        <Route path="sett-passord" element={<PortalSetPassword />} />
        <Route element={<PortalLayout />}>
          <Route index element={<PortalDashboard />} />
          <Route path="behov" element={<PortalNeedsList />} />
          <Route path="behov/nytt" element={<PortalNeedsNew />} />
          <Route path="behov/:id" element={<PortalNeedsDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}
