"use client";

import { useOntologyTerms } from "@/features/ontology/use-ontology-terms";

export function OntologyTermLabel({ termId }: { termId: string }) {
  const termsById = useOntologyTerms([termId]);
  return <>{termsById[termId]?.name || termId}</>;
}
