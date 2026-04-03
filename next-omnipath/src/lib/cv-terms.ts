export interface CvTermCarrier {
  cv_terms?: string[] | string | null;
  ontology_terms?: string[] | string | null;
}

function toStringArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }

  return [];
}

export function getUnifiedCvTerms(entity?: CvTermCarrier | null): string[] {
  if (!entity) return [];
  const terms = new Set<string>();

  toStringArray(entity.ontology_terms).forEach((term) => terms.add(term));

  // Backward compatibility during cutover
  toStringArray(entity.cv_terms).forEach((term) => terms.add(term));

  return Array.from(terms);
}
