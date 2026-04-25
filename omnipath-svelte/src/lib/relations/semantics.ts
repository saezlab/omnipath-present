import type { EntityRelationEvidence } from "$lib/drizzle";

export const RELATION_CATEGORY = {
  INTERACTION: "interaction",
  MEMBERSHIP: "membership",
  ANNOTATION: "annotation",
} as const;

const POSITIVE_SIGN_ACCESSIONS = new Set([
  "MI:0840", "MI:2235", "MI:2236", "MI:2237", "MI:2238", "MI:2239",
  "OM:0901", "OM:0902", "OM:0903", "OM:0905", "OM:0930", "OM:0950",
  "OM:0952", "OM:1001", "OM:1003",
]);

const NEGATIVE_SIGN_ACCESSIONS = new Set([
  "MI:0586", "MI:2240", "MI:2241", "MI:2242", "MI:2243", "MI:2244",
  "OM:0904", "OM:0920", "OM:0931", "OM:0932", "OM:0933", "OM:0951",
  "OM:0970", "OM:1002", "OM:1004", "OM:1020", "OM:1021",
]);

const SOURCE_ROLE_ACCESSIONS = new Set([
  "MI:0501", "MI:0586", "MI:0840", "MI:1160", "MI:2274", "OM:1001", "OM:1002", "OM:1003", "OM:1004",
]);

const TARGET_ROLE_ACCESSIONS = new Set(["MI:0502", "MI:2275"]);
const ACTIVATORY_PARAMETER_ACCESSIONS = new Set(["MI:0642"]);
const INHIBITORY_PARAMETER_ACCESSIONS = new Set(["MI:0641", "MI:0643"]);

export type InteractionAnnotationValue = {
  term: string;
  value?: string | null;
  unit?: string | null;
};

export type InteractionEvidenceItem = {
  evidence_serial: number;
  source: string;
  direction?: "a-b" | "b-a" | "undirected" | null;
  sign?: -1 | 0 | 1 | null;
  interaction_annotations: InteractionAnnotationValue[];
  member_a_annotations: InteractionAnnotationValue[];
  member_b_annotations: InteractionAnnotationValue[];
};

export type InteractionRecord = {
  interactionPk: number;
  relationPk: number;
  entityAPk: number;
  entityBPk: number;
  predicate: string;
  relationCategory: string;
  direction: -1 | 0 | 1 | null;
  sign: -1 | 0 | 1 | null;
  evidenceCount: number;
  sources: string[];
};

export type AssociationEvidenceItem = {
  evidence_serial: number;
  source: string;
  role_term_id?: string | null;
  stoichiometry?: string | null;
  annotations: InteractionAnnotationValue[];
  parent_annotations: InteractionAnnotationValue[];
  member_annotations: InteractionAnnotationValue[];
};

export type ParsedAnnotationValue = InteractionAnnotationValue;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseCvValue(value: string | null | undefined): { accession: string; label: string } {
  const text = (value || "").trim();
  const parts = text.split(":");
  if (parts.length < 3) {
    return { accession: text, label: text };
  }
  return {
    accession: `${parts[0]}:${parts[1]}`,
    label: parts.slice(2).join(":").trim(),
  };
}

export function toLegacyLabeledValue(value: string | null | undefined): string {
  const { accession, label } = parseCvValue(value);
  if (!accession || !label) return value || "";
  return `${label.toLowerCase()}:${accession}`;
}

export function normalizeOntologyId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Za-z]+):(\d+)$/);
  if (!match) return trimmed.toUpperCase();
  return `${match[1].toUpperCase()}:${match[2]}`;
}

export function extractAnnotationValues(value: unknown): ParsedAnnotationValue[] {
  if (!Array.isArray(value)) return [];
  const parsed: ParsedAnnotationValue[] = [];
  value.forEach((item) => {
    if (!isObject(item)) return;
    const term = typeof item.term === "string" ? toLegacyLabeledValue(item.term) : "";
    const rawValue = typeof item.value === "string" ? item.value : null;
    const unit = typeof item.unit === "string" ? toLegacyLabeledValue(item.unit) : null;
    if (!term) return;
    parsed.push({ term, value: rawValue, unit });
  });
  return parsed;
}

export function getTermAccession(term: string | undefined): string | null {
  if (!term) return null;
  const trimmed = term.trim();
  if (/^[A-Z]{2,}:\d{1,}$/.test(trimmed)) return trimmed;
  const parsed = parseCvValue(trimmed);
  if (/^[A-Z]{2,}:\d{1,}$/.test(parsed.accession)) return parsed.accession;
  return null;
}

