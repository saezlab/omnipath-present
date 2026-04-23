"use server";

import type { InteractionDetailsData } from "@/features/interactions-search/types";
import { getRelationDetailsByPk } from "@/lib/queries/relation-details";
import { summarizeInteractionEvidence } from "@/lib/relations/semantics";

export async function getInteractionDetails(interactionId: number): Promise<InteractionDetailsData | null> {
  const details = await getRelationDetailsByPk(interactionId);
  if (!details || details.relation.relationCategory !== "interaction") return null;

  const {
    relation,
    subjectEntity: entityA,
    objectEntity: entityB,
    rawEvidence,
  } = details;

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
      entityTypeA: entityA.entityType,
      entityTypeB: entityB.entityType,
    },
  );

  return {
    interaction: summary.interaction,
    entityA,
    entityB,
    evidence: summary.evidence,
    interactionAnnotations: summary.interactionAnnotations,
    rawEvidence,
  };
}
