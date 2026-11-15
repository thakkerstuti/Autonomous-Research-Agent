/**
 * PDF upload with real progress. fetch() can't report upload progress, so this
 * uses XMLHttpRequest. It goes straight to the backend (API_BASE: the Render URL
 * in production, never the Vercel auth proxy) with the in-memory bearer token.
 */
import { API_BASE } from "./api";
import { ApiError } from "./api-error";
import { getAccessToken, recoverFromUnauthorized } from "./auth";

export const MAX_PDF_MB = 25;
export const MAX_PDF_PAGES = 300;

export interface UploadResult {
  id: string;
  message: string;
  status: string;
  page_count: number;
  text_pages: number;
  needs_ocr: boolean;
}

export type UploadPhase = "uploading" | "extracting";

function send(file: File, level: string, token: string | null, onProgress: (phase: UploadPhase, pct: number) => void) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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
    onProgress("uploading", 0);
    xhr.send(form);
  });
}

export async function uploadPaper(
  file: File,
  level: string,
  onProgress: (phase: UploadPhase, pct: number) => void
): Promise<UploadResult> {
  let res = await send(file, level, await getAccessToken(), onProgress);
  if (res.status === 401) {
    const renewed = await recoverFromUnauthorized();
    if (renewed) res = await send(file, level, renewed, onProgress);
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = typeof res.body?.detail === "string" ? res.body.detail : `Upload failed (HTTP ${res.status}).`;
    throw new ApiError(res.status, detail, res.body);
  }
  return res.body as UploadResult;
}
