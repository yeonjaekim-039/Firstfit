import { describe, expect, it } from 'vitest';
import { extractRepos, MAX_REPOS_PER_POST } from './repos.js';

describe('extractRepos', () => {
  it('extracts owner/repo from repo, file, issue and PR links, lowercased and de-duplicated', () => {
    const html = `
      <a href="https://github.com/Netflix/conductor">Conductor</a>
      <a href="https://github.com/netflix/conductor/blob/main/README.md">readme</a>
      <a href="https://www.github.com/sgl-project/sglang/pull/38935">PR</a>
      <a href="http://github.com/cloudflare/workerd/issues/42">issue</a>
      <a href="https://github.com/cloudflare/workerd/tree/main/src">tree</a>`;
    expect(extractRepos(html)).toEqual(['netflix/conductor', 'sgl-project/sglang', 'cloudflare/workerd']);
  });

  it('ignores non-repo GitHub paths such as /features, /orgs, /topics, /sponsors and /marketplace', () => {
    const html = `
      https://github.com/features/actions https://github.com/features/ai/github-app
      https://github.com/orgs/acme/people https://github.com/topics/rust
      https://github.com/sponsors/someone https://github.com/marketplace/actions/checkout
      https://github.com/settings/tokens https://github.com/enterprise/pricing
      https://github.com/apps/dependabot https://github.com/about/careers
      https://github.com/customer-stories/acme https://github.com/security/advisories`;
    expect(extractRepos(html)).toEqual([]);
  });

  it('ignores profile-only links, other GitHub hosts and look-alike domains', () => {
    const html = `
      <a href="https://github.com/torvalds">profile</a>
      <a href="https://gist.github.com/someone/abc123">gist</a>
      <a href="https://docs.github.com/en/rest/repos">docs</a>
      <a href="https://raw.githubusercontent.com/a/b/main/x">raw</a>
      <a href="https://notgithub.com/a/b">fake</a>
      <a href="https://github.community/t/123">community</a>`;
    expect(extractRepos(html)).toEqual([]);
  });

  it('strips .git and trailing sentence punctuation from bare URLs in text', () => {
    const text = 'Clone https://github.com/acme/tool.git or read https://github.com/acme/docs.';
    expect(extractRepos(text)).toEqual(['acme/tool', 'acme/docs']);
  });

  it('keeps dots inside repo names', () => {
    expect(extractRepos('https://github.com/vercel/next.js/pull/1')).toEqual(['vercel/next.js']);
  });

  it(`caps the number of repos per post at ${MAX_REPOS_PER_POST}`, () => {
    const html = Array.from({ length: 30 }, (_, i) => `https://github.com/org/repo-${i}`).join(' ');
    expect(extractRepos(html)).toHaveLength(MAX_REPOS_PER_POST);
  });
});
