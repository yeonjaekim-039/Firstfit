import { describe, expect, it } from 'vitest';
import { CleaningClient, cleanParam, cleanParams, cleanText, withCleaning } from './clean.js';
import { createPool } from './pool.js';

describe('cleanText / cleanParam', () => {
  it('removes every NUL character and leaves other text alone', () => {
    expect(cleanText('a\u0000b\u0000c')).toBe('abc');
    expect(cleanText('\u0000')).toBe('');
    expect(cleanText('héllo 💎 \t\n')).toBe('héllo 💎 \t\n');
  });

  it('cleans strings inside (nested) arrays, such as labels TEXT[]', () => {
    expect(cleanParam(['bug\u0000', 'good first issue'])).toEqual(['bug', 'good first issue']);
    expect(cleanParam([['a\u0000'], 'b'])).toEqual([['a'], 'b']);
  });

  it('passes non-string values through unchanged', () => {
    const date = new Date('2026-11-08T00:00:00Z');
    expect(cleanParams([1, null, undefined, true, date, 2n])).toEqual([1, null, undefined, true, date, 2n]);
    expect(cleanParam(date)).toBe(date);
  });
});

describe('withCleaning', () => {
  class Recorder {
    calls: unknown[][] = [];
    query(...args: unknown[]) {
      this.calls.push(args);
      return Promise.resolve({ rows: [] });
    }
  }
  const Cleaning = withCleaning(Recorder);

  it('cleans values passed as query(text, values)', async () => {
    const c = new Cleaning();
    await c.query('INSERT', ['x\u0000', ['y\u0000'], 3]);
    expect(c.calls[0]).toEqual(['INSERT', ['x', ['y'], 3]]);
  });

  it('cleans values passed as query({ text, values }) without mutating the caller object', async () => {
    const c = new Cleaning();
    const config = { text: 'INSERT', values: ['x\u0000'] };
    await c.query(config);
    expect(c.calls[0]).toEqual([{ text: 'INSERT', values: ['x'] }]);
    expect(config.values).toEqual(['x\u0000']);
  });

  it('leaves parameterless queries and Submittables (cursors) untouched', async () => {
    const c = new Cleaning();
    const cursor = { values: ['x\u0000'], submit() {} };
    await c.query('BEGIN');
    await c.query(cursor);
    expect(c.calls[0]).toEqual(['BEGIN']);
    expect(c.calls[1]![0]).toBe(cursor);
  });
});

describe('createPool', () => {
  it('uses CleaningClient for every connection, so no query can bypass the cleaning', async () => {
    const pool = createPool('postgresql://user:pw@127.0.0.1:1/none');
    expect((pool as unknown as { options: { Client: unknown } }).options.Client).toBe(CleaningClient);
    await pool.end();
  });
});
