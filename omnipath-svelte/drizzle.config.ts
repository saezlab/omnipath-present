import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env' });
config({ path: '.env.local', override: true });

const pgSchema = process.env.OMNIPATH_PG_SCHEMA;

export default defineConfig({
  out: './src/lib/drizzle',
  schema: './src/lib/drizzle/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  ...(pgSchema && pgSchema !== 'public' ? { schemaFilter: [pgSchema] } : {}),
  verbose: true,
  casing: 'snake_case'
});
