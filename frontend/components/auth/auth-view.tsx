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
  CheckCircle2,
  AlertCircle,
  Sparkles,
  GraduationCap,
  ShieldCheck,
  Zap,
  Globe,
  Loader2,
  Github,
  BookOpen,
  Check,
  X,
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
  "Other / Independent Study",
];

export function AuthView({ mode }: AuthViewProps) {
  const router = useRouter();
  const { login } = useUiStore();

  // Form States
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [rememberMe, setRememberMe] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Forgot Password Modal state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  // Password strength logic for Sign Up
  const getPasswordStrength = (pwd: string) => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    return score;
  };

  const pwdStrength = getPasswordStrength(password);
  const strengthLabels = ["Weak", "Fair", "Good", "Strong"];
  const strengthColors = ["bg-bad", "bg-warn", "bg-grad2", "bg-ok"];

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage("Please fill in both email and password.");
      return;
    }

    if (!email.includes("@")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    // Simulate authenticating
    setTimeout(() => {
      login({
        name: fullName || email.split("@")[0].replace(".", " ") || "Researcher",
        email: email,
        role: role,
      });
      setSuccessMessage("Signed in successfully! Redirecting to workspace...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    }, 900);
  };

  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName || !email || !password || !confirmPassword) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }

    if (!email.includes("@")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (!agreeTerms) {
      setErrorMessage("Please accept the Terms of Service & Privacy Policy.");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      login({
        name: fullName,
        email: email,
        role: role,
        institution: "Academic Workspace",
      });
      setSuccessMessage("Account created successfully! Welcome to CogNexa.");
      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    }, 1100);
  };

  const handleDemoAccess = () => {
    setLoading(true);
    setErrorMessage(null);
    setTimeout(() => {
      login({
        name: "Dr. Alex Morgan",
        email: "alex.morgan@cognexa.ai",
        role: "Lead Researcher",
        institution: "Stanford AI Lab",
      });
      setSuccessMessage("Demo access granted! Redirecting to workspace...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    }, 600);
  };

  const handleSocialAuth = (provider: string) => {
    setSocialLoading(provider);
    setErrorMessage(null);
    setTimeout(() => {
      login({
        name: provider === "ORCID" ? "Dr. Samira Khan (ORCID)" : `${provider} User`,
        email: `user.${provider.toLowerCase()}@cognexa.ai`,
        role: "Academic Researcher",
      });
      setSuccessMessage(`Authenticated via ${provider}! Opening workspace...`);
      setTimeout(() => {
        router.push("/dashboard");
      }, 900);
    }, 1000);
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail || !forgotEmail.includes("@")) return;
    setForgotSubmitting(true);
    setTimeout(() => {
      setForgotSubmitting(false);
      setForgotSuccess(true);
    }, 1000);
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-bg p-4 sm:p-6 lg:p-8 overflow-hidden font-sans text-ink">
      {/* Dynamic Ambient Background Elements */}
      <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-grad1/10 blur-[130px] pointer-events-none" />
      <div className="absolute top-1/2 -right-40 h-[500px] w-[500px] rounded-full bg-grad2/10 blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-40 left-1/3 h-[450px] w-[450px] rounded-full bg-grad3/10 blur-[120px] pointer-events-none" />

      {/* Main Glass Card Container */}
      <div className="relative z-10 w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface/80 backdrop-blur-xl shadow-2xl grid grid-cols-1 lg:grid-cols-12">
        {/* Left Side: Brand & Feature Showcase */}
        <div className="lg:col-span-5 relative flex flex-col justify-between p-6 sm:p-8 lg:p-10 border-b lg:border-b-0 lg:border-r border-line bg-gradient-to-br from-surface2/80 via-surface/90 to-surface">
          <div className="absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

          {/* Top Logo & Tagline */}
          <div className="relative z-10">
            <Link href="/dashboard" className="inline-flex items-center gap-2.5 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface2 text-gradient font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                ✦
              </div>
              <span className="font-serif text-2xl font-bold tracking-tight">
                Cog<span className="text-gradient">Nexa</span>
              </span>
            </Link>

            <div className="mt-8 flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-ink-soft w-fit">
              <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
              <span>Dual-Mode AI Research Platform</span>
            </div>

            <h2 className="mt-4 font-serif text-2xl sm:text-3xl font-semibold leading-tight text-ink">
              Investigate open questions & deconstruct papers with <span className="text-gradient">verifiable AI.</span>
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Continuous, self-critiquing agent reasoning with live source confidence scoring and deep PDF evidence retrieval.
            </p>
          </div>

          {/* Feature Highlights List */}
          <div className="relative z-10 my-8 flex flex-col gap-3.5">
            <div className="flex items-start gap-3 rounded-xl border border-line/60 bg-surface2/40 p-3 text-xs">
              <div className="mt-0.5 rounded-lg border border-line bg-surface2 p-1.5 text-grad1">
                <Zap size={15} />
              </div>
              <div>
                <span className="font-semibold text-ink block">Traceable Agent Execution</span>
                <span className="text-ink-soft">Step-by-step SSE stream showing exact citations and confidence graph.</span>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-line/60 bg-surface2/40 p-3 text-xs">
              <div className="mt-0.5 rounded-lg border border-line bg-surface2 p-1.5 text-grad2">
                <BookOpen size={15} />
              </div>
              <div>
                <span className="font-semibold text-ink block">Paper Study & PDF Viewer</span>
                <span className="text-ink-soft">In-depth multi-page synthesis, query highlights, and automatic summary notes.</span>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-line/60 bg-surface2/40 p-3 text-xs">
              <div className="mt-0.5 rounded-lg border border-line bg-surface2 p-1.5 text-grad3">
                <GraduationCap size={15} />
              </div>
              <div>
                <span className="font-semibold text-ink block">Academic Identity & ORCID Ready</span>
                <span className="text-ink-soft">Built specifically for researchers, universities, and technical R&D teams.</span>
              </div>
            </div>
          </div>

          {/* Bottom Live Metric */}
          <div className="relative z-10 pt-4 border-t border-line/60 flex items-center justify-between text-xs text-ink-faint">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-ok" />
              <span>99.4% Factual Groundedness</span>
            </div>
            <span>1.2M+ Papers Indexed</span>
          </div>
        </div>

        {/* Right Side: Form & Controls */}
        <div className="lg:col-span-7 p-6 sm:p-8 lg:p-10 flex flex-col justify-center bg-surface/40">
          {/* Header & Mode Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight font-serif text-ink">
                {mode === "login" ? "Sign in to CogNexa" : "Create your account"}
              </h1>
              <p className="text-xs sm:text-sm text-ink-soft mt-1">
                {mode === "login"
                  ? "Welcome back! Enter your credentials to access your workspace."
                  : "Join thousands of researchers using CogNexa today."}
              </p>
            </div>

            {/* Segmented Mode Switcher */}
            <div className="flex rounded-xl border border-line bg-surface2 p-1 text-xs font-medium self-start sm:self-center">
              <Link
                href="/login"
                className={`rounded-lg px-3.5 py-1.5 transition-all ${
                  mode === "login"
                    ? "bg-surface text-ink font-semibold shadow-sm border border-line"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className={`rounded-lg px-3.5 py-1.5 transition-all ${
                  mode === "signup"
                    ? "bg-surface text-ink font-semibold shadow-sm border border-line"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                Sign Up
              </Link>
            </div>
          </div>

          {/* Quick Demo Access Bar */}
          <div className="mb-6 rounded-xl border border-grad1/30 bg-gradient-to-r from-grad1/10 via-grad2/10 to-transparent p-3 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <Sparkles size={16} className="text-grad1 flex-shrink-0" />
              <div className="truncate">
                <span className="font-semibold text-ink block truncate">Quick Demo Sandbox Mode</span>
                <span className="text-ink-soft truncate">Instant sign in as Dr. Alex Morgan (Stanford AI Lab)</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDemoAccess}
              disabled={loading}
              className="border-grad1/40 hover:bg-grad1/20 text-ink flex-shrink-0 text-xs"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : "Try Demo"}
            </Button>
          </div>

          {/* Error & Success Feedback Banners */}
          {errorMessage && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs text-bad animate-view-in">
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-ok/40 bg-ok/10 p-3 text-xs text-ok animate-view-in">
              <CheckCircle2 size={15} className="flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Login Form */}
          {mode === "login" ? (
            <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-soft">Work / Academic Email</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <Input
                    type="email"
                    placeholder="alex.morgan@stanford.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-ink-soft">Password</label>

                  {/* Forgot Password Dialog */}
                  <Dialog>
                    <DialogTrigger type="button" className="text-xs text-grad2 hover:underline">
                      Forgot password?
                    </DialogTrigger>
                    <DialogContent>
                      <DialogTitle className="font-serif text-lg font-semibold">Reset Your Password</DialogTitle>
                      <DialogDescription className="mt-1 text-xs text-ink-soft">
                        Enter your registered email address below and we will send you instructions to reset your account password.
                      </DialogDescription>

                      {forgotSuccess ? (
                        <div className="mt-4 flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/10 p-3 text-xs text-ok">
                          <CheckCircle2 size={16} />
                          <span>Password reset instructions sent! Check your inbox shortly.</span>
                        </div>
                      ) : (
                        <form onSubmit={handleForgotSubmit} className="mt-4 flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-ink-soft">Account Email</label>
                            <Input
                              type="email"
                              placeholder="user@institution.edu"
                              value={forgotEmail}
                              onChange={(e) => setForgotEmail(e.target.value)}
                              required
                            />
                          </div>
                          <Button type="submit" disabled={forgotSubmitting} className="mt-2 w-full">
                            {forgotSubmitting ? <Loader2 size={14} className="animate-spin" /> : "Send Reset Link"}
                          </Button>
                        </form>
                      )}
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Remember Me Checkbox */}
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-line bg-surface2 text-grad1 focus:ring-0 accent-[#b879ff]"
                />
                <label htmlFor="remember" className="text-xs text-ink-soft cursor-pointer select-none">
                  Keep me signed in for 30 days
                </label>
              </div>

              {/* Submit Button */}
              <Button type="submit" disabled={loading} className="mt-2 w-full h-11 text-sm font-semibold gap-2">
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Signing in...
                  </>
                ) : (
                  <>
                    Sign In <ArrowRight size={15} />
                  </>
                )}
              </Button>
            </form>
          ) : (
            /* Sign Up Form */
            <form onSubmit={handleSignUpSubmit} className="flex flex-col gap-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-ink-soft">Full Name</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                    <Input
                      type="text"
                      placeholder="Dr. Eleanor Vance"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-ink-soft">Academic / Work Email</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                    <Input
                      type="email"
                      placeholder="e.vance@mit.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Role Selection Dropdown */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-soft">Primary Role / Field</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-xs text-ink outline-none focus:border-grad2"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r} className="bg-surface text-ink">
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* Password Fields with Strength Meter */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-ink-soft">Password</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 pr-9"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-ink-soft">Confirm Password</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-9 pr-9"
                      required
                    />
                    {confirmPassword && password === confirmPassword && (
                      <Check size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ok" />
                    )}
                  </div>
                </div>
              </div>

              {/* Live Password Strength Meter */}
              {password && (
                <div className="flex flex-col gap-1.5 p-2 rounded-lg border border-line/60 bg-surface2/30 animate-view-in">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-ink-soft">Password strength:</span>
                    <span className="font-semibold text-ink">{strengthLabels[Math.max(0, pwdStrength - 1)] || "Weak"}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 h-1.5 w-full">
                    {[1, 2, 3, 4].map((step) => (
                      <div
                        key={step}
                        className={`rounded-full transition-all duration-300 ${
                          step <= pwdStrength ? strengthColors[pwdStrength - 1] : "bg-line"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Terms Acceptance */}
              <div className="flex items-start gap-2 mt-1">
                <input
                  type="checkbox"
                  id="terms"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 rounded border-line bg-surface2 text-grad1 focus:ring-0 accent-[#b879ff]"
                  required
                />
                <label htmlFor="terms" className="text-xs text-ink-soft leading-tight cursor-pointer">
                  I agree to CogNexa&apos;s{" "}
                  <a href="#" className="text-grad2 hover:underline">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" className="text-grad2 hover:underline">
                    Privacy Policy
                  </a>
                  .
                </label>
              </div>

              {/* Submit Button */}
              <Button type="submit" disabled={loading} className="mt-2 w-full h-11 text-sm font-semibold gap-2">
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Creating Account...
                  </>
                ) : (
                  <>
                    Create Free Account <ArrowRight size={15} />
                  </>
                )}
              </Button>
            </form>
          )}

          {/* Social Authentication Divider */}
          <div className="relative my-6 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line" />
            </div>
            <span className="relative z-10 bg-surface px-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Or continue with identity provider
            </span>
          </div>

          {/* Social Login Options */}
          <div className="grid grid-cols-3 gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSocialAuth("Google")}
              disabled={socialLoading !== null}
              className="text-xs gap-1.5 h-9"
            >
              {socialLoading === "Google" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Globe size={14} className="text-grad2" />
              )}
              Google
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSocialAuth("GitHub")}
              disabled={socialLoading !== null}
              className="text-xs gap-1.5 h-9"
            >
              {socialLoading === "GitHub" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Github size={14} className="text-ink" />
              )}
              GitHub
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSocialAuth("ORCID")}
              disabled={socialLoading !== null}
              className="text-xs gap-1.5 h-9 border-ok/40 hover:bg-ok/10"
            >
              {socialLoading === "ORCID" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <GraduationCap size={14} className="text-ok" />
              )}
              ORCID
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
