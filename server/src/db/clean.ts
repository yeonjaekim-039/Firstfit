/**
 * The single place where values are made safe for Postgres before they're sent.
 *
 * Postgres TEXT (and TEXT[]) cannot store U+0000: one NUL in any parameter fails the whole
 * statement with SQLSTATE 22021 "invalid byte sequence for encoding UTF8: 0x00". GitHub
 * allows NUL in issue titles, label names and other text, and blog feeds are untrusted too.
 *
 * Rather than cleaning individual fields at each call site (easy to miss one), the pool uses
 * CleaningClient, which cleans every parameter of every query, including strings nested in
 * arrays. Nothing that reaches the database can bypass it.
 */
import pg from 'pg';

/** Removes NUL characters, the one code point Postgres text cannot hold. */
export function cleanText(value: string): string {
  return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
}

/** Cleans a query parameter: strings, and strings inside (nested) arrays. Other values pass through. */
export function cleanParam(value: unknown): unknown {
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.map(cleanParam);
  return value;
}

export function cleanParams(values: readonly unknown[]): unknown[] {
  return values.map(cleanParam);
}

type QueryableCtor = new (...args: any[]) => { query(...args: any[]): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Wraps a client class so `query(text, values)` and `query({ text, values })` send cleaned
 * values. Exported as a mixin so tests can wrap a fake client instead of a real connection.
 */
export function withCleaning<T extends QueryableCtor>(Base: T) {
  return class CleaningClient extends Base {
    override query(...args: any[]): any { // eslint-disable-line @typescript-eslint/no-explicit-any
      const [config, values] = args;
      if (Array.isArray(values)) {
        args[1] = cleanParams(values);
      } else if (
        config !== null &&
        typeof config === 'object' &&
        Array.isArray(config.values) &&
        typeof config.submit !== 'function' // leave Submittables (cursors, streams) untouched
      ) {
        args[0] = { ...config, values: cleanParams(config.values) };
      }
      return super.query(...args);
    }
  };
}

/** pg.Client that cleans every query's parameters; used by the app's pool (db/pool.ts). */
export const CleaningClient = withCleaning(pg.Client);
