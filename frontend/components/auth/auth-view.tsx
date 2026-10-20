"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sun,
  Moon,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { useUiStore } from "@/lib/store";

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

export function AuthView({ mode: initialMode }: AuthViewProps) {
  const router = useRouter();
  const { login, theme, toggleTheme } = useUiStore();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);

  // Form states
  const [email, setEmail] = useState("alex.morgan@stanford.edu");
  const [password, setPassword] = useState("••••••••••••");
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
    setSuccessMessage("Welcome back, Dr. Morgan! Opening workspace...");
    setTimeout(() => {
      router.push("/dashboard");
    }, 400);
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    setLoading(true);
    login({
      name: email.split("@")[0].replace(".", " ") || "Researcher",
      email: email,
      role: "Academic Researcher",
      institution: "Research Workspace",
    });
    setSuccessMessage("Signed in successfully! Redirecting...");
    setTimeout(() => {
      router.push("/dashboard");
    }, 400);
  };

  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName || !email || !password) {
      setErrorMessage("Please fill in your name, email, and password.");
      return;
    }

    setLoading(true);
    login({
      name: fullName,
      email: email,
      role: role,
      institution: "Academic Workspace",
    });
    setSuccessMessage("Account created! Opening your research canvas...");
    setTimeout(() => {
      router.push("/dashboard");
    }, 400);
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
    setSuccessMessage(`Authenticated with ${provider}!`);
    setTimeout(() => {
      router.push("/dashboard");
    }, 400);
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

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center bg-bg px-4 py-8 overflow-hidden text-ink">
      {/* Background ambient lighting */}
      <div className="aurora aurora-a opacity-30" />
      <div className="aurora aurora-b opacity-30" />

      {/* Floating Theme Toggle in top-right corner */}
      <div className="absolute top-5 right-5 z-20">
        <button
          onClick={toggleTheme}
          title={theme === "light" ? "Switch to Dark mode" : "Switch to Light mode"}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface/80 text-ink-soft shadow-sm backdrop-blur-md transition-all hover:bg-surface2 hover:text-ink"
        >
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} className="text-warn" />}
        </button>
      </div>

      {/* Centered Auth Card */}
      <div className="relative z-10 w-full max-w-[420px] rounded-3xl border border-line bg-surface/95 p-7 sm:p-9 shadow-panel backdrop-blur-2xl transition-all">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center">
          <Link
            href="/dashboard"
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose to-lavender shadow-sm transition-transform hover:scale-105"
            title="CogNexa"
          >
            <Sparkles size={20} className="text-white" />
          </Link>

          <h1 className="mt-4 font-serif text-2xl sm:text-[26px] font-semibold tracking-tight text-ink">
            Cog<span className="text-rose">Nexa</span>
          </h1>
          <p className="mt-1 text-xs sm:text-[13px] text-ink-soft">
            {mode === "login"
              ? "Welcome back to your research workspace"
              : "Create your autonomous research workspace"}
          </p>
        </div>

        {/* 1-Click Instant Demo Button */}
        <div className="mt-6">
          <button
            type="button"
            onClick={handleInstantDemoLogin}
            disabled={demoLoading || loading}
            className="group relative flex w-full items-center justify-center gap-2 rounded-2xl border border-rose/30 bg-blush/40 py-2.5 px-4 text-xs font-semibold text-rose transition-all hover:bg-blush hover:shadow-sm active:scale-[0.99] disabled:opacity-60"
          >
            {demoLoading ? (
              <Loader2 size={14} className="animate-spin text-rose" />
            ) : (
              <Zap size={14} className="fill-rose text-rose transition-transform group-hover:scale-110" />
            )}
            <span>1-Click Demo Login · Dr. Alex Morgan</span>
          </button>
        </div>

        {/* Divider */}
        <div className="relative my-5 flex items-center justify-center">
          <div className="w-full border-t border-line" />
          <span className="absolute bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            or sign in with
          </span>
        </div>

        {/* Quick Social Buttons */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleSocialAuth("Google")}
            disabled={socialLoading !== null}
            className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface2/60 text-xs font-medium text-ink-soft transition-all hover:bg-surface2 hover:text-ink active:scale-95 disabled:opacity-60"
          >
            {socialLoading === "Google" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
            Google
          </button>

          <button
            type="button"
            onClick={() => handleSocialAuth("GitHub")}
            disabled={socialLoading !== null}
            className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface2/60 text-xs font-medium text-ink-soft transition-all hover:bg-surface2 hover:text-ink active:scale-95 disabled:opacity-60"
          >
            {socialLoading === "GitHub" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            )}
            GitHub
          </button>

          <button
            type="button"
            onClick={() => handleSocialAuth("ORCID")}
            disabled={socialLoading !== null}
            className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface2/60 text-xs font-medium text-ink-soft transition-all hover:bg-surface2 hover:text-ink active:scale-95 disabled:opacity-60"
          >
            {socialLoading === "ORCID" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <span className="font-bold text-ok text-[11px]">iD</span>
            )}
            ORCID
          </button>
        </div>

        {/* Feedback Alerts */}
        {errorMessage && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-bad/10 px-3 py-2.5 text-xs text-bad">
            <AlertCircle size={14} className="flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-ok/10 px-3 py-2.5 text-xs text-ok">
            <CheckCircle2 size={14} className="flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Email/Password Form */}
        {mode === "login" ? (
          <form onSubmit={handleLoginSubmit} className="mt-5 flex flex-col gap-3.5">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Work / Academic Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input
                  type="email"
                  placeholder="alex.morgan@stanford.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 pl-9 pr-3 text-xs sm:text-[13px] bg-surface border-line rounded-xl"
                  required
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-ink-soft">Password</label>
                <Dialog>
                  <DialogTrigger type="button" className="text-[11px] text-rose hover:underline">
                    Forgot password?
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[380px] p-6 rounded-2xl">
                    <DialogTitle className="font-serif text-lg font-semibold text-ink">Reset password</DialogTitle>
                    <DialogDescription className="mt-1 text-xs text-ink-soft">
                      Enter your academic email address and we will send you a secure login link.
                    </DialogDescription>
                    {forgotSuccess ? (
                      <div className="mt-4 flex items-center gap-2 rounded-xl bg-ok/10 p-3 text-xs text-ok">
                        <CheckCircle2 size={14} />
                        <span>Reset link sent! Check your inbox shortly.</span>
                      </div>
                    ) : (
                      <form onSubmit={handleForgotSubmit} className="mt-4 flex flex-col gap-3">
                        <Input
                          type="email"
                          placeholder="user@stanford.edu"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          className="h-10 text-xs"
                          required
                        />
                        <button
                          type="submit"
                          disabled={forgotSubmitting}
                          className="mt-1 flex h-10 w-full items-center justify-center rounded-xl bg-rose text-xs font-medium text-white shadow-sm hover:bg-rose/90 disabled:opacity-60"
                        >
                          {forgotSubmitting ? <Loader2 size={14} className="animate-spin" /> : "Send Reset Link"}
                        </button>
                      </form>
                    )}
                  </DialogContent>
                </Dialog>
              </div>

              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 pl-9 pr-9 text-xs sm:text-[13px] bg-surface border-line rounded-xl"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Primary Submit Button — Solid Rose, High Contrast, Guaranteed Legibility */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose px-4 text-xs sm:text-[13px] font-semibold text-white shadow-panel transition-all hover:bg-rose/90 hover:shadow-panel-hover active:scale-[0.99] disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>
        ) : (
          /* Sign Up Form */
          <form onSubmit={handleSignUpSubmit} className="mt-5 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Full Name</label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input
                  type="text"
                  placeholder="Dr. Eleanor Vance"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-10 pl-9 text-xs bg-surface border-line rounded-xl"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Academic / Work Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input
                  type="email"
                  placeholder="e.vance@mit.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 pl-9 text-xs bg-surface border-line rounded-xl"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 pl-9 pr-9 text-xs bg-surface border-line rounded-xl"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Role / Field</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-rose"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose px-4 text-xs sm:text-[13px] font-semibold text-white shadow-panel transition-all hover:bg-rose/90 hover:shadow-panel-hover active:scale-[0.99] disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Creating account...</span>
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>
        )}

        {/* Switch Mode Footer */}
        <div className="mt-6 text-center text-xs text-ink-soft">
          {mode === "login" ? (
            <p>
              New to CogNexa?{" "}
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setMode("signup");
                }}
                className="font-semibold text-rose hover:underline"
              >
                Create an account
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setMode("login");
                }}
                className="font-semibold text-rose hover:underline"
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>

      {/* Subtle Bottom Trust note */}
      <div className="relative z-10 mt-6 text-center text-[11px] text-ink-faint">
        Dual-mode autonomous research engine · Verifiable citations
      </div>
    </div>
  );
}
