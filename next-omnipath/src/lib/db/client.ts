import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../drizzle/schema';

const DATABASE_URL = process.env.DATABASE_URL;

let pool: Pool | null = null;

function createDb() {
  return drizzle(getPool(), { schema });
}

let dbInstance: ReturnType<typeof createDb> | null = null;

export function getPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL });
  }

  return pool;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = createDb();
  }

  return dbInstance;
}

export type DbClient = ReturnType<typeof getDb>;
export { schema };
