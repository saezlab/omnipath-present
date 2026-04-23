"use server";

import type { EntityRelationEvidence } from "@next-omnipath/drizzle";
import { getEntitiesByPks, type EntityWithIdentifiers } from "@/lib/queries/entity";
import { getEvidenceByRelationPk, getEvidenceByRelationPks } from "@/lib/queries/relation-evidence";
import { getRelationByPk, getRelationsByPks, type RelationWithEntities } from "@/lib/queries/relation";

export type RelationDetails = {
  relation: RelationWithEntities;
  subjectEntity: EntityWithIdentifiers;
  objectEntity: EntityWithIdentifiers;
  rawEvidence: EntityRelationEvidence[];
};

export async function getRelationDetailsByPk(relationPk: number): Promise<RelationDetails | null> {
  const relation = await getRelationByPk(relationPk);
  if (!relation) return null;

  const [entities, rawEvidence] = await Promise.all([
    getEntitiesByPks([relation.subjectEntityPk, relation.objectEntityPk]),
    getEvidenceByRelationPk(relation.relationPk),
  ]);

  const entityByPk = new Map(entities.map((entity) => [entity.entityPk, entity]));
  const subjectEntity = entityByPk.get(relation.subjectEntityPk);
  const objectEntity = entityByPk.get(relation.objectEntityPk);
  if (!subjectEntity || !objectEntity) return null;

  return {
    relation,
    subjectEntity,
    objectEntity,
    rawEvidence,
  };
}

export async function getRelationDetailsByPks(relationPks: number[]): Promise<RelationDetails[]> {
  const normalized = Array.from(new Set(relationPks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];

  const relations = await getRelationsByPks(normalized);
  const entityPks = [...new Set(relations.flatMap((relation) => [relation.subjectEntityPk, relation.objectEntityPk]))];
  const [rawEvidence, entities] = await Promise.all([
    getEvidenceByRelationPks(normalized),
    entityPks.length > 0 ? getEntitiesByPks(entityPks) : Promise.resolve([]),
  ]);

  const entityByPk = new Map(entities.map((entity) => [entity.entityPk, entity]));
  const evidenceByRelationPk = new Map<number, EntityRelationEvidence[]>();
  for (const row of rawEvidence) {
    const bucket = evidenceByRelationPk.get(row.relationPk) ?? [];
    bucket.push(row);
    evidenceByRelationPk.set(row.relationPk, bucket);
  }

  return relations.flatMap((relation) => {
    const subjectEntity = entityByPk.get(relation.subjectEntityPk);
    const objectEntity = entityByPk.get(relation.objectEntityPk);
    if (!subjectEntity || !objectEntity) return [];

    return [{
      relation: {
        ...relation,
        subjectEntity,
        objectEntity,
      },
      subjectEntity,
      objectEntity,
      rawEvidence: evidenceByRelationPk.get(relation.relationPk) ?? [],
    }];
  });
}
