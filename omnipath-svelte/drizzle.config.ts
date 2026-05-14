import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env' });
config({ path: '.env.local', override: true });

export default defineConfig({
  out: './src/lib/drizzle',
  schema: './src/lib/drizzle/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: [process.env.OMNIPATH_PG_SCHEMA || 'public'],
  verbose: true,
  casing: 'snake_case'
});
