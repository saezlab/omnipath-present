import { getChatModel } from "@/ai";
import { convertToModelMessages, stepCountIs, streamText, validateUIMessages } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import { getOntologyTermsByIds } from "@/lib/queries/ontology-term";
import { searchEntities } from "@/lib/queries/entity";
import { resolveEntityIdentifiers } from "@/lib/queries/entity-identifier";
import { searchRelations } from "@/lib/queries/relation";
import { getEntitiesByPks, getEntitiesByPublicIds } from "@/lib/queries/entity";
import {
  exploreOntologyTree as exploreOntologyTreeQuery,
  normalizeOntologyFilterValues,
} from "@/lib/ontology";
import { getEntityDisplayName, getEntityTypeLabel, getEntityPublicId } from "@/lib/entities/display";
import { getApiServiceUrl } from "@/lib/api/config";
import type { SearchFilters } from "@/types/search";

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

const requestSchema = z.object({
  messages: z.array(z.unknown()),
});

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
          filters,
        });

        const entities = data.entities || [];
        console.log(`Search returned ${entities.length} results.`);
        console.log('Sample hit for preview:', JSON.stringify(entities[0], null, 2));

        // AI intelligently selects the best match
        let bestMatchId: string | undefined = undefined;

        if (entities.length > 0) {
          const queryLower = query.toLowerCase();
          const queryTokens = queryLower
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 1 && !["protein", "gene", "interactions", "interaction", "involving", "find", "all"].includes(token));

          let bestScore = -1;
          let bestHit = null as typeof entities[number] | null;

          for (let i = 0; i < Math.min(entities.length, 50); i++) {
            const entity = entities[i];
            let score = Math.max(1, 50 - i);
            const candidates = [
              getEntityDisplayName(entity),
              entity.canonicalIdentifier,
            ]
              .filter((v): v is string => typeof v === "string" && v.length > 0)
              .map((v) => v.toLowerCase());

            if (candidates.some((v) => v === queryLower)) score += 100;
            else if (queryTokens.some((token) => candidates.includes(token))) score += 90;
            else if (candidates.some((v) => v.startsWith(queryLower))) score += 50;
            else if (candidates.some((v) => v.includes(queryLower))) score += 25;

            if (score > bestScore) {
              bestScore = score;
              bestHit = entity;
            }
          }

          if (bestHit) {
            bestMatchId = getEntityPublicId(bestHit);
          }
        }

        const preview = entities.slice(0, 3).map((entity, index) => {
          return {
            id: getEntityPublicId(entity),
            name: getEntityDisplayName(entity),
            type: getEntityTypeLabel(entity),
            canonical_identifier: entity.canonicalIdentifier,
            interaction_count: 0,
          };
        });

        return {
          componentParams: {
            query,
            bestMatchId,
          },
          preview,
          stats: {
            totalCount: entities.length,
            hasMore: Boolean(data.nextCursor),
          },
          results: preview,
          totalCount: entities.length,
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
        const responseData = await resolveEntityIdentifiers(normalizedIdentifiers);
        const matches = responseData.matches || [];
        const entities = responseData.entities || [];
        const entityMap = new Map<string, typeof entities[number]>();
        for (const entity of entities) {
          const entityId = getEntityPublicId(entity);
          entityMap.set(entityId, entity);
        }

        const preview = matches.slice(0, 5).map((match) => {
          const topEntity = match.entityIds
            .map((entityId) => entityMap.get(entityId))
            .find((entity): entity is typeof entities[number] => Boolean(entity));

          return {
            identifier: match.identifier,
            entityIds: match.entityIds,
            candidateCount: match.entityIds.length,
            topMatch: topEntity ? getEntityDisplayName(topEntity) : undefined,
            topEntityId: topEntity ? getEntityPublicId(topEntity) : (match.entityIds[0] || undefined),
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
        const terms = await getOntologyTermsByIds(normalizedTermIds);
        const termById = new Map(terms.map((t) => [t.termId, t]));
        const results = normalizedTermIds.map((termId) => {
          const term = termById.get(termId);
          return {
            termId,
            found: Boolean(term),
            name: term?.label || null,
            definition: term?.definition || null,
            namespace: term?.ontologyPrefix || null,
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
      ontologyTerms: z.array(z.string()).optional().describe("Optional ontology term IDs for interaction filtering. In the UI these are selected from the ontology browser."),
      hasDirection: z.boolean().optional().describe("Optional filter for directed (true) or undirected (false) interactions."),
      isPositive: z.boolean().optional().describe("Optional filter for positive (activation/upregulation) interactions."),
      isNegative: z.boolean().optional().describe("Optional filter for negative (inhibition/downregulation) interactions."),
      sources: z.array(z.string()).optional().describe("Optional filter by data source prefixes"),
    }),
    execute: async ({ entityIds, interactionTypes, ontologyTerms, sources }: {
      entityIds?: string[];
      interactionTypes?: string[];
      ontologyTerms?: string[];
      hasDirection?: boolean;
      isPositive?: boolean;
      isNegative?: boolean;
      sources?: string[];
    }) => {
      console.log(`Searching interactions.`);
      try {
        let entityPks: number[] | undefined;
        if (entityIds && entityIds.length > 0) {
          const entities = await getEntitiesByPublicIds(entityIds.map(String));
          entityPks = entities.map((e) => e.entityPk);
        }

        const { relations } = await searchRelations({
          filters: {
            relationCategories: ["interaction"],
            entityPks,
            sources,
          },
          limit: 20,
          offset: 0,
        });

        const pks = [...new Set(relations.flatMap((r) => [r.subjectEntityPk, r.objectEntityPk]))];
        const entities = pks.length > 0 ? await getEntitiesByPks(pks) : [];
        const entityByPk = new Map(entities.map((e) => [e.entityPk, e]));

        type InteractionHit = { relation: typeof relations[number]; entityA: NonNullable<ReturnType<typeof entityByPk.get>>; entityB: NonNullable<ReturnType<typeof entityByPk.get>> };
        const hits: InteractionHit[] = relations.map((r) => ({
          relation: r,
          entityA: entityByPk.get(r.subjectEntityPk),
          entityB: entityByPk.get(r.objectEntityPk),
        })).filter((h): h is InteractionHit => Boolean(h.entityA && h.entityB));

        console.log(`Interaction search returned ${hits.length} results.`);

        const exampleInteractions = hits.slice(0, 2).map((hit) => ({
          participants: `${getEntityDisplayName(hit.entityA)} - ${getEntityDisplayName(hit.entityB)}`,
          type: `${getEntityTypeLabel(hit.entityA)}-${getEntityTypeLabel(hit.entityB)}`,
          evidences: hit.relation.evidenceCount || 0,
        }));

        return {
          componentParams: {
            entityIds,
            interactionTypes,
            ontologyTerms,
            sources,
          },
          exampleInteractions,
          results: exampleInteractions,
          totalCount: hits.length,
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
    execute: async ({ parentEntityIds, memberEntityIds, sources }: {
      parentEntityIds?: string[];
      memberEntityIds?: string[];
      parentEntityTypes?: string[];
      memberEntityTypes?: string[];
      ontologyTerms?: string[];
      sources?: string[];
    }) => {
      console.log(`Searching associations.`);
      try {
        let subjectEntityPks: number[] | undefined;
        let objectEntityPks: number[] | undefined;

        if (parentEntityIds?.length) {
          const entities = await getEntitiesByPublicIds(parentEntityIds.map(String));
          subjectEntityPks = entities.map((e) => e.entityPk);
        }
        if (memberEntityIds?.length) {
          const entities = await getEntitiesByPublicIds(memberEntityIds.map(String));
          objectEntityPks = entities.map((e) => e.entityPk);
        }

        const { relations } = await searchRelations({
          filters: {
            relationCategories: ["membership"],
            subjectEntityPks,
            objectEntityPks,
            sources,
          },
          limit: 20,
          offset: 0,
        });

        const pks = [...new Set(relations.flatMap((r) => [r.subjectEntityPk, r.objectEntityPk]))];
        const entities = pks.length > 0 ? await getEntitiesByPks(pks) : [];
        const entityByPk = new Map(entities.map((e) => [e.entityPk, e]));

        type AssociationHit = { relation: typeof relations[number]; parent: NonNullable<ReturnType<typeof entityByPk.get>>; member: NonNullable<ReturnType<typeof entityByPk.get>> };
        const hits: AssociationHit[] = relations.map((r) => ({
          relation: r,
          parent: entityByPk.get(r.subjectEntityPk),
          member: entityByPk.get(r.objectEntityPk),
        })).filter((h): h is AssociationHit => Boolean(h.parent && h.member));

        const exampleAssociations = hits.slice(0, 5).map((hit) => ({
          parent: getEntityDisplayName(hit.parent) || getEntityPublicId(hit.parent),
          member: getEntityDisplayName(hit.member) || getEntityPublicId(hit.member),
          parentType: getEntityTypeLabel(hit.parent),
          memberType: getEntityTypeLabel(hit.member),
        }));

        return {
          totalCount: hits.length,
          exampleAssociations,
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
