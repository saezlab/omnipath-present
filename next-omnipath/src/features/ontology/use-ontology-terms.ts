"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export interface OntologyTermInfo {
  id: string;
  name?: string | null;
  definition?: string | null;
  namespace?: string | null;
}

export function useOntologyTerms(termIds: string[]) {
  const normalizedIds = useMemo(
    () => Array.from(new Set(termIds.map((termId) => termId.trim()).filter((termId) => termId.length > 0))).sort(),
    [termIds],
  );

  const { data } = useQuery({
    queryKey: ["ontology-terms", normalizedIds],
    enabled: normalizedIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch("/api/ontology/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termIds: normalizedIds }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ontology terms (${response.status})`);
      }

      const data = (await response.json()) as { terms?: Record<string, OntologyTermInfo | null> };
      return data.terms || {};
    },
  });

  return data ?? {};
}
