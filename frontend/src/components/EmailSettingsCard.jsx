import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Mail, Send, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";

const EMPTY = {
  method: "default",
  from_name: "",
  from_email: "",
  reply_to: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_use_tls: true,
  smtp_use_ssl: false,
  resend_api_key: "",
};

const Help = ({ children }) => (
  <p className="text-[11px] text-slate-500 mt-1 flex items-start gap-1">
    <Info className="h-3 w-3 mt-[2px] shrink-0 text-slate-400" /><span>{children}</span>
  </p>
);

export default function EmailSettingsCard() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/email-settings");
      setCfg(data);
      setForm({
        method: data.method || "default",
        from_name: data.from_name || "",
        from_email: data.from_email || "",
        reply_to: data.reply_to || "",
        smtp_host: data.smtp_host || "",
        smtp_port: data.smtp_port || 587,
        smtp_username: data.smtp_username || "",
        smtp_password: "",
        smtp_use_tls: data.smtp_use_tls !== false,
        smtp_use_ssl: !!data.smtp_use_ssl,
        resend_api_key: "",
      });
    } catch (e) {
      // ignore – permission denied / tenant missing
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.smtp_password) delete payload.smtp_password;
      if (!payload.resend_api_key) delete payload.resend_api_key;
      await api.put("/email-settings", payload);
      toast.success("E-postoppsett lagret");
      setForm((f) => ({ ...f, smtp_password: "", resend_api_key: "" }));
      await load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const { data } = await api.post("/email-settings/test", testTo ? { to: testTo } : {});
      toast.success(`Test-epost sendt til ${data.to} (${data.method})`);
      await load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setTesting(false); }
  };

  if (!cfg) return null;

  const method = form.method;

  return (
    <Card className="p-5" data-testid="email-settings-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-md bg-red-900/10 flex items-center justify-center shrink-0">
          <Mail className="h-5 w-5 text-red-800" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-bold">Avsender-epost (din egen)</h3>
          <p className="text-xs text-slate-500 mt-1">
            Konfigurer at eposter fra Utstyrsrommet sendes fra din egen klubbs adresse.
            Hvis du hopper over dette brukes vår standardavsender.
          </p>
        </div>
        {cfg.last_test_ok === true && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold">
            <CheckCircle2 className="h-4 w-4" /> Verifisert
          </span>
        )}
        {cfg.last_test_ok === false && (
          <span className="inline-flex items-center gap-1 text-xs text-red-700 font-semibold" title={cfg.last_test_error || ""}>
            <AlertCircle className="h-4 w-4" /> Siste test feilet
          </span>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label className="font-semibold">Hvordan skal e-poster sendes?</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            {[
              { v: "default", t: "Standard", d: "Utstyrsrommet sender for deg" },
              { v: "smtp", t: "Egen SMTP", d: "Gmail / Outlook / egen server" },
              { v: "resend", t: "Resend", d: "Profesjonelt – eget domene" },
            ].map((m) => (
              <button key={m.v} type="button" onClick={() => setForm({ ...form, method: m.v })}
                className={`text-left border rounded-md p-3 transition ${method === m.v ? "border-red-700 bg-red-50/40 ring-1 ring-red-700" : "border-slate-200 hover:border-slate-300"}`}
                data-testid={`email-method-${m.v}`}>
                <div className="font-semibold text-sm">{m.t}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{m.d}</div>
              </button>
            ))}
          </div>
        </div>

        {method !== "default" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Avsender-navn</Label>
              <Input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="Lillehammer IF" data-testid="email-from-name" />
              <Help>Navnet mottakeren ser som avsender. Bruk klubbens navn.</Help>
            </div>
            <div>
              <Label>Avsender-epost</Label>
              <Input type="email" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} placeholder="post@lillehammer-if.no" data-testid="email-from-email" />
              <Help>Adressen eposten sendes fra. {method === "resend" ? "Må være verifisert i Resend." : "Må være en adresse du eier."}</Help>
            </div>
          </div>
        )}

        <div>
          <Label>Svar-til (Reply-To) e-post <span className="text-[10px] text-slate-400 font-normal">valgfri</span></Label>
          <Input type="email" value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} placeholder="materialforvalter@lillehammer-if.no" data-testid="email-reply-to" />
          <Help>Når mottakeren trykker «Svar» i e-postklienten, går svaret hit i stedet for til avsender-adressen. Nyttig hvis dere sender fra en no-reply- eller systemadresse, men vil at svar skal gå til en bemannet innboks.</Help>
        </div>

        {method === "smtp" && (
          <div className="border border-slate-200 rounded-md p-3 bg-slate-50/50 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label>SMTP-vert</Label>
                <Input value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="smtp.gmail.com" data-testid="smtp-host" />
                <Help>Serveren som sender eposten. Eksempler: <code>smtp.gmail.com</code> (Gmail), <code>smtp.office365.com</code> (Outlook), <code>send.one.com</code> (One.com).</Help>
              </div>
              <div>
                <Label>Port</Label>
                <Input type="number" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: parseInt(e.target.value) || 587 })} data-testid="smtp-port" />
                <Help>587 for TLS (anbefalt). 465 for SSL. 25 for ukryptert.</Help>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Brukernavn</Label>
                <Input value={form.smtp_username} onChange={(e) => setForm({ ...form, smtp_username: e.target.value })} placeholder="post@lillehammer-if.no" data-testid="smtp-username" />
                <Help>Som regel samme som avsender-eposten.</Help>
              </div>
              <div>
                <Label>Passord {cfg.smtp_password_set && <span className="text-[10px] text-emerald-700 ml-1">(lagret: {cfg.smtp_password_masked})</span>}</Label>
                <Input type="password" value={form.smtp_password} onChange={(e) => setForm({ ...form, smtp_password: e.target.value })} placeholder={cfg.smtp_password_set ? "La stå tom for å beholde" : "••••••"} data-testid="smtp-password" />
                <Help>SMTP-passord eller app-passord. For Gmail: lag et app-passord på <a className="text-red-800 underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>.</Help>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.smtp_use_tls} onCheckedChange={(v) => setForm({ ...form, smtp_use_tls: v, smtp_use_ssl: v ? false : form.smtp_use_ssl })} data-testid="smtp-tls" />
                <span>Bruk STARTTLS (port 587)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.smtp_use_ssl} onCheckedChange={(v) => setForm({ ...form, smtp_use_ssl: v, smtp_use_tls: v ? false : form.smtp_use_tls })} data-testid="smtp-ssl" />
                <span>Bruk SSL/TLS (port 465)</span>
              </label>
            </div>
          </div>
        )}

        {method === "resend" && (
          <div className="border border-slate-200 rounded-md p-3 bg-slate-50/50 space-y-3">
            <div>
              <Label>Resend API-nøkkel {cfg.resend_api_key_set && <span className="text-[10px] text-emerald-700 ml-1">(lagret: {cfg.resend_api_key_masked})</span>}</Label>
              <Input type="password" value={form.resend_api_key} onChange={(e) => setForm({ ...form, resend_api_key: e.target.value })} placeholder={cfg.resend_api_key_set ? "La stå tom for å beholde" : "re_••••••••"} data-testid="resend-api-key" />
              <Help>Opprett konto på <a className="text-red-800 underline" href="https://resend.com" target="_blank" rel="noreferrer">resend.com</a>, verifiser domenet ditt, og lim inn API-nøkkelen her. Nøkkelen starter med <code>re_</code>.</Help>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
          <Button onClick={save} disabled={saving} className="bg-red-900 hover:bg-red-800" data-testid="save-email-settings">
            {saving ? "Lagrer..." : "Lagre innstillinger"}
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <Input placeholder="Test-mottaker (valgfri)" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="w-56" data-testid="email-test-to" />
            <Button variant="outline" onClick={sendTest} disabled={testing} data-testid="send-test-email">
              <Send className="h-3 w-3 mr-1" />{testing ? "Sender..." : "Send test-epost"}
            </Button>
          </div>
        </div>
        {cfg.last_test_at && (
          <p className="text-[11px] text-slate-500">
            Siste test: {new Date(cfg.last_test_at).toLocaleString("nb-NO")} – {cfg.last_test_ok ? "OK" : `Feil: ${cfg.last_test_error || ""}`}
          </p>
        )}
      </div>
    </Card>
  );
}
