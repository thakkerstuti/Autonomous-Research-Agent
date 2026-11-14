"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, CheckCircle2, AlertCircle, Loader2, Sun, Moon, GitBranch, ShieldCheck, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { useUiStore } from "@/lib/store";
import { BrandMark } from "@/components/ui/brand-mark";
import { toggleThemeWithReveal } from "@/lib/theme-transition";

interface AuthViewProps {
  mode: "login" | "signup";
}

const ROLES = [
  "Academic Researcher",
  "PhD Candidate / Student",
  "Data Scientist / ML Engineer",
  "Biotech & Medical R&D",
  "Enterprise Analyst",
  "Independent Researcher",
];

const PROVIDERS = ["Google", "GitHub", "ORCID"] as const;

function ProviderIcon({ provider }: { provider: (typeof PROVIDERS)[number] }) {
  if (provider === "Google") {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
      </svg>
    );
  }
  if (provider === "GitHub") {
    return (
      <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#A6CE39" />
      <path fill="#fff" d="M8.2 17.4H6.8V9.6h1.4v7.8zM10.3 9.6h3.4c3 0 4.5 2.1 4.5 3.9 0 2-1.6 3.9-4.5 3.9h-3.4V9.6zm1.4 6.6h1.9c2.6 0 3.2-1.9 3.2-2.7 0-1.6-1-2.7-3.2-2.7h-1.9v5.4zM7.5 6.4a.9.9 0 110 1.8.9.9 0 010-1.8z" />
    </svg>
  );
}

