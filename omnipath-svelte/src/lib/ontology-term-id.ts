const ONTOLOGY_TERM_ID_PATTERN = /(?:MI|OM|GO|HP|DO|MP|CHEBI|CL|UBERON|MONDO):\d{4,}|KW[-:]\d{4,}|WP\d+|R-[A-Z]+-\d+/i;

export function extractOntologyTermId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(ONTOLOGY_TERM_ID_PATTERN);
  return match ? match[0] : null;
}

export function isOntologyTermId(value: string | null | undefined): boolean {
  return Boolean(extractOntologyTermId(value));
}
