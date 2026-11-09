import pg from 'pg';
import { config } from '../config.js';
import { CleaningClient } from './clean.js';

/** Every connection uses CleaningClient, so all query parameters are cleaned before they're sent. */
export function createPool(connectionString: string | undefined): pg.Pool {
  return new pg.Pool({ connectionString, Client: CleaningClient });
}

export const pool = createPool(config.databaseUrl);
