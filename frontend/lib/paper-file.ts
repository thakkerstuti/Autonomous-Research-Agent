/**
 * The original PDF, for the reading panels. Fetched once per paper with the
 * user's token (directly from the API, like every other call) and kept in the
 * query cache. Returns null when the server no longer has the file (e.g. after
 * a restart on temporary storage); the reader then shows the extracted text.
 */
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "./api";
import { ApiError } from "./api-error";
import { getAccessToken, recoverFromUnauthorized } from "./auth";

async function fetchPdf(paperId: string): Promise<Uint8Array | null> {
  const url = `${API_BASE}/papers/${paperId}/file`;
  const get = (token: string | null) =>
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => {
      throw new ApiError(0, "Couldn't reach the CogNexa server to load the PDF.");
    });
  let res = await get(await getAccessToken());
  if (res.status === 401) {
    const renewed = await recoverFromUnauthorized();
    if (renewed) res = await get(renewed);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `Couldn't load the PDF (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export const usePaperFile = (paperId: string | null) =>
  useQuery({
    queryKey: ["paper-file", paperId],
    queryFn: () => fetchPdf(paperId!),
    enabled: !!paperId,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: (count, err: any) => err?.status !== 404 && count < 1,
  });
