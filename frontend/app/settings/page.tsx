"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUiStore } from "@/lib/store";
import { useUsageQuery } from "@/lib/queries";
import { ModelPreference } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LogOut, Check, Loader2, AlertCircle, CheckCircle2, KeyRound, MonitorSmartphone } from "lucide-react";
import { connectGoogle, signOut, signOutEverywhere, updateProfile } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { GoogleIcon } from "@/components/auth/google-icon";

const models: { value: ModelPreference; title: string; body: string }[] = [
  { value: "fast", title: "Fast", body: "Quicker answers, lighter checking. Good for quick lookups." },
  { value: "balanced", title: "Balanced", body: "Solid depth with reasonable wait times. The default." },
  { value: "deep", title: "Deep", body: "The most thorough evidence gathering and self-critique. Slower." },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-6">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { modelPreference, setModelPreference, user } = useUiStore();
  const { data: usage, isLoading } = useUsageQuery();

  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "all" | "out" | null>(null);

  const googleLinked = user?.providers?.includes("google") ?? false;

  // Result of returning from Google's consent screen
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("google");
    if (result === "linked") setNotice("Google is now connected. You can sign in with either method.");
    if (result === "in_use") setError("That Google account is already connected to a different CogNexa account.");
    if (result) window.history.replaceState(null, "", "/settings");
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateProfile(name);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your name.");
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGoogle = async () => {
    setError(null);
    setBusy("google");
    try {
      await connectGoogle();
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Couldn't start connecting Google.");
    }
  };

  const handleLogout = async (everywhere: boolean) => {
    setBusy(everywhere ? "all" : "out");
    try {
      await (everywhere ? signOutEverywhere() : signOut());
    } finally {
      router.replace("/login");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-5 pb-16 pt-10 sm:px-10 sm:pt-14">
        <PageHeader className="animate-view-in" title="Settings" description="Your account, how deep CogNexa digs, and what you've used." />

        <Tabs defaultValue="account" className="animate-view-in mt-12" style={{ animationDelay: "70ms" }}>
          <TabsList className="mb-8">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="models">Model</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          <TabsContent value="account">
            {(error || notice) && (
              <div
                role={error ? "alert" : "status"}
                className={cn(
                  "mb-4 flex items-center gap-2 rounded-xl px-3.5 py-3 text-[13px]",
                  error ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok"
                )}
              >
                {error ? <AlertCircle size={15} className="flex-shrink-0" /> : <CheckCircle2 size={15} className="flex-shrink-0" />}
                <span>{error || notice}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="rounded-2xl bg-surface shadow-sm">
              <div className="grid gap-5 p-6">
                <Field label="Full name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} required />
                </Field>
                <Field label="Email">
                  <Input type="email" value={user?.email || ""} readOnly disabled autoComplete="email" />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
                <div className="flex items-center gap-3">
                  <span
                    aria-live="polite"
                    className={cn(
                      "flex items-center gap-1.5 text-[12.5px] text-ok transition-[opacity,transform] duration-200 ease-out",
                      saved ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
                    )}
                  >
                    <Check size={14} /> Saved
                  </span>
                  <Button size="sm" type="submit" disabled={saving}>
                    {saving && <Loader2 size={14} className="animate-spin" />} Save changes
                  </Button>
                </div>
              </div>
            </form>

            <div className="mt-6 rounded-2xl bg-surface shadow-sm">
              <div className="border-b border-line px-6 py-4">
                <h2 className="text-[14px] font-semibold text-ink">Sign-in methods</h2>
              </div>
              <div className="flex items-center justify-between gap-4 px-6 py-4">
                <span className="flex items-center gap-3 text-[13.5px] text-ink">
                  <KeyRound size={16} className="text-ink-faint" /> Email and password
                </span>
                <span className="text-right text-[12.5px] text-ink-soft">
                  {user?.hasPassword ? "Set" : "Not set. Use “Forgot password” on the sign-in page to add one."}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-4">
                <span className="flex items-center gap-3 text-[13.5px] text-ink">
                  <GoogleIcon /> Google
                </span>
                {googleLinked ? (
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ok">
                    <Check size={14} /> Connected
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={handleConnectGoogle} disabled={busy !== null}>
                    {busy === "google" && <Loader2 size={14} className="animate-spin" />} Connect Google
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-6 py-4 shadow-sm">
              <Button type="button" variant="danger" size="sm" onClick={() => handleLogout(false)} disabled={busy !== null}>
                {busy === "out" ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Sign out
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => handleLogout(true)} disabled={busy !== null}>
                {busy === "all" ? <Loader2 size={14} className="animate-spin" /> : <MonitorSmartphone size={14} />} Sign out of all devices
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="models">
            <div role="radiogroup" aria-label="Model preference" className="overflow-hidden rounded-2xl bg-surface shadow-sm">
              {models.map((m, i) => {
                const selected = modelPreference === m.value;
                return (
                  <button
                    key={m.value}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setModelPreference(m.value)}
                    className={cn(
                      "flex w-full items-start gap-4 p-5 text-left transition-colors duration-150 hover:bg-surface2",
                      i > 0 && "border-t border-line"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                        selected ? "border-accent bg-accent" : "border-line-hover"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full bg-on-primary transition-transform duration-200 ease-out", selected ? "scale-100" : "scale-0")} />
                    </span>
                    <span>
                      <span className="block text-[14px] font-semibold text-ink">{m.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">{m.body}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="usage">
            <div className="rounded-2xl bg-surface p-6 shadow-sm">
              {isLoading && <div className="h-20 animate-pulse rounded-xl bg-surface3" />}
              <div className="grid gap-6">
                {usage?.map((u) => {
                  const pct = Math.min(100, (u.used / u.limit) * 100);
                  return (
                    <div key={u.label}>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-[13.5px] font-medium text-ink">{u.label}</span>
                        <span className="mono text-[12.5px] text-ink-soft">
                          {u.used} <span className="text-ink-faint">/ {u.limit}</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface3">
                        <div
                          className={cn("h-full rounded-full", pct > 85 ? "bg-warn" : "bg-accent")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
