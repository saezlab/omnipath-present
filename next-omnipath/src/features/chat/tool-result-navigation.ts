import type { MeilisearchFilters } from "@/types/meilisearch";
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
        ? (toolResult.query.filters as MeilisearchFilters)
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
          interaction_annotation_terms: toStringArray(toolResult.query.interactionAnnotationTerms).length > 0
            ? toStringArray(toolResult.query.interactionAnnotationTerms)
            : toStringArray(toolResult.query.interaction_annotation_terms),
          participant_annotation_terms: Array.from(new Set([
            ...(toStringArray(toolResult.query.participantAnnotationTermsGo).length > 0
              ? toStringArray(toolResult.query.participantAnnotationTermsGo)
              : toStringArray(toolResult.query.participant_annotation_terms_go)),
            ...(toStringArray(toolResult.query.participantAnnotationTermsMi).length > 0
              ? toStringArray(toolResult.query.participantAnnotationTermsMi)
              : toStringArray(toolResult.query.participant_annotation_terms_mi)),
            ...(toStringArray(toolResult.query.participantAnnotationTermsOm).length > 0
              ? toStringArray(toolResult.query.participantAnnotationTermsOm)
              : toStringArray(toolResult.query.participant_annotation_terms_om)),
            ...(toStringArray(toolResult.query.participantAnnotationTermsHp).length > 0
              ? toStringArray(toolResult.query.participantAnnotationTermsHp)
              : toStringArray(toolResult.query.participant_annotation_terms_hp)),
            ...(toStringArray(toolResult.query.participantAnnotationTermsKw).length > 0
              ? toStringArray(toolResult.query.participantAnnotationTermsKw)
              : toStringArray(toolResult.query.participant_annotation_terms_kw)),
          ])),
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
