"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/ui/brand-mark";
import { resetPassword } from "@/lib/auth";

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("token");
    // Effects can run twice in development; never lose a token already read
    setToken((current) => fromUrl || current || "");
    // Keep the single-use token out of the address bar and history
    if (fromUrl) window.history.replaceState(null, "", "/reset-password");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setLoading(true);
    try {
      const res = await resetPassword(token || "", password);
      setDone(res.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "h-11 text-[14px]";
  const labelCls = "mb-1.5 block text-[13px] font-medium text-ink-soft";
  const missingToken = token === "";

  return (
    <div className="auth-bg relative isolate flex min-h-[100dvh] flex-col px-5 text-ink sm:px-10">
      <header className="flex h-16 items-center">
        <Link href="/" className="flex items-center gap-2 text-ink" aria-label="CogNexa home">
          <BrandMark size={20} />
          <span className="font-display text-[16px] font-semibold tracking-[-0.015em]">CogNexa</span>
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center pb-16">
        <div className="animate-view-in rounded-[22px] bg-surface p-7 shadow-panel sm:p-8">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">Choose a new password</h1>
          <p className="mt-2 text-[14px] text-ink-soft">You&rsquo;ll be signed out everywhere, then you can sign in with the new password.</p>

          {done ? (
            <div className="mt-6">
              <div role="status" className="flex items-start gap-2 rounded-xl bg-ok/10 px-3.5 py-3 text-[13px] text-ok">
                <CheckCircle2 size={15} className="mt-px flex-shrink-0" />
                <span>{done}</span>
              </div>
              <Link
                href="/login"
                className="pressable mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-semibold text-on-primary hover:bg-primary/90"
              >
                Go to sign in <ArrowRight size={15} />
              </Link>
            </div>
          ) : missingToken ? (
            <div className="mt-6">
              <div role="alert" className="flex items-start gap-2 rounded-xl bg-bad/10 px-3.5 py-3 text-[13px] text-bad">
                <AlertCircle size={15} className="mt-px flex-shrink-0" />
                <span>This page needs the link from your reset email. Request a new one from the sign-in page.</span>
              </div>
              <Link href="/login" className="mt-5 inline-block text-[13.5px] font-medium text-ink underline decoration-line-hover underline-offset-4 hover:decoration-ink">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              {error && (
                <div role="alert" className="flex items-center gap-2 rounded-xl bg-bad/10 px-3.5 py-3 text-[13px] text-bad">
                  <AlertCircle size={15} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div>
                <label htmlFor="new-password" className={labelCls}>New password</label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={show ? "text" : "password"}
                    placeholder="At least 10 characters"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputCls} pr-11`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint transition-colors hover:text-ink"
                  >
                    {show ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm-password" className={labelCls}>Confirm new password</label>
                <Input
                  id="confirm-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inputCls}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || token === null}
                className="pressable mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                {loading ? "Saving…" : "Change password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
