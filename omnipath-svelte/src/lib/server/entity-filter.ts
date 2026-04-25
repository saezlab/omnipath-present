import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function normalizedEntityTypeDrizzleSql(column: SQLWrapper): SQL {
  return sql`LOWER(split_part(${column}, ':', 3)) || ':' || split_part(${column}, ':', 1) || ':' || split_part(${column}, ':', 2)`;
}
