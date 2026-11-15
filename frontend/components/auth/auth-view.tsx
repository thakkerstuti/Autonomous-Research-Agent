"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, CheckCircle2, AlertCircle, Loader2, Sun, Moon, GitBranch, ShieldCheck, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { useUiStore } from "@/lib/store";
import { continueWithGoogle, describeAuthError, requestPasswordReset, safeNext, signIn, signUp } from "@/lib/auth";
import { GoogleIcon } from "@/components/auth/google-icon";
import { BrandMark } from "@/components/ui/brand-mark";
import { toggleThemeWithReveal } from "@/lib/theme-transition";

interface AuthViewProps {
  mode: "login" | "signup";
}

export function AuthView({ mode: initialMode }: AuthViewProps) {
  const router = useRouter();
  const { theme, toggleTheme } = useUiStore();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Status & feedback
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [next, setNext] = useState("/dashboard");

  // Forgot password dialog
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotDone, setForgotDone] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // Where to go afterwards, and errors handed back from the Google redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNext(params.get("next")));
    const fromGoogle = describeAuthError(params.get("error"));
    if (fromGoogle) setErrorMessage(fromGoogle);
  }, []);

  const finish = (message: string) => {
    setSuccessMessage(message);
    router.replace(next);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!email || !password) {
      setErrorMessage("Enter both your email and password.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
      finish("Signed in. Opening your workspace…");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Couldn't sign in. Please try again.");
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!fullName.trim() || !email || !password) {
      setErrorMessage("Fill in your name, email and password to continue.");
      return;
    }
    if (password.length < 10) {
      setErrorMessage("Use at least 10 characters for your password.");
      return;
    }
    setLoading(true);
    try {
      await signUp(fullName, email, password);
      finish("Account created. Opening your workspace…");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Couldn't create the account. Please try again.");
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    setErrorMessage(null);
    setGoogleLoading(true);
    continueWithGoogle(next);
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotError(null);
    setForgotSubmitting(true);
    try {
      const res = await requestPasswordReset(forgotEmail);
      setForgotDone(res.detail);
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "Couldn't send the link. Please try again.");
    } finally {
      setForgotSubmitting(false);
    }
  };

  const switchMode = (m: "login" | "signup") => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setMode(m);
    window.history.replaceState(null, "", m === "login" ? "/login" + window.location.search : "/signup" + window.location.search);
  };

  const busy = loading || googleLoading;

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

          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy}
            className="pressable mt-8 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface text-[14px] font-medium text-ink hover:border-line-hover disabled:opacity-50"
          >
            {googleLoading ? <Loader2 size={15} className="animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </button>

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
                        Enter your account email and we’ll send a link to choose a new password.
                      </DialogDescription>
                      {forgotDone ? (
                        <div role="status" className="mt-5 flex items-start gap-2 rounded-xl bg-ok/10 p-3 text-[13px] text-ok">
                          <CheckCircle2 size={15} className="mt-px flex-shrink-0" />
                          <span>{forgotDone}</span>
                        </div>
                      ) : (
                        <form onSubmit={handleForgotSubmit} className="mt-5 flex flex-col gap-3">
                          {forgotError && (
                            <div role="alert" className="flex items-center gap-2 rounded-xl bg-bad/10 px-3 py-2.5 text-[13px] text-bad">
                              <AlertCircle size={15} className="flex-shrink-0" />
                              <span>{forgotError}</span>
                            </div>
                          )}
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
                  placeholder={mode === "login" ? "Your password" : "At least 10 characters"}
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
