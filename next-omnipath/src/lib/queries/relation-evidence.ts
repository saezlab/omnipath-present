"use server";

import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { entityRelationEvidence, type EntityRelationEvidence } from "@next-omnipath/drizzle";

export async function getEvidenceByRelationPk(relationPk: number): Promise<EntityRelationEvidence[]> {
  const db = getDb();
  return db.select().from(entityRelationEvidence).where(eq(entityRelationEvidence.relationPk, relationPk));
}

export async function getEvidenceByRelationPks(relationPks: number[]): Promise<EntityRelationEvidence[]> {
  const normalized = Array.from(new Set(relationPks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];
  const db = getDb();
  return db.select().from(entityRelationEvidence).where(inArray(entityRelationEvidence.relationPk, normalized));
}
