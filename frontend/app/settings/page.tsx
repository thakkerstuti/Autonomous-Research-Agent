"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUiStore } from "@/lib/store";
import { useUsageQuery } from "@/lib/queries";
import { ModelPreference } from "@/lib/types";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LogOut, CheckCircle2 } from "lucide-react";

const models: { value: ModelPreference; title: string; body: string }[] = [
  { value: "fast", title: "Fast", body: "Quicker answers, lighter checking. Good for quick lookups." },
  { value: "balanced", title: "Balanced", body: "Default. Solid depth with reasonable wait times." },
  { value: "deep", title: "Deep", body: "Most thorough evidence gathering and self-critique. Slower." },
];

export default function SettingsPage() {
  const router = useRouter();
  const { modelPreference, setModelPreference, user, login, logout } = useUiStore();
  const { data: usage, isLoading } = useUsageQuery();

  const [name, setName] = useState(user?.name || "Dr. Alex Morgan");
  const [email, setEmail] = useState(user?.email || "alex.morgan@cognexa.ai");
  const [role, setRole] = useState(user?.role || "Lead Researcher");
  const [savedMessage, setSavedMessage] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    login({ name, email, role });
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2500);
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <div className="animate-view-in h-full overflow-y-auto px-10 py-10">
      <h1 className="font-serif text-2xl font-semibold">Settings</h1>
      <p className="mb-6 mt-1 max-w-lg text-ink-soft">Account, model preferences, and usage.</p>

      <Tabs defaultValue="account" className="max-w-2xl">
        <TabsList className="mb-6">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="models">Model preferences</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <Card className="flex flex-col gap-4">
            {savedMessage && (
              <div className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 p-2.5 text-xs text-ok">
                <CheckCircle2 size={14} /> Profile details saved!
              </div>
            )}
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm text-ink-soft">
                Full Name
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-ink-soft">
                Email Address
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-ink-soft">
                Role / Field
                <Input value={role} onChange={(e) => setRole(e.target.value)} />
              </label>
              <div className="flex items-center justify-between pt-2 border-t border-line/60">
                <Button size="sm" type="submit">
                  Save changes
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={handleLogout}
                  className="border-bad/40 text-bad hover:bg-bad/10"
                >
                  <LogOut size={14} /> Sign Out
                </Button>
              </div>
            </form>
          </Card>
        </TabsContent>


        <TabsContent value="models">
          <div className="flex flex-col gap-3">
            {models.map((m) => (
              <Card
                key={m.value}
                role="radio"
                aria-checked={modelPreference === m.value}
                tabIndex={0}
                onClick={() => setModelPreference(m.value)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setModelPreference(m.value)}
                className={`cursor-pointer transition-colors hover:border-grad2 ${
                  modelPreference === m.value ? "border-grad2" : ""
                }`}
              >
                <CardTitle>{m.title}</CardTitle>
                <CardContent className="mt-1">{m.body}</CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="usage">
          <Card className="flex flex-col gap-5">
            {isLoading && <p className="text-sm text-ink-faint">Loading usage…</p>}
            {usage?.map((u) => (
              <div key={u.label}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-ink-soft">{u.label}</span>
                  <span className="text-ink-faint">
                    {u.used} / {u.limit}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-grad1 to-grad2"
                    style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
