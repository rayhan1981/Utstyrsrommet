import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { User, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function ProfileCard() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setForm({ name: user.name || "", phone: user.phone || "", address: user.address || "" });
  }, [user?.id]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/auth/me/profile", form);
      toast.success("Profil oppdatert");
      if (refresh) await refresh();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Card className="p-5" data-testid="profile-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-md bg-red-900/10 flex items-center justify-center shrink-0">
          <User className="h-5 w-5 text-red-800" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-bold">Min profil</h3>
          <p className="text-xs text-slate-500 mt-1">Navn og telefon vises bl.a. i signaturen på utstyrs-PDFer sendt til lagledere.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Navn</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="profile-name" />
        </div>
        <div>
          <Label className="flex items-center gap-1"><Phone className="h-3 w-3" />Telefon</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+47 ..." data-testid="profile-phone" />
          <p className="text-[11px] text-slate-500 mt-1">Vises i signaturen "Mvh / [navn] / [telefon] / [klubb]" på PDFer du sender</p>
        </div>
        <div className="sm:col-span-2">
          <Label className="flex items-center gap-1"><MapPin className="h-3 w-3" />Adresse (valgfri)</Label>
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="profile-address" />
        </div>
      </div>
      <div className="mt-4">
        <Button onClick={save} disabled={saving} className="bg-red-900 hover:bg-red-800" data-testid="save-profile-btn">
          {saving ? "Lagrer..." : "Lagre profil"}
        </Button>
      </div>
    </Card>
  );
}
