/** 950 -> "950", 1234 -> "1.2k", 45_600 -> "45.6k", 1_200_000 -> "1.2M". */
export function formatCount(n: number): string {
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '')
  if (n >= 999_950) return `${trim(n / 1_000_000)}M`
  if (n >= 1000) return `${trim(n / 1000)}k`
  return String(n)
}

/**
 * Returns the URL only if it is absolute http(s); otherwise undefined. Use for links whose
 * value came from untrusted content (blog feeds), so a `javascript:` or `data:` URL can never
 * reach an href, even if the server-side checks were bypassed.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : undefined
  } catch {
    return undefined
  }
}

/** "2026-11-05T20:23:21Z" -> "Nov 5, 2026" (UTC, so it doesn't shift by time zone). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  const units: [number, string][] = [
    [31_536_000, 'y'],
    [2_592_000, 'mo'],
    [86_400, 'd'],
    [3_600, 'h'],
    [60, 'm'],
  ]
  for (const [size, unit] of units) if (s >= size) return `${Math.floor(s / size)}${unit} ago`
  return 'just now'
}
