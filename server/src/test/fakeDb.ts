import { withCleaning } from '../db/clean.js';

export interface SentQuery {
  text: string;
  values: unknown[];
}

type Responder = (text: string, values: unknown[]) => { rows: unknown[] } | undefined;
type Failer = (text: string, values: unknown[]) => unknown;

/**
 * Records every query instead of talking to Postgres. Wrapped with the same withCleaning mixin
 * as the real pool's client, so tests see exactly the parameters that would be sent.
 */
class RecordingClient {
  sent: SentQuery[] = [];
  released = false;
  respond: Responder = () => undefined;
  fail: Failer = () => undefined;

  async query(textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) {
    const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    const vals = (typeof textOrConfig === 'string' ? values : textOrConfig.values) ?? [];
    this.sent.push({ text, values: vals });
    const err = this.fail(text, vals);
    if (err) throw err;
    return this.respond(text, vals) ?? defaultResponse(text, vals);
  }

  release() {
    this.released = true;
  }
}

/** Mimics `INSERT INTO repos ... RETURNING id, full_name` (5 params per row). */
function defaultResponse(text: string, values: unknown[]) {
  if (text.includes('INSERT INTO repos')) {
    const rows = [];
    for (let i = 0; i < values.length; i += 5) rows.push({ id: 100 + i / 5, full_name: values[i] });
    return { rows };
  }
  return { rows: [] };
}

export const FakeCleaningClient = withCleaning(RecordingClient);

/** A pool-shaped fake: connect() hands out one recording client; query() delegates like pg.Pool does. */
export function fakeDb() {
  const client = new FakeCleaningClient();
  const pool = {
    connect: async () => client,
    query: (text: string, values?: unknown[]) => client.query(text, values),
  };
  return { pool: pool as never, client };
}

/** Every string anywhere in the values sent (including inside arrays). */
export function sentStrings(sent: SentQuery[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  sent.forEach((q) => q.values.forEach(walk));
  return out;
}

export const pgError = (code: string, message = `pg error ${code}`) => Object.assign(new Error(message), { code });
