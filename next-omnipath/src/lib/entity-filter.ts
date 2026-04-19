import "server-only";

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function normalizeEntityTypeFilterValue(value: string | null | undefined): string {
  const text = (value || "").trim();
  if (!text) return "";
  const parts = text.split(":");
  if (parts.length < 3) return text.toLowerCase();
  return `${parts[0].toLowerCase()}:${parts[1].toUpperCase()}:${parts.slice(2).join(":").toUpperCase()}`;
}

export function normalizeInteractionTypeFilterValue(value: string | null | undefined): string {
  const text = (value || "").trim();
  if (!text) return "";
  return text
    .split("|")
    .map((part) => normalizeEntityTypeFilterValue(part))
    .sort()
    .join("|");
}

export function normalizedEntityTypeDrizzleSql(column: SQLWrapper): SQL {
  return sql`LOWER(split_part(${column}, ':', 3)) || ':' || split_part(${column}, ':', 1) || ':' || split_part(${column}, ':', 2)`;
}

export function normalizedEntityTypeSqlExpression(column: string): string {
  return `LOWER(split_part(${column}, ':', 3)) || ':' || split_part(${column}, ':', 1) || ':' || split_part(${column}, ':', 2)`;
}
