import type { EntityRelation, Entity } from "$lib/drizzle";

export type InteractionListRow = {
  relation: EntityRelation;
  subjectEntity: Entity;
  objectEntity: Entity;
};

export type InteractionDetailsData = InteractionListRow & {
  evidence: Array<{
    relationPk: string;
    source: string;
    subjectAttributes: unknown;
    recordAttributes: unknown;
    evidence: unknown;
    objectAttributes: unknown;
  }>;
};

export type ParsedAnnotation = {
  term: string;
  termId?: string;
  value?: string;
  unit?: string;
  unitId?: string;
};

export type EvidenceGroup = {
  key: string;
  source: string;
  evidenceCount: number;
  pubmedIds: string[];
  subjectAnnotations: ParsedAnnotation[];
  relationAnnotations: ParsedAnnotation[];
  objectAnnotations: ParsedAnnotation[];
};
