"use server";

import { and, eq, inArray } from "drizzle-orm";
import { entityRelation } from "@next-omnipath/drizzle";
import { getDb } from "@/lib/db/client";
import { getEntityByPublicId } from "@/lib/queries/entity";

export async function getEntityDetails(publicId: string) {
  const entity = await getEntityByPublicId(publicId);
  if (!entity) return null;

  const db = getDb();
  const [interactionRows, annotationRows] = await Promise.all([
    db
      .select({ relationPk: entityRelation.relationPk })
      .from(entityRelation)
      .where(
        and(
          eq(entityRelation.relationCategory, "interaction"),
          inArray(entityRelation.subjectEntityPk, [entity.entityPk]),
        ),
      ),
    db
      .select({ relationPk: entityRelation.relationPk, predicate: entityRelation.predicate })
      .from(entityRelation)
      .where(
        and(
          eq(entityRelation.relationCategory, "annotation"),
          eq(entityRelation.subjectEntityPk, entity.entityPk),
        ),
      ),
  ]);

  return {
    entity,
    summary: {
      interactionCount: interactionRows.length,
    },
    annotations: annotationRows,
  };
}
