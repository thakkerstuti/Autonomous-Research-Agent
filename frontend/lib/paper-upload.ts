/**
 * PDF upload with real progress. fetch() can't report upload progress, so this
 * uses XMLHttpRequest. It goes straight to the backend (API_BASE: the Render URL
 * in production, never the Vercel auth proxy) with the in-memory bearer token.
 */
import { API_BASE, apiClient } from "./api";
import { ApiError } from "./api-error";
import { getAccessToken, recoverFromUnauthorized } from "./auth";
import { getAskQuestions } from "./reflection";

export const MAX_PDF_MB = 25;
export const MAX_PDF_PAGES = 300;

export interface UploadResult {
  id: string;
  message: string;
  status: string;
  page_count: number;
  text_pages: number;
  needs_ocr: boolean;
  /** The same PDF was already in the library: this is that paper, nothing new was saved. */
  duplicate?: boolean;
}

/** Thrown when the reader cancels: nothing was saved. */
export const UPLOAD_CANCELLED = "Upload cancelled. Nothing was saved.";
export const isCancelled = (err: unknown) => err instanceof ApiError && err.message === UPLOAD_CANCELLED;

export type UploadPhase = "uploading" | "extracting";

function send(file: File, level: string, uploadId: string, token: string | null, onProgress: (phase: UploadPhase, pct: number) => void, signal?: AbortSignal) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError(0, UPLOAD_CANCELLED));
    const xhr = new XMLHttpRequest();
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new ApiError(0, UPLOAD_CANCELLED));
    xhr.open("POST", `${API_BASE}/papers`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress("uploading", Math.round((e.loaded / e.total) * 100));
    };
    // Bytes are all sent; the server is now extracting the pages
    xhr.upload.onload = () => onProgress("extracting", 100);
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload couldn't reach the server. Check your connection and try again."));
    xhr.ontimeout = () => reject(new ApiError(0, "The upload timed out. Try again."));
    const form = new FormData();
    form.append("file", file);
    form.append("level", level);
    form.append("upload_id", uploadId);
    form.append("ask_questions", String(getAskQuestions())); // "Think while you wait"
    onProgress("uploading", 0);
    xhr.send(form);
  });
}

export async function uploadPaper(
  file: File,
  level: string,
  onProgress: (phase: UploadPhase, pct: number) => void,
  options: { uploadId?: string; signal?: AbortSignal } = {}
): Promise<UploadResult> {
  const uploadId = options.uploadId ?? crypto.randomUUID();
  let res = await send(file, level, uploadId, await getAccessToken(), onProgress, options.signal);
  if (res.status === 401) {
    const renewed = await recoverFromUnauthorized();
    if (renewed) res = await send(file, level, uploadId, renewed, onProgress, options.signal);
  }
  if (res.status === 409 && res.body?.detail === UPLOAD_CANCELLED) throw new ApiError(409, UPLOAD_CANCELLED);
  if (res.status < 200 || res.status >= 300) {
    const detail = typeof res.body?.detail === "string" ? res.body.detail : `Upload failed (HTTP ${res.status}).`;
    throw new ApiError(res.status, detail, res.body);
  }
  return res.body as UploadResult;
}

/**
 * Cancel an upload that is still running. The server keeps nothing from it, unless it had
 * already finished saving: then the saved paper's id comes back.
 */
export const cancelUpload = (uploadId: string) =>
  apiClient<{ cancelled: boolean; paper_id: string | null }>(`/papers/uploads/${encodeURIComponent(uploadId)}/cancel`, { method: "POST" });
