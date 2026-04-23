"use server";

import { getEntitiesByPublicIds, type EntityWithIdentifiers } from "@/lib/queries/entity";
import { getRelationDetailsByPks } from "@/lib/queries/relation-details";
import { searchRelations } from "@/lib/queries/relation";
import { summarizeInteractionEvidence, type InteractionRecord } from "@/lib/relations/semantics";

export interface InteractionSearchHit {
  interaction: InteractionRecord;
  entityA: EntityWithIdentifiers;
  entityB: EntityWithIdentifiers;
}

export async function searchInteractions({
  query = "",
  filters = {},
  limit = 20,
  offset = 0,
}: {
  query?: string;
  filters?: {
    entity_ids?: Array<string | number>;
    predicates?: string[];
    sources?: string[];
  };
  limit?: number;
  offset?: number;
} = {}): Promise<{ hits: InteractionSearchHit[]; total: number }> {
  void query;

  let entityPks: number[] | undefined;
  if (filters.entity_ids?.length) {
    const entities = await getEntitiesByPublicIds(filters.entity_ids.map(String));
    entityPks = entities.map((entity) => entity.entityPk);
    if (entityPks.length === 0) {
      return { hits: [], total: 0 };
    }
  }

  const { relations, total } = await searchRelations({
    filters: {
      relationCategories: ["interaction"],
      entityPks,
      predicates: filters.predicates,
      sources: filters.sources,
    },
    limit,
    offset,
  });

  const relationDetails = await getRelationDetailsByPks(relations.map((relation) => relation.relationPk));

  const hits: InteractionSearchHit[] = relationDetails
    .filter(({ relation }) => relation.relationCategory === "interaction")
    .map(({ relation, subjectEntity, objectEntity, rawEvidence }) => {
      const summary = summarizeInteractionEvidence(
        {
          interactionPk: relation.relationPk,
          relationPk: relation.relationPk,
          entityAPk: relation.subjectEntityPk,
          entityBPk: relation.objectEntityPk,
          predicate: relation.predicate,
          relationCategory: relation.relationCategory,
          evidenceCount: relation.evidenceCount,
          sources: relation.sources,
        },
        rawEvidence,
        {
          entityTypeA: subjectEntity.entityType,
          entityTypeB: objectEntity.entityType,
        },
      );

      return {
        interaction: summary.interaction,
        entityA: subjectEntity,
        entityB: objectEntity,
      };
    });

  return { hits, total };
}
