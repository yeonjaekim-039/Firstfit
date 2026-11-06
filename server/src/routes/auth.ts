import { randomBytes, timingSafeEqual } from 'node:crypto';
import { type CookieOptions, Router } from 'express';
import type { GitHubOAuth } from '../auth/githubOAuth.js';
import { OAUTH_STATE_COOKIE, parseCookies, SESSION_COOKIE, SESSION_TTL_MS, type SessionCodec } from '../auth/session.js';
import type { UserStore } from '../db/stores.js';

export interface AuthDeps {
  sessions: SessionCodec;
  /** null when GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET aren't configured. */
  oauth: GitHubOAuth | null;
  /** Browser origin, e.g. http://localhost:5173. The callback goes through its /api proxy. */
  clientUrl: string;
}

const sameString = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function authRouter(deps: AuthDeps & { userStore: UserStore }) {
  const router = Router();
  const redirectUri = `${deps.clientUrl}/api/auth/github/callback`;
  const cookieBase: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.clientUrl.startsWith('https://'),
  };
  const back = (query = '') => `${deps.clientUrl}/${query}`;

  router.get('/github', (_req, res) => {
    if (!deps.oauth) {
      res.status(503).json({ error: 'GitHub login is not configured on this server' });
      return;
    }
    const state = randomBytes(16).toString('hex');
    res.cookie(OAUTH_STATE_COOKIE, state, { ...cookieBase, path: '/api/auth', maxAge: 10 * 60_000 });
    res.redirect(deps.oauth.authorizeUrl(state, redirectUri));
  });

  router.get('/github/callback', async (req, res) => {
    const expectedState = parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { ...cookieBase, path: '/api/auth' });

    if (!deps.oauth) {
      res.redirect(back('?authError=unavailable'));
      return;
    }
    const { code, state, error } = req.query;
    if (typeof error === 'string') {
      res.redirect(back('?authError=denied'));
      return;
    }
    if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || !sameString(state, expectedState)) {
      res.redirect(back('?authError=state'));
      return;
    }

    try {
      const token = await deps.oauth.exchangeCode(code, redirectUri);
      const profile = await deps.oauth.fetchProfile(token);
      const userId = await deps.userStore.upsertGithubUser(profile);
      res.cookie(SESSION_COOKIE, deps.sessions.sign(userId), { ...cookieBase, path: '/', maxAge: SESSION_TTL_MS });
      res.redirect(back('dashboard'));
    } catch (err) {
      console.error('GitHub OAuth callback failed:', err);
      res.redirect(back('?authError=failed'));
    }
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { ...cookieBase, path: '/' });
    res.status(204).end();
  });

  return router;
}
