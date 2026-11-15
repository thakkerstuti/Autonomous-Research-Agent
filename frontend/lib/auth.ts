/**
 * Client side of CogNexa authentication.
 *
 * - The refresh token lives in an HTTP-only cookie that JavaScript never
 *   sees. It is first-party: auth calls go to this site's own /backend/auth/*
 *   path, which Next.js rewrites to the API (see next.config.mjs).
 * - The access token is kept in memory only (never localStorage), attached
 *   as a bearer token to API calls, and renewed through the cookie.
 */
import { ApiError, errorFromResponse } from "./api-error";
import { queryClient } from "./query-client";
import { useUiStore } from "./store";
import type { User } from "./types";

export const AUTH_BASE = "/backend/auth";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  has_password: boolean;
  providers: string[];
  created_at: string | null;
}

interface SessionResponse {
  access_token: string;
  expires_in: number;
  user: AuthUser;
}

let accessToken: string | null = null;
let accessExpiresAt = 0;
let refreshing: Promise<User | null> | null = null;

export function toUser(u: AuthUser): User {
  return {
    id: u.id,
    name: u.name || u.email.split("@")[0],
    email: u.email,
    avatar: u.avatar_url || undefined,
    hasPassword: u.has_password,
    providers: u.providers,
  };
}

function applyUser(user: User | null) {
  const store = useUiStore.getState();
  const previous = store.user?.id ?? null;
  if (previous !== (user?.id ?? null)) {
    // A different person (or nobody): drop everything cached for the last one
    queryClient.clear();
    store.resetHistory("research", []);
    store.resetHistory("paper", []);
  }
  store.setAuthUser(user);
}

function acceptSession(session: SessionResponse): User {
  accessToken = session.access_token;
  accessExpiresAt = Date.now() + session.expires_in * 1000;
  const user = toUser(session.user);
  applyUser(user);
  return user;
}

function forgetSession() {
  accessToken = null;
  accessExpiresAt = 0;
  applyUser(null);
}

async function authRequest<T>(path: string, init: RequestInit = {}, withToken = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-CogNexa-Auth", "1");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (withToken) {
    const token = await getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${AUTH_BASE}${path}`, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Exchanges the refresh cookie for a new access token. One request at a time. */
export function refreshSession(): Promise<User | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        return acceptSession(await authRequest<SessionResponse>("/refresh", { method: "POST" }));
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          forgetSession();
          return null;
        }
        // Network trouble or server down: keep what we know, report anonymous
        // only if we never had a session.
        if (!accessToken) useUiStore.getState().setAuthStatus("anonymous");
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** A usable access token, renewing it shortly before it expires. */
export async function getAccessToken(): Promise<string | null> {
  if (accessToken && accessExpiresAt - Date.now() > 30_000) return accessToken;
  if (useUiStore.getState().authStatus === "anonymous" && !accessToken) return null;
  await refreshSession();
  return accessToken;
}

/** Called by the API client when the server rejects the current token. */
export async function recoverFromUnauthorized(): Promise<string | null> {
  accessToken = null;
  const user = await refreshSession();
  return user ? accessToken : null;
}

let bootstrapped = false;
export function bootstrapSession() {
  if (bootstrapped) return;
  bootstrapped = true;
  void refreshSession();
}

// ───────── actions ─────────

export async function signIn(email: string, password: string) {
  return acceptSession(await authRequest<SessionResponse>("/login", { method: "POST", body: JSON.stringify({ email, password }) }));
}

export async function signUp(name: string, email: string, password: string) {
  return acceptSession(
    await authRequest<SessionResponse>("/register", { method: "POST", body: JSON.stringify({ name, email, password }) })
  );
}

export async function signOut() {
  try {
    await authRequest<void>("/logout", { method: "POST" });
  } finally {
    forgetSession();
  }
}

export async function signOutEverywhere() {
  try {
    await authRequest<void>("/logout-all", { method: "POST" }, true);
  } finally {
    forgetSession();
  }
}

export async function requestPasswordReset(email: string) {
  return authRequest<{ detail: string }>("/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export async function resetPassword(token: string, password: string) {
  return authRequest<{ detail: string }>("/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
}

export async function updateProfile(name: string) {
  const u = await authRequest<AuthUser>("/me", { method: "PATCH", body: JSON.stringify({ name }) }, true);
  const user = toUser(u);
  applyUser(user);
  return user;
}

/** Full-page navigation: Google's consent screen can't run inside fetch. */
export function continueWithGoogle(next = "/dashboard") {
  window.location.assign(`${AUTH_BASE}/google/login?next=${encodeURIComponent(next)}`);
}

export async function connectGoogle() {
  const { url } = await authRequest<{ url: string }>("/google/link-intent", { method: "POST" }, true);
  window.location.assign(url);
}

/** Only same-site paths are accepted as a post-login destination. */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard") {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (raw.startsWith("/login") || raw.startsWith("/signup")) return fallback;
  return raw;
}

const GOOGLE_ERRORS: Record<string, string> = {
  account_exists:
    "An account with this email already exists. Sign in with your password, then connect Google from Settings.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That sign-in attempt expired. Please try again.",
  google_failed: "We couldn't verify your Google sign-in. Please try again.",
  google_unverified: "Your Google account's email address isn't verified.",
  google_unavailable: "Google sign-in isn't available right now. Use your email and password instead.",
  link_expired: "That request expired. Try connecting Google again from Settings.",
};

export function describeAuthError(code: string | null) {
  return code ? GOOGLE_ERRORS[code] ?? "Sign-in didn't complete. Please try again." : null;
}
