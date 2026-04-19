"use server";

import "server-only";

import type { SearchFilters } from "@/types/search";
import type { InteractionDetailsData, InteractionEvidence, InteractionListRow } from "@/features/interactions-search/types";
import { searchInteractions as searchInteractionsData } from "@/lib/search_data/search";
import { loadFacetDistributionFromMaterializedView } from "@/lib/postgres-search/search";
import {
  getEntitiesByPks,
  getInteractionAnnotations,
  getInteractionById,
  getInteractionEvidence,
} from "@/lib/db/reads";

function parseCvValue(value: string | null | undefined): { accession: string; label: string } {
  const text = (value || "").trim();
  const parts = text.split(":");
  if (parts.length < 3) {
    return { accession: text, label: text };
  }
  return {
    accession: `${parts[0]}:${parts[1]}`,
    label: parts.slice(2).join(":").trim(),
  };
}

function toLegacyLabeledValue(value: string | null | undefined): string {
  const { accession, label } = parseCvValue(value);
  if (!accession || !label) return value || "";
  return `${label.toLowerCase()}:${accession}`;
}

function mapEvidenceAttributes(
  attributes: Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined,
) {
  return (attributes || []).map((item) => ({
    term: toLegacyLabeledValue(item.term),
    value: item.value ?? null,
    unit: item.unit ? toLegacyLabeledValue(item.unit) : null,
  }));
}

function mapInteractionEvidenceRows(rows: Awaited<ReturnType<typeof getInteractionEvidence>>): InteractionEvidence[] {
  return rows.map((row, index) => ({
    evidence_serial: index + 1,
    source: row.source,
    direction: row.direction === 1 ? "a-b" : row.direction === -1 ? "b-a" : row.direction === 0 ? "undirected" : null,
    sign: row.sign === 1 || row.sign === -1 || row.sign === 0 ? row.sign : null,
    interaction_annotations: [
      ...mapEvidenceAttributes(row.recordAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
      ...mapEvidenceAttributes(row.evidence as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
    ],
    member_a_annotations: mapEvidenceAttributes(row.entityAAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
    member_b_annotations: mapEvidenceAttributes(row.entityBAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
  }));
}

export interface SearchInteractionsParams {
  query?: string;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
}

export interface SearchInteractionsResult {
  hits: InteractionListRow[];
  total: number;
}

export type InteractionFilterCounts = Record<string, Record<string, number>> & {
  interaction_type: Record<string, number>;
  is_directed: Record<string, number>;
  sign: Record<string, number>;
  interaction_annotation_terms: Record<string, number>;
  participant_annotation_terms: Record<string, number>;
  sources: Record<string, number>;
};

export async function searchInteractions({
  query = "",
  limit = 20,
  offset = 0,
  filters = {},
}: SearchInteractionsParams = {}): Promise<SearchInteractionsResult> {
  try {
    const result = await searchInteractionsData({
      query,
      limit,
      offset,
      filters,
    });

    return {
      hits: result.hits || [],
      total: result.estimatedTotalHits || 0,
    };
  } catch (error) {
    console.error("Error searching interactions:", error);
    return {
      hits: [],
      total: 0,
    };
  }
}

export async function getInteractionDetails(interactionId: number): Promise<InteractionDetailsData | null> {
  if (!Number.isFinite(interactionId)) {
    return null;
  }

  try {
    const interaction = await getInteractionById(interactionId);
    if (!interaction) {
      return null;
    }

    const [entities, evidence, interactionAnnotations] = await Promise.all([
      getEntitiesByPks([interaction.entityAPk, interaction.entityBPk]),
      getInteractionEvidence(interaction.interactionPk),
      getInteractionAnnotations(interaction.interactionPk),
    ]);

    const entityByPk = new Map(entities.map((entity) => [entity.entityPk, entity]));
    const entityA = entityByPk.get(interaction.entityAPk);
    const entityB = entityByPk.get(interaction.entityBPk);

    if (!entityA || !entityB) {
      return null;
    }

    return {
      interaction,
      entityA,
      entityB,
      evidence: mapInteractionEvidenceRows(evidence),
      interactionAnnotations,
      rawEvidence: evidence,
    };
  } catch (error) {
    console.error("Error fetching interaction details:", error);
    return null;
  }
}

export async function getInteractionFilterCounts({
  query = "",
  filters = {},
}: {
  query?: string;
  filters?: SearchFilters;
} = {}): Promise<InteractionFilterCounts> {
  void query;
  void filters;

  try {
    const facetDistribution = await loadFacetDistributionFromMaterializedView("interaction_filter_counts");

    return {
      interaction_type: facetDistribution.interaction_type || {},
      is_directed: facetDistribution.is_directed || {},
      sign: facetDistribution.sign || {},
      interaction_annotation_terms: facetDistribution.interaction_annotation_terms || {},
      participant_annotation_terms: facetDistribution.participant_annotation_terms || {},
      sources: facetDistribution.sources || {},
    };
  } catch (error) {
    console.error("Error fetching interaction filter counts:", error);
    return {
      interaction_type: {},
      is_directed: {},
      sign: {},
      interaction_annotation_terms: {},
      participant_annotation_terms: {},
      sources: {},
    };
  }
}
