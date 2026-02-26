export interface CvTermCarrier {
  cv_terms?: string[];
  cv_terms_go?: string[];
  cv_terms_mi?: string[];
  cv_terms_om?: string[];
  cv_terms_hp?: string[];
  cv_terms_kw?: string[];
}

export function getUnifiedCvTerms(entity?: CvTermCarrier | null): string[] {
  if (!entity) return [];
  const terms = new Set<string>();

  entity.cv_terms_go?.forEach(t => terms.add(t));
  entity.cv_terms_mi?.forEach(t => terms.add(t));
  entity.cv_terms_om?.forEach(t => terms.add(t));
  entity.cv_terms_hp?.forEach(t => terms.add(t));
  entity.cv_terms_kw?.forEach(t => terms.add(t));

  // Backward compatibility during cutover
  entity.cv_terms?.forEach(t => terms.add(t));

  return Array.from(terms);
}
