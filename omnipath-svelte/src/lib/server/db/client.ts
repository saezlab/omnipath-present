import { env } from '$env/dynamic/private';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as relations from '$lib/drizzle/relations';
import * as schema from '$lib/drizzle/schema';

let pool: Pool | null = null;

function createDb() {
	return drizzle(getPool(), { schema: { ...schema, ...relations } });
}

let dbInstance: ReturnType<typeof createDb> | null = null;

export function getPool(): Pool {
	if (!env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not configured');
	}

	if (!pool) {
		pool = new Pool({ connectionString: env.DATABASE_URL });
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
