// Number of trusted reverse-proxy / load-balancer hops in front of the app.
// X-Forwarded-For is built left-to-right (client, proxy1, proxy2, ...), so the
// real client sits at index (length - TRUSTED_PROXY_HOPS). Counting from the
// RIGHT means a client can only forge entries we then skip over; taking the
// leftmost value let anyone spoof their IP and dodge a per-IP quota. Default 1
// (a single edge LB); set TRUSTED_PROXY_HOPS to match your topology, or 0 if
// the app is exposed directly (XFF is then ignored).
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS ?? 1))

/**
 * The address a per-IP limit is keyed on. Shared by the ingest routes
 * (routes/errors.ts) and the connect endpoints (routes/hq.ts).
 */
export function clientIp(request: any): string {
  const direct = request.headers?.get('x-real-ip') || request.ip || 'unknown'
  if (TRUSTED_PROXY_HOPS === 0)
    return direct
  const xff = request.headers?.get('x-forwarded-for')
  if (xff) {
    const hops = String(xff).split(',').map((s: string) => s.trim()).filter(Boolean)
    if (hops.length) {
      const idx = hops.length - TRUSTED_PROXY_HOPS
      return hops[idx >= 0 ? idx : 0]
    }
  }
  return direct
}
