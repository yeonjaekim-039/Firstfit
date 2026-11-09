import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../ingest/queries.js';
import { tagPost, TOPICS } from './tags.js';

describe('tagPost', () => {
  it('tags from a single mention in the title or the feed categories', () => {
    expect(tagPost({ title: 'Rewriting our CLI in Rust' })).toContain('rust');
    expect(tagPost({ title: 'Quarterly update', categories: ['Security', 'Post-Quantum'] })).toContain('security');
  });

  it('needs at least two mentions in the body, so a passing mention does not tag the post', () => {
    expect(tagPost({ title: 'A migration story', body: 'Unlike our old Java services, this one…' })).not.toContain('java');
    expect(tagPost({ title: 'A migration story', body: 'We moved Java services. The JVM tuning took weeks.' })).toContain(
      'java',
    );
  });

  it('does not confuse JavaScript with Java, or the English word "go" with the Go language', () => {
    const js = tagPost({ title: 'Faster JavaScript bundling' });
    expect(js).toContain('javascript');
    expect(js).not.toContain('java');
    expect(tagPost({ title: "Let's go: how we shipped it", body: 'Go ahead and go read it. We go fast.' })).not.toContain('go');
    expect(tagPost({ title: 'Profiling Go services at scale' })).toContain('go');
    expect(tagPost({ title: 'Why we love golang' })).toContain('go');
  });

  it('tags React the framework, not the verb', () => {
    expect(tagPost({ title: 'Server components in React' })).toContain('frontend');
    expect(tagPost({ title: 'How on-call engineers react to alerts', body: 'We react fast. Teams react well.' })).not.toContain(
      'frontend',
    );
  });

  it('recognizes C++ and C#', () => {
    expect(tagPost({ title: 'Modern C++ in our engine' })).toContain('c++');
    expect(tagPost({ title: 'Porting a C# service to .NET 9' })).toContain('c#');
  });

  it('has a language tag for every language the issue crawler targets, so profiles can match posts', () => {
    for (const language of LANGUAGES) expect(Object.keys(TOPICS)).toContain(language.toLowerCase());
  });
});
