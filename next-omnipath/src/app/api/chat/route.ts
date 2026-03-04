import { cerebras } from "@/ai";
import { convertToModelMessages, smoothStream, stepCountIs, streamText, validateUIMessages } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import {
  searchMeilisearch,
  searchInteractionsMeilisearch,
  searchAssociationsMeilisearch
} from "@/lib/meilisearch/search";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { INDEXES } from "@/lib/meilisearch/client";


// Define types for Meilisearch hits
interface EntityHit {
  id: string | number;
  entity_id?: string | number;
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

interface CVTermHit {
  id: string | number;
  name?: string;
  definition?: string;
  namespace?: { name?: string } | string;
  associated_entity_ids?: unknown[];
  [key: string]: unknown;
}

interface AssociationHit {
  id?: string | number;
  association_key?: string;
  parent_entity_id?: string;
  parent_name?: string;
  parent_entity_type?: string;
  member_entity_id?: string;
  member_name?: string;
  member_entity_type?: string;
  [key: string]: unknown;
}

interface InteractionHit {
  id: string | number;
  entity_a_name?: string;
  entity_a_canonical_id?: string;
  entity_b_name?: string;
  entity_b_canonical_id?: string;
  interaction_types?: Array<{ name?: string }>;
  evidence_count?: number;
  [key: string]: unknown;
}

const requestSchema = z.object({
  messages: z.array(z.unknown()),
});

// Define the tools
const tools = {
  searchEntities: {
    description: `Search for biological entities (proteins, genes, complexes) or controlled vocabulary terms using Meilisearch.
This is a fast full-text search that can find entities by name, identifier, or description.

INDEX SELECTION GUIDE:
- Use 'entities' for: protein names, gene symbols, complexes, UniProt IDs, or when user asks about proteins/genes
- Use 'cv_terms' for: ontology terms (GO, DO, HP, etc.), biological processes, molecular functions, cellular components, diseases, phenotypes

Examples:
- "insulin" → entities (protein/gene)
- "P53" or "TP53" → entities (protein/gene symbol)
- "kinase" → entities (protein family)
- "apoptosis" → cv_terms (biological process)
- "GO:0006915" → cv_terms (GO term ID)
- "cancer" → cv_terms (disease term)
- "mitochondria" → cv_terms (cellular component)`,
    inputSchema: z.object({
      query: z.string().describe("The search query (protein name, gene symbol, identifier, or description)"),
      searchType: z.enum(["entities", "cv_terms"]).default("entities").describe("What to search for: 'entities' (proteins/genes/complexes) or 'cv_terms' (controlled vocabulary terms like GO, DO, etc.)"),
      limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return (1-100)"),
      entityTypes: z.array(z.string()).optional().describe("Optional filter by entity type ontology terms (e.g. protein:MI:0326)"),
      taxonomyIds: z.array(z.string()).optional().describe("Optional filter by NCBI taxonomy IDs (e.g. 9606 for human)"),
      ontologyTerms: z.array(z.string()).optional().describe("Optional filter by broad ontology terms (GO, MI, OM, HP, KW)"),
      sources: z.array(z.string()).optional().describe("Optional filter by data source prefixes"),
    }),
    execute: async ({ query, searchType, limit, entityTypes, taxonomyIds, ontologyTerms, sources }: {
      query: string;
      searchType: "entities" | "cv_terms";
      limit: number;
      entityTypes?: string[];
      taxonomyIds?: string[];
      ontologyTerms?: string[];
      sources?: string[];
    }) => {
      console.log(`Searching ${searchType} for: ${query}`);
      try {
        const filters: MeilisearchFilters = {};
        if (entityTypes?.length) filters.entity_types = entityTypes;
        if (taxonomyIds?.length) filters.ncbi_tax_id = taxonomyIds;
        if (sources?.length) filters.sources = sources;
        if (ontologyTerms?.length) {
          // Broadly search across all cv_terms
          filters.cv_terms_go = ontologyTerms;
          filters.cv_terms_mi = ontologyTerms;
          filters.cv_terms_om = ontologyTerms;
          filters.cv_terms_hp = ontologyTerms;
          filters.cv_terms_kw = ontologyTerms;
        }

        // Use the common ENTITIES index for both types
        // We could add filters here if needed to distinguish between entities and cv_terms
        // but for now we'll rely on the query matching relevant documents
        const data = await searchMeilisearch({
          query,
          index: INDEXES.ENTITIES,
          limit,
          offset: 0,
          filters
        });

        const hits = (data.hits || []) as (EntityHit | CVTermHit)[];
        console.log(`Search returned ${hits.length} results.`);
        console.log('Sample hit for preview:', JSON.stringify(hits[0], null, 2));

        const getEntityDbId = (hit: EntityHit): string | number | undefined => hit.entity_id ?? hit.id;

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

        // AI intelligently selects the best match
        let bestMatchId: string | number | undefined = undefined;

        if (hits.length > 0) {
          const queryLower = query.toLowerCase();
          const queryTokens = queryLower
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 1 && !["protein", "gene", "interactions", "interaction", "involving", "find", "all"].includes(token));

          let bestScore = -1;
          let bestHit: EntityHit | CVTermHit | null = null;

          for (let i = 0; i < Math.min(hits.length, 50); i++) {
            const hit = hits[i];
            let score = Math.max(1, 50 - i);

            if (searchType === "entities") {
              const entityHit = hit as EntityHit;
              const candidates = [
                entityHit.display_name,
                entityHit.gene_symbol,
                entityHit.gene_symbols?.[0],
                entityHit.names?.[0],
                getCanonicalIdentifier(entityHit),
              ]
                .filter((v): v is string => typeof v === "string" && v.length > 0)
                .map((v) => v.toLowerCase());

              const description = (entityHit.description || entityHit.descriptions?.[0] || "").toLowerCase();

              if (candidates.some((v) => v === queryLower)) score += 100;
              else if (queryTokens.some((token) => candidates.includes(token))) score += 90;
              else if (candidates.some((v) => v.startsWith(queryLower))) score += 50;
              else if (candidates.some((v) => v.includes(queryLower))) score += 25;

              if ((entityHit.interaction_ids?.length || entityHit.num_interactions || 0) > 100) score += 10;
              if (description.length > 100) score += 5;
            } else {
              const cvHit = hit as CVTermHit;
              const name = (cvHit.name || "").toLowerCase();
              const definition = (cvHit.definition || "").toLowerCase();

              if (name === queryLower) score += 100;
              else if (name.startsWith(queryLower)) score += 50;
              else if (name.includes(queryLower)) score += 25;

              if (cvHit.associated_entity_ids && cvHit.associated_entity_ids.length > 10) score += 10;
              if (definition.length > 50) score += 5;
            }

            if (score > bestScore) {
              bestScore = score;
              bestHit = hit;
            }
          }

          if (bestHit) {
            bestMatchId = searchType === "entities"
              ? getEntityDbId(bestHit as EntityHit)
              : bestHit.id;
          }
        }

        const preview = hits.slice(0, 3).map((hit: EntityHit | CVTermHit, index) => {
          if (searchType === "entities") {
            const entity = hit as EntityHit;
            return {
              id: getEntityDbId(entity) ?? `entity-${index}`,
              name: getEntityName(entity),
              type: getEntityType(entity),
              canonical_identifier: getCanonicalIdentifier(entity),
              interaction_count: entity.interaction_ids?.length || entity.num_interactions || 0,
            };
          }

          const cv = hit as CVTermHit;
          return {
            id: cv.id,
            name: cv.name || `Term ${cv.id}`,
            type: (typeof cv.namespace === 'object' ? cv.namespace?.name : cv.namespace) || 'term',
            associated_entities: cv.associated_entity_ids?.length || 0,
          };
        });

        return {
          componentParams: {
            searchType,
            query,
            limit,
            bestMatchId,
          },
          preview,
          stats: {
            totalCount: data.estimatedTotalHits || hits.length,
            hasMore: hits.length < (typeof data.estimatedTotalHits === 'number' ? data.estimatedTotalHits : hits.length),
          },
          results: preview,
          totalCount: data.estimatedTotalHits || hits.length,
          searchType,
          query,
          bestMatchId,
        };
      } catch (error: unknown) {
        console.error("Error searching entities:", error);
        return { error: error instanceof Error ? error.message : 'Unknown search error' };
      }
    },
  },