export function AuthView({ mode: initialMode }: AuthViewProps) {
  const router = useRouter();
  const { login, theme, toggleTheme } = useUiStore();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);

  // Form state
  const [email, setEmail] = useState("alex.morgan@stanford.edu");
  const [password, setPassword] = useState("demo-password");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [showPassword, setShowPassword] = useState(false);

  // Status & feedback
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Forgot password dialog
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  const handleInstantDemoLogin = () => {
    setDemoLoading(true);
    setErrorMessage(null);
    login({
      name: "Dr. Alex Morgan",
      email: "alex.morgan@stanford.edu",
      role: "Lead Researcher",
      institution: "Stanford AI Lab",
    });
    setSuccessMessage("Welcome back. Opening your workspace…");
    setTimeout(() => router.push("/dashboard"), 400);
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!email || !password) {
      setErrorMessage("Enter both your email and password.");
      return;
    }
    setLoading(true);
    login({
      name: email.split("@")[0].replace(".", " ") || "Researcher",
      email,
      role: "Academic Researcher",
      institution: "Research Workspace",
    });
    setSuccessMessage("Signed in. Redirecting…");
    setTimeout(() => router.push("/dashboard"), 400);
  };

  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!fullName || !email || !password) {
      setErrorMessage("Fill in your name, email and password to continue.");
      return;
    }
    setLoading(true);
    login({ name: fullName, email, role, institution: "Academic Workspace" });
    setSuccessMessage("Account created. Opening your workspace…");
    setTimeout(() => router.push("/dashboard"), 400);
  };

  const handleSocialAuth = (provider: string) => {
    setSocialLoading(provider);
    setErrorMessage(null);
    login({
      name: provider === "ORCID" ? "Dr. Samira Khan (ORCID)" : `${provider} Researcher`,
      email: `user.${provider.toLowerCase()}@cognexa.ai`,
      role: "Academic Researcher",
      institution: "Research Institution",
    });
    setSuccessMessage(`Signed in with ${provider}.`);
    setTimeout(() => router.push("/dashboard"), 400);
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotSubmitting(true);
    setTimeout(() => {
      setForgotSubmitting(false);
      setForgotSuccess(true);
    }, 600);
  };

  const switchMode = (m: "login" | "signup") => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setMode(m);
  };

  const busy = loading || demoLoading || socialLoading !== null;

  const inputCls = "h-11 text-[14px]";
  const labelCls = "mb-1.5 block text-[13px] font-medium text-ink-soft";

  return (
    <div className="auth-theme auth-bg relative isolate grid min-h-[100dvh] w-full text-ink lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:p-3">
      {/* Brand panel — always dark, still */}
      <aside className="auth-forest relative hidden overflow-hidden rounded-[26px] lg:flex lg:flex-col">
        <div className="relative z-10 flex flex-1 flex-col px-12 pb-0 pt-10 xl:px-16">
          <Link href="/" className="flex w-fit items-center gap-2.5 text-[#EFEDE6]" aria-label="CogNexa home">
            <BrandMark size={22} />
            <span className="font-display text-[17px] font-semibold tracking-[-0.03em]">CogNexa</span>
          </Link>

          <div className="mt-16 max-w-[520px] xl:mt-20">
            <h2 className="font-display text-[46px] font-semibold leading-[1.04] tracking-[-0.045em] text-[#EFEDE6] xl:text-[54px]">
              Research you can check, line by line.
            </h2>
            <ul className="mt-9 grid gap-4">
              {[
                { icon: GitBranch, text: "Questions become testable hypotheses" },
                { icon: ShieldCheck, text: "Every quote is checked against its source" },
                { icon: FileText, text: "Answers arrive as cited, self-critiqued reports" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3.5 text-[15.5px] text-[#C3CBBC]">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#EFEDE6]/10 bg-[#EFEDE6]/[0.06] text-[#D9A853]">
                    <Icon size={15} strokeWidth={1.9} />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* What CogNexa hands back: a report's verdicts, and one verified source behind them */}
          <div className="relative mt-auto pb-12 pt-12" aria-hidden>
            <div className="relative max-w-[420px]">
              <div className="rounded-[18px] bg-[#F4F1E8] p-6 text-[#1B2B1F] shadow-[0_24px_60px_-24px_rgb(0_0_0/0.55)]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[12px] font-medium text-[#55665A]">
                    <BrandMark size={14} /> Research report
                  </span>
                  <span className="rounded-full bg-[#1B2B1F]/[0.07] px-2.5 py-1 text-[11px] font-medium text-[#55665A]">6 sources · 3 verified</span>
                </div>
                <p className="mt-4 font-serif text-[19px] leading-snug">Does spaced repetition beat rereading?</p>
                <ul className="mt-5 grid gap-3">
                  {[
                    { label: "Supported", color: "#3E7A4E", text: "Spacing improves long-term recall", w: "82%" },
                    { label: "Supported", color: "#3E7A4E", text: "Testing adds benefit beyond spacing", w: "68%" },
                    { label: "Refuted", color: "#B4553F", text: "Learners judge what works best", w: "44%" },
                  ].map((v) => (
                    <li key={v.text} className="grid grid-cols-[78px_1fr] items-center gap-3">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: v.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v.color }} />
                        {v.label}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] text-[#2C3D31]">{v.text}</span>
                        <span className="mt-1.5 block h-1 rounded-full bg-[#1B2B1F]/[0.08]">
                          <span className="block h-full rounded-full" style={{ width: v.w, backgroundColor: v.color, opacity: 0.75 }} />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="absolute -right-[236px] top-[72px] hidden w-[264px] rounded-[16px] xl:block border border-[#EFEDE6]/12 bg-[#0F1A13] p-4 shadow-[0_24px_50px_-18px_rgb(0_0_0/0.7)]">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#9FAA99]">pubmed.ncbi.nlm.nih.gov</span>
                  <span className="flex items-center gap-1 font-medium text-[#8FD3A8]">
                    <ShieldCheck size={12} /> Verified
                  </span>
                </div>
                <p className="mt-2.5 font-serif text-[14.5px] italic leading-snug text-[#EFEDE6]">
                  “Spaced study produced better recall than massed study.”
                </p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[#9FAA99]">
                  <span>Supports hypothesis 1</span>
                  <span className="font-mono text-[#D9A853]">92%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Form */}
      <section className="flex min-h-[100dvh] flex-col px-5 sm:px-10 lg:min-h-0">
        <header className="flex h-16 flex-shrink-0 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-ink lg:invisible" aria-label="CogNexa home">
            <BrandMark size={20} />
            <span className="font-display text-[16px] font-semibold tracking-[-0.03em]">CogNexa</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/" className="rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink-soft transition-colors hover:text-ink">
              Back to home
            </Link>
            <button
              onClick={(e) => toggleThemeWithReveal(e, toggleTheme)}
              aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              className="pressable flex h-9 w-9 items-center justify-center rounded-xl text-ink-faint hover:bg-surface2 hover:text-ink"
            >
              {theme === "light" ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
            </button>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <div className="animate-view-in">
          <div key={mode}>
            <h1 className="font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-2 text-[14.5px] text-ink-soft">
              {mode === "login" ? "Sign in to your research workspace." : "Set up a workspace for your research."}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-2">
            {PROVIDERS.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleSocialAuth(provider)}
                disabled={busy}
                aria-label={`Continue with ${provider}`}
                className="pressable flex h-10 items-center justify-center gap-2 rounded-[11px] border border-line bg-surface text-[13px] font-medium text-ink-soft hover:border-line-hover hover:text-ink disabled:opacity-50"
              >
                {socialLoading === provider ? <Loader2 size={14} className="animate-spin" /> : <ProviderIcon provider={provider} />}
                <span className="hidden sm:inline">{provider}</span>
              </button>
            ))}
          </div>

          <div className="my-6 flex items-center gap-3 text-[12px] text-ink-faint">
            <span className="h-px flex-1 bg-line" />
            or with email
            <span className="h-px flex-1 bg-line" />
          </div>

          {errorMessage && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl bg-bad/10 px-3.5 py-3 text-[13px] text-bad">
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          {successMessage && (
            <div role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-ok/10 px-3.5 py-3 text-[13px] text-ok">
              <CheckCircle2 size={15} className="flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={mode === "login" ? handleLoginSubmit : handleSignUpSubmit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <div>
                <label htmlFor="auth-name" className={labelCls}>Full name</label>
                <Input id="auth-name" type="text" placeholder="Eleanor Vance" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} required />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className={labelCls}>Email</label>
              <Input id="auth-email" type="email" placeholder="you@university.edu" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} required />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="auth-password" className="text-[13px] font-medium text-ink-soft">Password</label>
                {mode === "login" && (
                  <Dialog>
                    <DialogTrigger type="button" className="text-[12.5px] font-medium text-ink-faint transition-colors hover:text-ink">
                      Forgot password?
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[400px]">
                      <DialogTitle>Reset your password</DialogTitle>
                      <DialogDescription className="mt-1.5 text-[13.5px] text-ink-soft">
                        Enter your email and we will send you a secure sign-in link.
                      </DialogDescription>
                      {forgotSuccess ? (
                        <div className="mt-5 flex items-center gap-2 rounded-xl bg-ok/10 p-3 text-[13px] text-ok">
                          <CheckCircle2 size={15} />
                          <span>Link sent. Check your inbox.</span>
                        </div>
                      ) : (
                        <form onSubmit={handleForgotSubmit} className="mt-5 flex flex-col gap-3">
                          <Input type="email" placeholder="you@university.edu" aria-label="Email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} className={inputCls} required />
                          <button
                            type="submit"
                            disabled={forgotSubmitting}
                            className="pressable flex h-11 w-full items-center justify-center rounded-xl bg-primary text-[14px] font-medium text-on-primary disabled:opacity-50"
                          >
                            {forgotSubmitting ? <Loader2 size={15} className="animate-spin" /> : "Send reset link"}
                          </button>
                        </form>
                      )}
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <div className="relative">
                <Input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={mode === "login" ? "Your password" : "At least 8 characters"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pr-11`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {mode === "signup" && (
              <div>
                <label htmlFor="auth-role" className={labelCls}>Role or field</label>
                <select
                  id="auth-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-hover focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="pressable group mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-semibold text-on-primary shadow-[0_1px_2px_rgb(0_0_0/0.12),0_6px_16px_-6px_rgb(0_0_0/0.35)] hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {mode === "login" ? "Signing in…" : "Creating account…"}
                </>
              ) : (
                <>
                  {mode === "login" ? "Sign in" : "Create account"}
                  <ArrowRight size={15} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleInstantDemoLogin}
              disabled={busy}
              className="pressable flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink disabled:opacity-50"
            >
              {demoLoading ? <Loader2 size={14} className="animate-spin" /> : null}
              Continue with the demo account
            </button>
          </form>

          <p className="mt-8 text-center text-[13.5px] text-ink-soft">
            {mode === "login" ? "New to CogNexa? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
              className="font-medium text-ink underline decoration-line-hover underline-offset-4 transition-colors hover:decoration-ink"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
          </div>
        </div>
      </section>
    </div>
  );
}