export function getAnnotationAccessions(values: ParsedAnnotationValue[]): string[] {
  return values
    .map((value) => getTermAccession(value.term))
    .filter((value): value is string => Boolean(value));
}

type EvidenceDirection = "a-b" | "b-a" | "undirected" | null;
type EvidenceSign = -1 | 0 | 1 | null;

function collapseSigns(signs: Set<-1 | 1>, fallback: EvidenceSign = null): EvidenceSign {
  const hasPositive = signs.has(1);
  const hasNegative = signs.has(-1);
  if (hasPositive && hasNegative) return 0;
  if (hasPositive) return 1;
  if (hasNegative) return -1;
  return fallback;
}

function inferInteractionTypeDirection(entityTypeA: string | null | undefined, entityTypeB: string | null | undefined): EvidenceDirection {
  const a = (entityTypeA || "").split(":")[0]?.trim().toLowerCase();
  const b = (entityTypeB || "").split(":")[0]?.trim().toLowerCase();
  if (a === "small molecule" && b === "protein") return "a-b";
  if (b === "small molecule" && a === "protein") return "b-a";
  return null;
}

type InferenceContext = {
  entityTypeA: string | null | undefined;
  entityTypeB: string | null | undefined;
};

function inferEvidenceCombos(
  evidence: InteractionEvidenceItem,
  context: InferenceContext,
): Array<{ direction: EvidenceDirection; sign: EvidenceSign }> {
  if (evidence.direction || evidence.sign === 1 || evidence.sign === -1 || evidence.sign === 0) {
    return [{
      direction: evidence.direction ?? null,
      sign: evidence.sign ?? null,
    }];
  }

  const byDirection = new Map<EvidenceDirection, Set<-1 | 1>>();
  const ensureDirection = (direction: EvidenceDirection) => {
    if (!direction) return;
    if (!byDirection.has(direction)) {
      byDirection.set(direction, new Set<-1 | 1>());
    }
  };
  const addSignedDirection = (direction: EvidenceDirection, sign: -1 | 1 | null) => {
    if (!direction) return;
    ensureDirection(direction);
    if (sign === 1 || sign === -1) {
      byDirection.get(direction)?.add(sign);
    }
  };

  const memberASigns = getAnnotationAccessions(evidence.member_a_annotations);
  const memberBSigns = getAnnotationAccessions(evidence.member_b_annotations);
  const interactionSigns = getAnnotationAccessions(evidence.interaction_annotations);

  memberASigns.forEach((accession) => {
    const sign = POSITIVE_SIGN_ACCESSIONS.has(accession) ? 1 : NEGATIVE_SIGN_ACCESSIONS.has(accession) ? -1 : null;
    if (SOURCE_ROLE_ACCESSIONS.has(accession)) addSignedDirection("a-b", sign);
    if (TARGET_ROLE_ACCESSIONS.has(accession)) addSignedDirection("b-a", sign);
  });

  memberBSigns.forEach((accession) => {
    const sign = POSITIVE_SIGN_ACCESSIONS.has(accession) ? 1 : NEGATIVE_SIGN_ACCESSIONS.has(accession) ? -1 : null;
    if (SOURCE_ROLE_ACCESSIONS.has(accession)) addSignedDirection("b-a", sign);
    if (TARGET_ROLE_ACCESSIONS.has(accession)) addSignedDirection("a-b", sign);
  });

  const parameterDirection = inferInteractionTypeDirection(context.entityTypeA, context.entityTypeB);
  interactionSigns.forEach((accession) => {
    if (ACTIVATORY_PARAMETER_ACCESSIONS.has(accession)) addSignedDirection(parameterDirection, 1);
    if (INHIBITORY_PARAMETER_ACCESSIONS.has(accession)) addSignedDirection(parameterDirection, -1);
  });

  const fallbackSign = collapseSigns(new Set(interactionSigns.flatMap((accession) => {
    if (POSITIVE_SIGN_ACCESSIONS.has(accession)) return [1 as const];
    if (NEGATIVE_SIGN_ACCESSIONS.has(accession)) return [-1 as const];
    return [];
  })));

  const inferred = Array.from(byDirection.entries()).map(([direction, signs]) => ({
    direction,
    sign: collapseSigns(signs, fallbackSign),
  }));

  return inferred.length > 0 ? inferred : [{ direction: null, sign: fallbackSign }];
}

