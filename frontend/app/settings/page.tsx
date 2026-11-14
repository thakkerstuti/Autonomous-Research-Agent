"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUiStore } from "@/lib/store";
import { useUsageQuery } from "@/lib/queries";
import { ModelPreference } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LogOut, Check } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const { modelPreference, setModelPreference, user, login, logout } = useUiStore();
  const { data: usage, isLoading } = useUsageQuery();

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [role, setRole] = useState(user?.role || "");
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    login({ name, email, role });
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
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
            <form onSubmit={handleSave} className="rounded-2xl bg-surface shadow-sm">
              <div className="grid gap-5 p-6">
                <Field label="Full name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </Field>
                <Field label="Email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </Field>
                <Field label="Role or field">
                  <Input value={role} onChange={(e) => setRole(e.target.value)} />
                </Field>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
                <Button type="button" variant="danger" size="sm" onClick={handleLogout}>
                  <LogOut size={14} /> Sign out
                </Button>
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
                  <Button size="sm" type="submit">Save changes</Button>
                </div>
              </div>
            </form>
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
