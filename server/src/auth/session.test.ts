import { describe, expect, it } from 'vitest';
import { createSessionCodec, parseCookies } from './session.js';

describe('session codec', () => {
  const codec = createSessionCodec('secret', 1000);

  it('round-trips a user id', () => {
    expect(codec.verify(codec.sign(42, 0), 500)).toBe(42);
  });

  it('rejects expired tokens', () => {
    expect(codec.verify(codec.sign(42, 0), 1000)).toBeNull();
  });

  it('rejects tampered payloads and signatures', () => {
    const token = codec.sign(42, 0);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 1, exp: 9e15 })).toString('base64url');
    expect(codec.verify(`${forged}.${sig}`, 0)).toBeNull();
    expect(codec.verify(`${payload}.${sig!.slice(0, -2)}xx`, 0)).toBeNull();
  });

  it('rejects tokens signed with another secret', () => {
    expect(createSessionCodec('other').verify(codec.sign(42, 0), 0)).toBeNull();
  });

  it('rejects junk', () => {
    for (const junk of [undefined, '', 'abc', 'a.b.c', '.', 'e30.']) expect(codec.verify(junk, 0)).toBeNull();
  });
});

describe('parseCookies', () => {
  it('parses and decodes cookie headers', () => {
    expect(parseCookies('a=1; b=hello%20world; c')).toEqual({ a: '1', b: 'hello world' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });
});
