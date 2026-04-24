import type { SearchFilters } from "@/types/search";
import { buildInteractionsUrl, buildSearchUrl } from "@/lib/navigation/url-codecs";
import type { ToolResult } from "./components/dual-mode-interface";

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
    : [];

export function buildUrlForToolResult(toolResult: ToolResult): string | null {
  switch (toolResult.toolName) {
    case "searchEntities": {
      const query = typeof toolResult.query.query === "string" ? toolResult.query.query : "";
      const filters = toolResult.query.filters && typeof toolResult.query.filters === "object"
        ? (toolResult.query.filters as SearchFilters)
        : {};
      return buildSearchUrl({ query, filters });
    }
    case "resolveEntityIdentifiers": {
      const identifiers = toStringArray(toolResult.query.identifiers);
      return buildSearchUrl({
        mode: identifiers.length > 1 ? "batch" : "identifier",
        query: identifiers.length === 1 ? identifiers[0] : "",
      });
    }
    case "searchInteractions": {
      const entityIds = toStringArray(toolResult.query.entityIds).length > 0
        ? toStringArray(toolResult.query.entityIds)
        : toStringArray(toolResult.query.entity_ids);

      return buildInteractionsUrl({
        entityIds,
        filters: {
          entity_ids: entityIds,
          ontology_terms: toStringArray(toolResult.query.ontologyTerms).length > 0
            ? toStringArray(toolResult.query.ontologyTerms)
            : toStringArray(toolResult.query.ontology_terms),
          is_directed: typeof toolResult.query.hasDirection === "boolean"
            ? toolResult.query.hasDirection
            : typeof toolResult.query.has_direction === "boolean"
              ? toolResult.query.has_direction
              : undefined,
          signs: [
            ...(typeof toolResult.query.isPositive === "boolean" && toolResult.query.isPositive
              ? [1 as const]
              : typeof toolResult.query.has_positive_sign === "boolean" && toolResult.query.has_positive_sign
                ? [1 as const]
                : []),
            ...(typeof toolResult.query.isNegative === "boolean" && toolResult.query.isNegative
              ? [-1 as const]
              : typeof toolResult.query.has_negative_sign === "boolean" && toolResult.query.has_negative_sign
                ? [-1 as const]
                : []),
          ],
          sources: toStringArray(toolResult.query.sources),
        },
      });
    }
    default:
      return null;
  }
}
