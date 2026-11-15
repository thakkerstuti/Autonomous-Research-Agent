import { ApiError, errorFromResponse } from "./api-error";
import { getAccessToken, recoverFromUnauthorized } from "./auth";

export { ApiError };

// In local development, requests go through the dev server's /backend relay
// (see next.config.mjs) so the deployed backend's CORS rules don't block localhost.
const API_BASE =
  (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_API_URL ? "/backend" : "") ||
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : "");

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const send = (token: string | null) => {
    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  };

  let response = await send(await getAccessToken());

  // The access token expired or was revoked: renew it once and retry
  if (response.status === 401) {
    const renewed = await recoverFromUnauthorized();
    if (renewed) response = await send(renewed);
  }

  if (!response.ok) throw await errorFromResponse(response);

  // Handle empty responses
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
