import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'gim_session';
export const OAUTH_STATE_COOKIE = 'gim_oauth_state';
export const SESSION_TTL_MS = 30 * 86_400_000;

/**
 * Stateless sessions: the cookie holds `<base64url(json)>.<base64url(hmac-sha256)>`.
 * Nothing is stored server-side; changing SESSION_SECRET logs everyone out.
 */
export function createSessionCodec(secret: string, ttlMs = SESSION_TTL_MS) {
  const mac = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

  return {
    sign(userId: number, now = Date.now()): string {
      const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + ttlMs })).toString('base64url');
      return `${payload}.${mac(payload)}`;
    },

    verify(token: string | undefined, now = Date.now()): number | null {
      if (!token) return null;
      const [payload, sig] = token.split('.');
      if (!payload || !sig) return null;
      const expected = Buffer.from(mac(payload));
      const actual = Buffer.from(sig);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      try {
        const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
          uid: unknown;
          exp: unknown;
        };
        if (typeof uid !== 'number' || !Number.isInteger(uid) || typeof exp !== 'number' || exp <= now) return null;
        return uid;
      } catch {
        return null;
      }
    },
  };
}

export type SessionCodec = ReturnType<typeof createSessionCodec>;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}
