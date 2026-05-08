import { and, eq, sql } from "drizzle-orm";
import { entityRelation } from "$lib/drizzle";
import { getDb } from "$lib/server/db/client";
import { getEntityByPublicId } from "$lib/server/queries/entity";

export async function getEntityDetails(publicId: string) {
  const entity = await getEntityByPublicId(publicId);
  if (!entity) return null;

  const db = getDb();
  const [interactionCountResult, annotationRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(entityRelation)
      .where(
        and(
          eq(entityRelation.relationCategory, "interaction"),
          eq(entityRelation.subjectEntityPk, entity.entityPk),
        ),
      ),
    db
      .select({ relationPk: entityRelation.relationPk, predicate: entityRelation.predicate })
      .from(entityRelation)
      .where(
        and(
          eq(entityRelation.relationCategory, "association"),
          eq(entityRelation.subjectEntityPk, entity.entityPk),
        ),
      ),
  ]);

  return {
    entity,
    summary: {
      interactionCount: Number(interactionCountResult[0]?.count || 0),
    },
    annotations: annotationRows,
  };
}
