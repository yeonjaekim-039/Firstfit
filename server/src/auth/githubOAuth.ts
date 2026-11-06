export interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** The two GitHub calls in the OAuth web flow; injected so routes can be tested without network. */
export interface GitHubOAuth {
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<GitHubProfile>;
}

export function createGitHubOAuth(clientId: string, clientSecret: string, fetchFn: typeof fetch = fetch): GitHubOAuth {
  return {
    authorizeUrl(state, redirectUri) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      // No scopes: the public profile is all we need.
      url.searchParams.set('allow_signup', 'true');
      return url.toString();
    },

    async exchangeCode(code, redirectUri) {
      const res = await fetchFn('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
      if (!res.ok || !body.access_token) {
        throw new Error(`GitHub token exchange failed: ${body.error_description ?? body.error ?? res.status}`);
      }
      return body.access_token;
    },

    async fetchProfile(accessToken) {
      const res = await fetchFn('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'github-issue-matcher',
        },
      });
      if (!res.ok) throw new Error(`GitHub /user failed: ${res.status}`);
      const u = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };
      return { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatar_url };
    },
  };
}
