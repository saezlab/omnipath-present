import { getChatModel } from "@/ai";
import { convertToModelMessages, stepCountIs, streamText, validateUIMessages } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import {
  exploreOntologyTree as exploreOntologyTreeQuery,
  normalizeOntologyFilterValues,
  resolveEntityIdentifiers as resolveEntityIdentifiersQuery,
  resolveOntologyTerms as resolveOntologyTermsQuery,
  searchAssociations,
  searchEntities,
  searchInteractions,
} from "@/lib/queries";
import { getEntityDisplayName, getEntityTypeLabel, getEntityPublicId } from "@/lib/entities/display";
import type { SearchFilters } from "@/types/search";
import type { AssociationListRow } from "@/features/associations/types";
import type { InteractionListRow } from "@/features/interactions-search/types";
import { getApiServiceUrl } from "@/lib/api/config";


// Define types for Meilisearch hits
interface EntityHit {
  id: string;
  entity_id?: string;
  canonical_identifier?: string;
  display_name?: string;
  names?: string[];
  gene_symbol?: string;
  gene_symbols?: string[];
  description?: string;
  descriptions?: string[];
  identifiers?: Array<{ key?: string; value?: string }>;
  entity_type?: { name?: string } | string;
  interaction_ids?: unknown[];
  num_interactions?: number;
  [key: string]: unknown;
}

interface TermInfo {
  id: string;
  name?: string;
  definition?: string | null;
  namespace?: string | null;
}

interface OntologySearchMatch {
  id: string;
  name?: string | null;
  definition?: string | null;
  namespace?: string | null;
  ontology_id: string;
  matched_text: string;
  match_type: string;
  score: number;
}

interface OntologySearchResponse {
  results?: Record<string, OntologySearchMatch[]>;
}

interface OntologyTreeNode {
  id: string;
  name?: string;
  distance?: number;
  children?: OntologyTreeNode[];
}


type AssociationHit = AssociationListRow;
type InteractionHit = InteractionListRow;

const requestSchema = z.object({
  messages: z.array(z.unknown()),
});

const getEntityDbId = (hit: EntityHit): string | undefined => {
  const entityId = hit.entity_id ?? hit.id;
  return typeof entityId === "string" ? entityId : undefined;
};

const getCanonicalIdentifier = (hit: EntityHit): string | undefined => {
  if (hit.canonical_identifier) return hit.canonical_identifier;
  const identifiers = hit.identifiers || [];
  for (const identifier of identifiers) {
    const key = identifier?.key?.toLowerCase() || "";
    if (key.startsWith("uniprot:") && typeof identifier.value === "string") {
      return identifier.value;
    }
  }
  return undefined;
};

const getEntityName = (hit: EntityHit): string => {
  const display = hit.display_name;
  const gene = hit.gene_symbol || hit.gene_symbols?.[0];
  const name = hit.names?.[0];
  const canonical = getCanonicalIdentifier(hit);
  const dbId = getEntityDbId(hit);
  return display || gene || name || canonical || `Entity ${dbId ?? "unknown"}`;
};

const getEntityType = (hit: EntityHit): string => {
  if (typeof hit.entity_type === "object") {
    return hit.entity_type?.name || "entity";
  }
  if (typeof hit.entity_type === "string") {
    return hit.entity_type.split(":")[0] || "entity";
  }
  return "entity";
};

const getInteractionParticipantsLabel = (hit: InteractionHit): string => {
  const left = getEntityDisplayName(hit.entityA) || getEntityPublicId(hit.entityA);
  const right = getEntityDisplayName(hit.entityB) || getEntityPublicId(hit.entityB);
  return `${left} - ${right}`;
};

const getInteractionTypeLabel = (hit: InteractionHit): string => {
  const leftType = getEntityTypeLabel(hit.entityA);
  const rightType = getEntityTypeLabel(hit.entityB);
  if (leftType && rightType) {
    return `${leftType}-${rightType}`;
  }
  return "interaction";
};