export function mapRelationEvidenceRowsToInteractionEvidence(
  rows: EntityRelationEvidence[],
  context: InferenceContext,
): InteractionEvidenceItem[] {
  return rows.map((row, index) => {
    const interactionAnnotations = [
      ...extractAnnotationValues(row.recordAttributes),
      ...extractAnnotationValues(row.evidence),
    ];
    const memberAAnnotations = extractAnnotationValues(row.subjectAttributes);
    const memberBAnnotations = extractAnnotationValues(row.objectAttributes);
    const provisional: InteractionEvidenceItem = {
      evidence_serial: index + 1,
      source: row.source,
      interaction_annotations: interactionAnnotations,
      member_a_annotations: memberAAnnotations,
      member_b_annotations: memberBAnnotations,
    };
    const combo = inferEvidenceCombos(provisional, context)[0];
    return {
      ...provisional,
      direction: combo?.direction ?? null,
      sign: combo?.sign ?? null,
    };
  });
}

export function summarizeInteractionEvidence(
  record: Omit<InteractionRecord, "direction" | "sign">,
  rows: EntityRelationEvidence[],
  context: InferenceContext,
): { interaction: InteractionRecord; evidence: InteractionEvidenceItem[]; interactionAnnotations: InteractionAnnotationValue[]; participantAnnotationTerms: string[]; interactionAnnotationTerms: string[] } {
  const evidence = mapRelationEvidenceRowsToInteractionEvidence(rows, context);
  const directionSet = new Set<string>();
  const signSet = new Set<-1 | 1>();
  const interactionAnnotations: InteractionAnnotationValue[] = [];
  const participantTerms = new Set<string>();
  const interactionTerms = new Set<string>();

  evidence.forEach((item) => {
    if (item.direction === "a-b") directionSet.add("a-b");
    if (item.direction === "b-a") directionSet.add("b-a");
    if (item.sign === 1 || item.sign === -1) signSet.add(item.sign);
    interactionAnnotations.push(...item.interaction_annotations);
    getAnnotationAccessions(item.interaction_annotations).forEach((term) => interactionTerms.add(term));
    getAnnotationAccessions(item.member_a_annotations).forEach((term) => participantTerms.add(term));
    getAnnotationAccessions(item.member_b_annotations).forEach((term) => participantTerms.add(term));
  });

  let direction: -1 | 0 | 1 | null = null;
  if (directionSet.has("a-b") && !directionSet.has("b-a")) direction = 1;
  else if (!directionSet.has("a-b") && directionSet.has("b-a")) direction = -1;
  else if (directionSet.size > 0) direction = 0;

  const collapsedSign = collapseSigns(signSet, 0);
  const sign = collapsedSign === null ? 0 : collapsedSign;

  return {
    interaction: {
      ...record,
      direction,
      sign,
    },
    evidence,
    interactionAnnotations,
    participantAnnotationTerms: Array.from(participantTerms),
    interactionAnnotationTerms: Array.from(interactionTerms),
  };
}

function findAnnotationValueByKeywords(values: ParsedAnnotationValue[], keywords: string[]): string | null {
  const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());
  for (const value of values) {
    const term = value.term.toLowerCase();
    if (loweredKeywords.some((keyword) => term.includes(keyword))) {
      const accession = getTermAccession(value.term);
      if (accession) return accession;
      if (value.value) return value.value;
    }
  }
  return null;
}

function findStoichiometry(values: ParsedAnnotationValue[]): string | null {
  for (const value of values) {
    if (value.term.toLowerCase().includes("stoichiometry")) {
      return value.value ?? null;
    }
  }
  return null;
}

export function mapRelationEvidenceRowsToAssociationEvidence(rows: EntityRelationEvidence[]): AssociationEvidenceItem[] {
  return rows.map((row, index) => {
    const annotations = [
      ...extractAnnotationValues(row.recordAttributes),
      ...extractAnnotationValues(row.evidence),
    ];
    const parentAnnotations = extractAnnotationValues(row.subjectAttributes);
    const memberAnnotations = extractAnnotationValues(row.objectAttributes);
    return {
      evidence_serial: index + 1,
      source: row.source,
      role_term_id: findAnnotationValueByKeywords(annotations, ["role"]),
      stoichiometry: findStoichiometry([...annotations, ...parentAnnotations, ...memberAnnotations]),
      annotations,
      parent_annotations: parentAnnotations,
      member_annotations: memberAnnotations,
    };
  });
}

export function summarizeAssociationEvidence(rows: EntityRelationEvidence[]) {
  const evidence = mapRelationEvidenceRowsToAssociationEvidence(rows);
  return {
    evidence,
    roleTermId: evidence.find((item) => item.role_term_id)?.role_term_id ?? null,
    stoichiometry: evidence.find((item) => item.stoichiometry)?.stoichiometry ?? null,
  };
}
