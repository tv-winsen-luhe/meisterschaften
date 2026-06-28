// Shared admin HTTP helpers — the edge-auth and error-body handling every `/api/admin/*` caller needs,
// owned once so the shell and the draw-show wiring read the same behaviour (ADR-0008).

// Auth is edge-only (Cloudflare Access, ADR-0008). An expired Access session answers `/api/admin/*` with
// a 302 to the cross-origin login; `redirect: 'manual'` (see the client) turns that into an opaque-redirect
// response (status 0) — that, or a bare 401, signals a full page reload so the browser re-runs the Access
// flow. Typed as the global Response (not the hc ClientResponse) so `status` widens to number.
export const isAuthRedirect = (res: Response): boolean => res.type === 'opaqueredirect' || res.status === 401

// Pull the { error } message out of any non-OK admin response.
export const errorMessage = async (res: Response): Promise<string> => {
  try {
    const data = (await res.json()) as { error?: string }
    return data?.error ?? `Fehler ${res.status}`
  } catch {
    return `Fehler ${res.status}`
  }
}