// Define the tools
const tools = {
  searchEntities: {
    description: `Search the entity index with broad full-text matching.
Use this for exploratory searches by protein name, gene symbol, family, description, or general entity concepts.
Do NOT use this tool to resolve exact entity identifiers for anchored searches; use resolveEntityIdentifiers instead.`,
    inputSchema: z.object({
      query: z.string().describe("The free-text entity query"),
      entityTypes: z.array(z.string()).optional().describe("Optional filter by entity type ontology terms (e.g. protein:MI:0326)"),
      taxonomyIds: z.array(z.string()).optional().describe("Optional filter by NCBI taxonomy IDs (e.g. 9606 for human)"),
      ontologyTerms: z.array(z.string()).optional().describe("Optional canonical ontology term IDs (GO, MI, OM, HP, KW) to filter entity annotations"),
      sources: z.array(z.string()).optional().describe("Optional filter by data source prefixes"),
    }),
    execute: async ({ query, entityTypes, taxonomyIds, ontologyTerms, sources }: {
      query: string;
      entityTypes?: string[];
      taxonomyIds?: string[];
      ontologyTerms?: string[];
      sources?: string[];
    }) => {
      console.log(`Searching entities for: ${query}`);
      try {
        const filters: SearchFilters = {};
        if (entityTypes?.length) filters.entity_types = entityTypes;
        if (taxonomyIds?.length) filters.ncbi_tax_id = taxonomyIds;
        if (sources?.length) filters.sources = sources;
        const normalizedOntologyTerms = await normalizeOntologyFilterValues(ontologyTerms);
        if (normalizedOntologyTerms?.length) {
          filters.ontology_terms = normalizedOntologyTerms;
        }

        const data = await searchEntities({
          query,
          offset: 0,
          filters
        });

        const hits = (data.hits || []) as unknown as EntityHit[];
        console.log(`Search returned ${hits.length} results.`);
        console.log('Sample hit for preview:', JSON.stringify(hits[0], null, 2));

        // AI intelligently selects the best match
        let bestMatchId: string | undefined = undefined;

        if (hits.length > 0) {
          const queryLower = query.toLowerCase();
          const queryTokens = queryLower
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 1 && !["protein", "gene", "interactions", "interaction", "involving", "find", "all"].includes(token));

          let bestScore = -1;
          let bestHit: EntityHit | null = null;

          for (let i = 0; i < Math.min(hits.length, 50); i++) {
            const hit = hits[i];
            let score = Math.max(1, 50 - i);
            const candidates = [
              hit.display_name,
              hit.gene_symbol,
              hit.gene_symbols?.[0],
              hit.names?.[0],
              getCanonicalIdentifier(hit),
            ]
              .filter((v): v is string => typeof v === "string" && v.length > 0)
              .map((v) => v.toLowerCase());

            const description = (hit.description || hit.descriptions?.[0] || "").toLowerCase();

            if (candidates.some((v) => v === queryLower)) score += 100;
            else if (queryTokens.some((token) => candidates.includes(token))) score += 90;
            else if (candidates.some((v) => v.startsWith(queryLower))) score += 50;
            else if (candidates.some((v) => v.includes(queryLower))) score += 25;

            if ((hit.interaction_ids?.length || hit.num_interactions || 0) > 100) score += 10;
            if (description.length > 100) score += 5;

            if (score > bestScore) {
              bestScore = score;
              bestHit = hit;
            }
          }

          if (bestHit) {
            bestMatchId = getEntityDbId(bestHit);
          }
        }

        const preview = hits.slice(0, 3).map((entity, index) => {
          return {
            id: getEntityDbId(entity) ?? `entity-${index}`,
            name: getEntityName(entity),
            type: getEntityType(entity),
            canonical_identifier: getCanonicalIdentifier(entity),
            interaction_count: entity.interaction_ids?.length || entity.num_interactions || 0,
          };
        });

        return {
          componentParams: {
            query,
            bestMatchId,
          },
          preview,
          stats: {
            totalCount: data.estimatedTotalHits || hits.length,
            hasMore: hits.length < (typeof data.estimatedTotalHits === 'number' ? data.estimatedTotalHits : hits.length),
          },
          results: preview,
          totalCount: data.estimatedTotalHits || hits.length,
          searchType: "entities",
          query,
          bestMatchId,
        };
      } catch (error: unknown) {
        console.error("Error searching entities:", error);
        return { error: error instanceof Error ? error.message : 'Unknown search error' };
      }
    },
  },

  resolveEntityIdentifiers: {
    description: `Resolve raw identifiers, gene symbols, or accessions to canonical OmniPath entity IDs.
Use this for exact entity lookup and before anchored interaction or association searches.
Prefer this over broad entity search whenever the user names a concrete gene, protein, accession, or identifier.
Returned entity IDs are canonical strings, not numeric IDs.`,
    inputSchema: z.object({
      identifiers: z.array(z.string()).min(1).max(100).describe("Identifiers to resolve, such as TP53, EGFR, P04637, or other known accessions"),
    }),
    execute: async ({ identifiers }: { identifiers: string[] }) => {
      console.log(`Resolving ${identifiers.length} identifiers.`);
      try {
        const normalizedIdentifiers = identifiers.map((identifier) => identifier.trim()).filter((identifier) => identifier.length > 0);
        const responseData = await resolveEntityIdentifiersQuery(normalizedIdentifiers) as {
          matches?: Array<{ identifier: string; entityIds: string[] }>;
          entities?: EntityHit[];
        };
        const matches = responseData.matches || [];
        const entities = (responseData.entities || []) as EntityHit[];
        const entityMap = new Map<string, EntityHit>();
        for (const entity of entities) {
          const entityId = getEntityDbId(entity);
          if (entityId !== undefined) {
            entityMap.set(String(entityId), entity);
          }
        }

        const preview = matches.slice(0, 5).map((match) => {
          const topEntity = match.entityIds
            .map((entityId) => entityMap.get(entityId))
            .find((entity): entity is EntityHit => Boolean(entity));

          return {
            identifier: match.identifier,
            entityIds: match.entityIds,
            candidateCount: match.entityIds.length,
            topMatch: topEntity ? getEntityName(topEntity) : undefined,
            topEntityId: topEntity ? String(getEntityDbId(topEntity)) : (match.entityIds[0] || undefined),
          };
        });

        return {
          componentParams: {
            identifiers: normalizedIdentifiers,
          },
          matches,
          entities,
          preview,
          results: preview,
          totalCount: matches.length,
        };
      } catch (error: unknown) {
        console.error("Error resolving entity identifiers:", error);
        return { error: error instanceof Error ? error.message : "Unknown identifier resolution error" };
      }
    },
  },

  searchOntologyTerms: {
    description: `Search ontology terms by human-readable names or synonyms and return matching ontology accessions.
Use this when the user gives free-text biological concepts like dephosphorylation, phosphorylation, nucleus, seizure, or apoptotic process.
Prefer MI prefix for interaction-level mechanism terms, GO/HP/KW/OM prefixes for participant-level annotations.`,
    inputSchema: z.object({
      queries: z.array(z.string()).min(1).max(20).describe("Free-text ontology concepts to resolve, such as dephosphorylation, nucleus, seizure, or apoptotic process"),
      prefixes: z.array(z.enum(["GO", "MI", "OM", "HP", "KW"])).optional().describe("Optional ontology prefixes to constrain matching. Use MI for interaction-level mechanism lookup, GO/HP/KW/OM for participant-level annotation lookup."),
      limit: z.number().int().min(1).max(20).optional().describe("Maximum matches per query"),
    }),
    execute: async ({ queries, prefixes, limit }: { queries: string[]; prefixes?: Array<"GO" | "MI" | "OM" | "HP" | "KW">; limit?: number }) => {
      console.log(`Searching ontology terms for ${queries.length} queries.`);
      try {
        const normalizedQueries = queries.map((query) => query.trim()).filter((query) => query.length > 0);
        const response = await fetch(`${getApiServiceUrl()}/terms/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: normalizedQueries, prefixes, limit: limit ?? 5 }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`API service error: ${response.status} ${text}`);
        }

        const data = (await response.json()) as OntologySearchResponse;
        const results = normalizedQueries.flatMap((query) =>
          (data.results?.[query] || []).map((match) => ({
            query,
            ...match,
          })),
        );

        return {
          componentParams: {
            queries: normalizedQueries,
            prefixes,
            limit: limit ?? 5,
          },
          matchesByQuery: data.results || {},
          results,
          totalCount: results.length,
        };
      } catch (error: unknown) {
        console.error("Error searching ontology terms:", error);
        return { error: error instanceof Error ? error.message : "Unknown ontology term search error" };
      }
    },
  },

  resolveOntologyTerms: {
    description: `Resolve canonical ontology term IDs to labels, definitions, and namespaces.
Use this when you already know the concrete IDs like GO:0005634, HP:0001250, MI:0217, or OM:0310.
Prefer searchOntologyTerms first when the user only provides free-text ontology names.`,
    inputSchema: z.object({
      termIds: z.array(z.string()).min(1).max(100).describe("Canonical ontology term IDs to validate"),
    }),
    execute: async ({ termIds }: { termIds: string[] }) => {
      console.log(`Resolving ${termIds.length} ontology terms.`);
      try {
        const normalizedTermIds = termIds.map((termId) => termId.trim()).filter((termId) => termId.length > 0);
        const data = await resolveOntologyTermsQuery(normalizedTermIds);
        const results = normalizedTermIds.map((termId) => {
          const term = data[termId]
            ? {
                name: data[termId].label,
                definition: data[termId].definition,
                namespace: data[termId].namespace,
              }
            : null;
          return {
            termId,
            found: Boolean(term),
            name: term?.name || null,
            definition: term?.definition || null,
            namespace: term?.namespace || null,
          };
        });

        return {
          componentParams: {
            termIds: normalizedTermIds,
          },
          results,
          totalCount: results.length,
        };
      } catch (error: unknown) {
        console.error("Error resolving ontology terms:", error);
        return { error: error instanceof Error ? error.message : "Unknown ontology term resolution error" };
      }
    },
  },

  exploreOntologyTree: {
    description: `Build a merged ontology tree for canonical ontology term IDs.
Use this after resolveOntologyTerms when you want to inspect broader or narrower branches for known IDs.`,
    inputSchema: z.object({
      termIds: z.array(z.string()).min(1).max(100).describe("Canonical ontology term IDs to merge into a tree"),
    }),
    execute: async ({ termIds }: { termIds: string[] }) => {
      console.log(`Building ontology tree for ${termIds.length} terms.`);
      try {
        const normalizedTermIds = termIds.map((termId) => termId.trim()).filter((termId) => termId.length > 0);
        const root = await exploreOntologyTreeQuery(normalizedTermIds);

        return {
          componentParams: {
            termIds: normalizedTermIds,
          },
          root,
          results: root ? [root] : [],
          totalCount: root ? 1 : 0,
        };
      } catch (error: unknown) {
        console.error("Error building ontology tree:", error);
        return { error: error instanceof Error ? error.message : "Unknown ontology tree error" };
      }
    },
  },

  searchInteractions: {
    description: `Search for molecular interactions.
IMPORTANT: The interactions index cannot anchor on entity names directly; anchored searches must filter by canonical entity ID strings.
If the user mentions a concrete gene, protein, accession, or identifier, first call resolveEntityIdentifiers and then pass the returned string IDs here.
Do not use broad entity search as a substitute for identifier resolution when anchoring an interaction query.`,
    inputSchema: z.object({
      entityIds: z.array(z.string()).optional().describe("Canonical string entity IDs to filter interactions by. Use resolveEntityIdentifiers first for anchored searches."),
      interactionTypes: z.array(z.string()).optional().describe("Optional filter by canonical interaction type values (for example 'protein:MI:0326|protein:MI:0326'). These are pair/type values, not annotation terms."),
      interactionAnnotationTerms: z.array(z.string()).optional().describe("Optional interaction-level annotation terms. Use MI terms only."),
      participantAnnotationTermsGo: z.array(z.string()).optional().describe("Optional participant-level GO annotation terms."),
      participantAnnotationTermsMi: z.array(z.string()).optional().describe("Optional participant-level MI annotation terms."),
      participantAnnotationTermsOm: z.array(z.string()).optional().describe("Optional participant-level OM annotation terms."),
      participantAnnotationTermsHp: z.array(z.string()).optional().describe("Optional participant-level HP annotation terms."),
      participantAnnotationTermsKw: z.array(z.string()).optional().describe("Optional participant-level KW annotation terms."),
      hasDirection: z.boolean().optional().describe("Optional filter for directed (true) or undirected (false) interactions."),
      isPositive: z.boolean().optional().describe("Optional filter for positive (activation/upregulation) interactions."),
      isNegative: z.boolean().optional().describe("Optional filter for negative (inhibition/downregulation) interactions."),
      sources: z.array(z.string()).optional().describe("Optional filter by data source prefixes"),
    }),
    execute: async ({ entityIds, interactionTypes, interactionAnnotationTerms, participantAnnotationTermsGo, participantAnnotationTermsMi, participantAnnotationTermsOm, participantAnnotationTermsHp, participantAnnotationTermsKw, hasDirection, isPositive, isNegative, sources }: {
      entityIds?: string[];
      interactionTypes?: string[];
      interactionAnnotationTerms?: string[];
      participantAnnotationTermsGo?: string[];
      participantAnnotationTermsMi?: string[];
      participantAnnotationTermsOm?: string[];
      participantAnnotationTermsHp?: string[];
      participantAnnotationTermsKw?: string[];
      hasDirection?: boolean;
      isPositive?: boolean;
      isNegative?: boolean;
      sources?: string[];
    }) => {
      console.log(`Searching interactions.`);
      try {
        // Build the request with filters
        const apiFilters: SearchFilters = {};

        // Add entity IDs filter if provided
        if (entityIds && entityIds.length > 0) {
          apiFilters.entity_ids = entityIds.map((id) => String(id));
        }

        const [
          normalizedInteractionAnnotationTerms,
          normalizedParticipantAnnotationTermsGo,
          normalizedParticipantAnnotationTermsMi,
          normalizedParticipantAnnotationTermsOm,
          normalizedParticipantAnnotationTermsHp,
          normalizedParticipantAnnotationTermsKw,
        ] = await Promise.all([
          normalizeOntologyFilterValues(interactionAnnotationTerms),
          normalizeOntologyFilterValues(participantAnnotationTermsGo),
          normalizeOntologyFilterValues(participantAnnotationTermsMi),
          normalizeOntologyFilterValues(participantAnnotationTermsOm),
          normalizeOntologyFilterValues(participantAnnotationTermsHp),
          normalizeOntologyFilterValues(participantAnnotationTermsKw),
        ]);

        if (interactionTypes?.length) apiFilters.interaction_types = interactionTypes;
        if (normalizedInteractionAnnotationTerms?.length) apiFilters.interaction_annotation_terms = normalizedInteractionAnnotationTerms;
        const mergedParticipantAnnotationTerms = [
          ...(normalizedParticipantAnnotationTermsGo || []),
          ...(normalizedParticipantAnnotationTermsMi || []),
          ...(normalizedParticipantAnnotationTermsOm || []),
          ...(normalizedParticipantAnnotationTermsHp || []),
          ...(normalizedParticipantAnnotationTermsKw || []),
        ];
        if (mergedParticipantAnnotationTerms.length) {
          apiFilters.participant_annotation_terms = Array.from(new Set(mergedParticipantAnnotationTerms));
        }
        if (hasDirection !== undefined) apiFilters.is_directed = hasDirection;
        if (isPositive) apiFilters.signs = [...(apiFilters.signs || []), 1];
        if (isNegative) apiFilters.signs = [...(apiFilters.signs || []), -1];
        if (sources?.length) apiFilters.sources = sources;

        const data = await searchInteractions("", apiFilters, 20, 0);

        const hits = (data.hits || []) as InteractionHit[];
        console.log(`Interaction search returned ${hits.length} results.`);

        // Extract and format facet statistics for AI analysis
        const facetStats = (data.facetDistribution || {}) as Record<string, Record<string, number>>;

        // Support both old and new facet keys depending on index version
        const formattedFacets = {
          interactionTypes: facetStats['interaction_types_facet'] || facetStats['interaction_type'] || {},
          dataSources: facetStats['data_sources_facet'] || facetStats['sources'] || {},
          detectionMethods: facetStats['detection_methods_facet'] || {},
          causalStatements: facetStats['causal_statements_facet'] || {},
          causalMechanisms: facetStats['causal_mechanisms_facet'] || {},
          interactorTypes: facetStats['interactor_types_facet'] || {},
          signs: facetStats['sign'] || facetStats['signs'] || {},
          consensusSign: facetStats['consensus_sign'] || {
            positive: facetStats['sign']?.['1'] || 0,
            negative: facetStats['sign']?.['-1'] || 0,
            unsigned: facetStats['sign']?.['0'] || 0,
          },
          isDirected: facetStats['is_directed'] || {},
          consensusDirection: facetStats['consensus_direction'] || {},
          evidenceCountDistribution: facetStats['evidence_count'] || {}
        };

        // Calculate summary statistics from facets
        const summaryStats = {
          totalInteractions: data.estimatedTotalHits || hits.length,
          uniqueInteractionTypes: Object.keys(formattedFacets.interactionTypes).length,
          uniqueDataSources: Object.keys(formattedFacets.dataSources).length,
          uniqueDetectionMethods: Object.keys(formattedFacets.detectionMethods).length,
          directedInteractions: formattedFacets.isDirected['true'] || 0,
          undirectedInteractions: formattedFacets.isDirected['false'] || 0,
          // Top categories
          topInteractionTypes: Object.entries(formattedFacets.interactionTypes)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 5)
            .map(([name, count]) => ({ name, count })),
          topDataSources: Object.entries(formattedFacets.dataSources)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 5)
            .map(([name, count]) => ({ name, count })),
          topDetectionMethods: Object.entries(formattedFacets.detectionMethods)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }))
        };

        const exampleInteractions = hits.slice(0, 2).map((hit) => ({
          participants: getInteractionParticipantsLabel(hit),
          type: getInteractionTypeLabel(hit),
          evidences: hit.interaction.evidenceCount || 0,
        }));

        return {
          componentParams: {
            entityIds,
            interactionTypes,
            interactionAnnotationTerms,
            participantAnnotationTermsGo,
            participantAnnotationTermsMi,
            participantAnnotationTermsOm,
            participantAnnotationTermsHp,
            participantAnnotationTermsKw,
            normalizedInteractionAnnotationTerms,
            normalizedParticipantAnnotationTermsGo,
            normalizedParticipantAnnotationTermsMi,
            normalizedParticipantAnnotationTermsOm,
            normalizedParticipantAnnotationTermsHp,
            normalizedParticipantAnnotationTermsKw,
            hasDirection,
            isPositive,
            isNegative,
            sources,
          },
          facetStatistics: formattedFacets,
          summary: summaryStats,
          exampleInteractions,
          // Keep a generic results field for tool UI compatibility
          results: exampleInteractions,
          totalCount: data.estimatedTotalHits || hits.length,
          entityIds: entityIds?.map((id) => String(id)),
        };
      } catch (error: unknown) {
        console.error("Error searching interactions:", error);
        return { error: error instanceof Error ? error.message : 'Unknown search error' };
      }
    },
  },

  searchAssociations: {
    description: `Search for associations (complex memberships, pathways, and reactions).
IMPORTANT: The associations index does NOT search by abstract entity names. Use resolveEntityIdentifiers first.`,
    inputSchema: z.object({
      parentEntityIds: z.array(z.string()).optional().describe("IDs of the parent entity (e.g. the Complex ID)."),
      memberEntityIds: z.array(z.string()).optional().describe("IDs of the member entities (e.g. a specific protein in the complex)."),
      parentEntityTypes: z.array(z.string()).optional().describe("Ontology terms for the parent (e.g. 'complex:MI:0314')."),
      memberEntityTypes: z.array(z.string()).optional().describe("Ontology terms for the members."),
      ontologyTerms: z.array(z.string()).optional().describe("Association annotation terms."),
      sources: z.array(z.string()).optional().describe("Source prefixes."),
    }),
    execute: async ({ parentEntityIds, memberEntityIds, parentEntityTypes, memberEntityTypes, ontologyTerms, sources }: {
      parentEntityIds?: string[];
      memberEntityIds?: string[];
      parentEntityTypes?: string[];
      memberEntityTypes?: string[];
      ontologyTerms?: string[];
      sources?: string[];
    }) => {
      console.log(`Searching associations.`);
      try {
        const apiFilters: SearchFilters = {};
        const normalizedOntologyTerms = await normalizeOntologyFilterValues(ontologyTerms);

        if (parentEntityIds?.length) apiFilters.parent_entity_ids = parentEntityIds;
        if (memberEntityIds?.length) apiFilters.member_entity_ids = memberEntityIds;
        if (parentEntityTypes?.length) apiFilters.parent_entity_types = parentEntityTypes;
        if (memberEntityTypes?.length) apiFilters.member_entity_types = memberEntityTypes;
        if (normalizedOntologyTerms?.length) apiFilters.association_annotation_terms = normalizedOntologyTerms;
        if (sources?.length) apiFilters.sources = sources;

        const data = await searchAssociations("", apiFilters, 20, 0);
        const hits = (data.hits || []) as AssociationHit[];

        const exampleAssociations = hits.slice(0, 5).map((hit) => ({
          parent: getEntityDisplayName(hit.parent) || getEntityPublicId(hit.parent),
          member: getEntityDisplayName(hit.member) || getEntityPublicId(hit.member),
          parentType: getEntityTypeLabel(hit.parent),
          memberType: getEntityTypeLabel(hit.member),
        }));

        const facetStats = (data.facetDistribution || {}) as Record<string, Record<string, number>>;

        return {
          totalCount: data.estimatedTotalHits || hits.length,
          exampleAssociations,
          facetStatistics: {
            parentEntityTypes: facetStats['parent_entity_type'] || {},
            memberEntityTypes: facetStats['member_entity_type'] || {},
            sources: facetStats['sources'] || {},
            associationAnnotationTerms: facetStats['association_annotation_terms'] || {},
          },
        };
      } catch (error: unknown) {
        console.error("Error searching associations:", error);
        return { error: error instanceof Error ? error.message : 'Unknown search error' };
      }
    },
  },
};

const safeSerialize = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages } = requestSchema.parse(body);

    const uiMessages = await validateUIMessages<UIMessage>({ messages });

    const normalizedMessages: UIMessage[] = uiMessages.filter((message) =>
      message.parts.some((part) => part.type !== "text" || part.text.length > 0),
    );

    // Add system message if not present
    if (!normalizedMessages.some((m) => m.role === "system")) {
      normalizedMessages.unshift({
        id: crypto.randomUUID(),
        role: "system",
        parts: [{
          type: "text", text: `You are OmniPath AI, an assistant for exploring molecular interactions, pathways, complexes, and ontology annotations in OmniPath.

Today is ${new Date().toLocaleDateString()}.

Use the available tools and follow their schemas carefully.

High-level rules:
- Treat the app as a workspace with Results, Refine, and Chat panes.
- Treat entities, interactions, and selection as Results modes inside the workspace.
- Prefer workspace-style navigation and URL-backed result state over referring to separate pages.
- For exact genes, proteins, accessions, or identifiers, resolve canonical entity IDs before doing anchored interaction or association searches.
- For free-text ontology concepts, search ontology terms first instead of inventing IDs.
- Treat interaction-level MI mechanisms separately from participant-level annotations.
- If the user asks for both an interaction mechanism and participant annotation constraints, apply both.
- Prefer opening or using Refine when the task is mainly about filters or ontology refinement.
- Prefer the most direct tool path that answers the question.

When presenting results:
- This chat is primarily a navigation/controller layer, not a result-reporting surface.
- Do not summarize tool results unless the user explicitly asks for a summary, interpretation, comparison, or explanation.
- By default, keep post-tool text minimal and action-oriented.
- After tool use, prefer a very short acknowledgement such as "Opened the matching result set." or "Found a matching interaction result set." instead of listing findings.
- Only provide substantive result summaries when the user explicitly asks for them.
- Do not end responses with a call to action, follow-up invitation, or phrases like "let me know if you want more details".
` }],
      });
    }

    const modelMessages = await convertToModelMessages(normalizedMessages);
    const chatModel = getChatModel();

    console.log("Chat request debug:", {
      provider: chatModel.provider,
      rawMessages: safeSerialize(messages),
      uiMessages: safeSerialize(uiMessages),
      normalizedMessages: safeSerialize(normalizedMessages),
      modelMessages: safeSerialize(modelMessages),
    });

    const stream = streamText({
      model: chatModel.model,
      messages: modelMessages,
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(15),
      onFinish: async (result) => {
        // Here you could save the chat history if needed
        console.log("Chat completed with result:", {
          provider: chatModel.provider,
          finishReason: result.finishReason,
          steps: result.steps?.length,
          usage: result.usage,
        });
        console.log("Chat completion debug:", safeSerialize({
          provider: chatModel.provider,
          finishReason: result.finishReason,
          usage: result.usage,
          text: result.text,
          reasoningText: result.reasoningText,
          content: result.content,
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
          steps: result.steps,
          response: result.response,
        }));
      },
      temperature: 0.3,
    });

    return stream.toUIMessageStreamResponse({
      headers: {
        'Transfer-Encoding': 'chunked',
        Connection: 'keep-alive',
      },
      sendReasoning: true,
      onError: (error) => {
        console.error("Chat stream error:", error);

        const maybeStatusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
        const maybeMessage = error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "An error occurred, please try again!";

        if (maybeStatusCode === 429 || maybeMessage.toLowerCase().includes("tokens per minute limit exceeded")) {
          return "The model provider hit its token-per-minute rate limit. Please wait about a minute and try again.";
        }

        return "An error occurred, please try again!";
      },
    });

  } catch (error: unknown) {
    console.error("Error in chat endpoint:", error);
    return new Response("Failed to process chat request", { status: 500 });
  }
}
