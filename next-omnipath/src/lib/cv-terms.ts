export interface CvTermCarrier {
  cv_terms?: string[];
  ontology_terms?: string[];
}

export function getUnifiedCvTerms(entity?: CvTermCarrier | null): string[] {
  if (!entity) return [];
  const terms = new Set<string>();

  entity.ontology_terms?.forEach(t => terms.add(t));

  // Backward compatibility during cutover
  entity.cv_terms?.forEach(t => terms.add(t));

  return Array.from(terms);
}