  searchInteractions: {
    description: `Search for molecular interactions.
IMPORTANT: The interactions index CANNOT search by entity names directly - it only supports filtering by entity IDs.
To find interactions for a specific protein/gene:
1. First use searchEntities to find the entity and get its ID
2. Then use this tool with the entity ID`,
    inputSchema: z.object({
      entityIds: z.array(z.union([z.string(), z.number()])).optional().describe("Entity IDs to filter interactions by. Use searchEntities first to get these IDs if you want to anchor to a specific protein."),
      limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return (1-100)"),
      interactionTypes: z.array(z.string()).optional().describe("Optional filter by interaction types (e.g. 'protein:MI:0326|protein:MI:0326' or just a specific term if known)"),
      ontologyTerms: z.array(z.string()).optional().describe("Optional filter by annotation terms (GO, MI, HP, OM, KW) found on the interaction or participants. E.g. 'MI:0217' for phosphorylation."),
      hasDirection: z.boolean().optional().describe("Optional filter for directed (true) or undirected (false) interactions."),
      isPositive: z.boolean().optional().describe("Optional filter for positive (activation/upregulation) interactions."),
      isNegative: z.boolean().optional().describe("Optional filter for negative (inhibition/downregulation) interactions."),
      sources: z.array(z.string()).optional().describe("Optional filter by data source prefixes"),
    }),
    execute: async ({ entityIds, limit, interactionTypes, ontologyTerms, hasDirection, isPositive, isNegative, sources }: {
      entityIds?: Array<string | number>;
      limit: number;
      interactionTypes?: string[];
      ontologyTerms?: string[];
      hasDirection?: boolean;
      isPositive?: boolean;
      isNegative?: boolean;
      sources?: string[];
    }) => {
      console.log(`Searching interactions.`);
      try {
        // Build the request with filters
        const apiFilters: MeilisearchFilters = {};

        // Add entity IDs filter if provided
        if (entityIds && entityIds.length > 0) {
          apiFilters.entity_ids = entityIds.map((id) => String(id));
        }

        if (interactionTypes?.length) apiFilters.interaction_types = interactionTypes;
        if (hasDirection !== undefined) apiFilters.has_direction = hasDirection;
        if (isPositive !== undefined) apiFilters.has_positive_sign = isPositive;
        if (isNegative !== undefined) apiFilters.has_negative_sign = isNegative;
        if (sources?.length) apiFilters.sources = sources;
        if (ontologyTerms?.length) {
          apiFilters.interaction_annotation_terms = ontologyTerms;
          apiFilters.participant_annotation_terms_go = ontologyTerms;
          apiFilters.participant_annotation_terms_hp = ontologyTerms;
          apiFilters.participant_annotation_terms_mi = ontologyTerms;
          apiFilters.participant_annotation_terms_om = ontologyTerms;
          apiFilters.participant_annotation_terms_kw = ontologyTerms;
        }

        const requestParams = {
          query: "", // Interactions index doesn't support text search
          limit,
          offset: 0,
          index: INDEXES.INTERACTIONS,
          filters: apiFilters,
        };

        const data = await searchInteractionsMeilisearch(requestParams);

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
          signs: facetStats['signs'] || {},
          consensusSign: facetStats['consensus_sign'] || {
            positive: facetStats['has_positive_sign']?.['true'] || 0,
            negative: facetStats['has_negative_sign']?.['true'] || 0,
          },
          isDirected: facetStats['is_directed'] || facetStats['has_direction'] || {},
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

        const exampleInteractions = hits.slice(0, 2).map((hit: InteractionHit) => ({
          participants: `${hit.entity_a_name || hit.entity_a_canonical_id} - ${hit.entity_b_name || hit.entity_b_canonical_id}`,
          type: hit.interaction_types?.[0]?.name || 'interaction',
          evidences: hit.evidence_count || 0
        }));

        return {
          componentParams: {
            entityIds,
            limit
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
IMPORTANT: The associations index does NOT search by abstract entity names. Use searchEntities first.`,
    inputSchema: z.object({
      parentEntityIds: z.array(z.string()).optional().describe("IDs of the parent entity (e.g. the Complex ID)."),
      memberEntityIds: z.array(z.string()).optional().describe("IDs of the member entities (e.g. a specific protein in the complex)."),
      parentEntityTypes: z.array(z.string()).optional().describe("Ontology terms for the parent (e.g. 'complex:MI:0314')."),
      memberEntityTypes: z.array(z.string()).optional().describe("Ontology terms for the members."),
      ontologyTerms: z.array(z.string()).optional().describe("Association annotation terms."),
      sources: z.array(z.string()).optional().describe("Source prefixes."),
      limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return (1-100)"),
    }),
    execute: async ({ parentEntityIds, memberEntityIds, parentEntityTypes, memberEntityTypes, ontologyTerms, sources, limit }: {
      parentEntityIds?: string[];
      memberEntityIds?: string[];
      parentEntityTypes?: string[];
      memberEntityTypes?: string[];
      ontologyTerms?: string[];
      sources?: string[];
      limit: number;
    }) => {
      console.log(`Searching associations.`);
      try {
        const apiFilters: MeilisearchFilters = {};

        if (parentEntityIds?.length) apiFilters.parent_entity_ids = parentEntityIds;
        if (memberEntityIds?.length) apiFilters.member_entity_ids = memberEntityIds;
        if (parentEntityTypes?.length) apiFilters.parent_entity_types = parentEntityTypes;
        if (memberEntityTypes?.length) apiFilters.member_entity_types = memberEntityTypes;
        if (ontologyTerms?.length) apiFilters.association_annotation_terms = ontologyTerms;
        if (sources?.length) apiFilters.sources = sources;

        const requestParams = {
          query: "",
          limit,
          offset: 0,
          index: INDEXES.ASSOCIATIONS,
          filters: apiFilters,
        };

        const data = await searchAssociationsMeilisearch(requestParams);
        const hits = (data.hits || []) as AssociationHit[];

        const exampleAssociations = hits.slice(0, 5).map(hit => ({
          parent: hit.parent_name || hit.parent_entity_id,
          member: hit.member_name || hit.member_entity_id,
          parentType: hit.parent_entity_type,
          memberType: hit.member_entity_type,
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
          type: "text", text: `You are OmniPath AI, a powerful assistant for OmniPath, a database of molecular interactions, pathways, and biological annotations.

Your capabilities:
1. Search Entities: Find proteins, genes, complexes, or resolve ontology terms (searchType="cv_terms").
2. Search Interactions: Find directed/undirected, positive/negative edges, filtered by entity, ontology term, or source.
3. Search Associations: Find complex memberships, pathways, and reactions.

Today's date is ${new Date().toLocaleDateString()}.

CRITICAL: EXPLORATION WORKFLOW
Users often ask vague queries (e.g., "phosphorylation interactions"). You don't always need a specific anchor protein!
To handle abstract concepts:
1. Resolve the abstract term FIRST. Call searchEntities with \`searchType: "cv_terms"\` and \`query: "phosphorylation"\`.
2. Inspect the result to find its ontology ID (e.g., \`MI:0217\`).
3. Use that exact ID in the \`ontologyTerms\` filter when calling \`searchInteractions\` or \`searchAssociations\`.

CRITICAL: ANCHORED SEARCHES
If someone asks "What does EGFR interact with?" or "Interactions for TP53":
1. First use \`searchEntities\` to find the specific database ID (the numeric 'id' field, NOT a canonical identifier).
2. Call \`searchInteractions\` (or \`searchAssociations\`) using that numeric ID in \`entityIds\` (or \`parent/memberEntityIds\`).

CRITICAL: PRESENTING RESULTS
- You MUST focus on summarizing facet statistics.
- DO NOT list more than 1 or 2 interactions directly unless asked.
- Provide a summary of: total interactions/entities found, top sources, top interaction types, directionality splits, and causal info.

Example response format for a facet summary:
"I found 847 interactions. Here's an overview:
**Interaction Types:** Physical association (234), Direct interaction (189), Phosphorylation (98).
**Data Sources:** BioGRID (312), IntAct (245).
...
For example, EGFR phosphorylates STAT3."
` }],
      });
    }

    const modelMessages = await convertToModelMessages(normalizedMessages);

    const stream = streamText({
      model: cerebras("gpt-oss-120b"),
      messages: modelMessages,
      tools,
      toolChoice: "auto",
      experimental_transform: [
        smoothStream({
          chunking: "word",
        }),
      ],
      onFinish: async (result) => {
        // Here you could save the chat history if needed
        console.log("Chat completed with result:", result);
      },
      stopWhen: stepCountIs(5),
      temperature: 0.7,
    });

    return stream.toUIMessageStreamResponse({
      headers: {
        'Transfer-Encoding': 'chunked',
        Connection: 'keep-alive',
      },
      sendReasoning: true,
      onError: (error) => {
        console.error("Chat stream error:", error);
        return `An error occurred, please try again!`;
      },
    });

  } catch (error: unknown) {
    console.error("Error in chat endpoint:", error);
    return new Response("Failed to process chat request", { status: 500 });
  }
}
