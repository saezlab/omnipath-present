"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [termsById, setTermsById] = useState<Record<string, OntologyTermInfo | null>>({});

  useEffect(() => {
    let cancelled = false;

    const missingIds = normalizedIds.filter((termId) => !(termId in termsById));
    if (missingIds.length === 0) {
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/ontology/terms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ termIds: missingIds }),
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { terms?: Record<string, OntologyTermInfo | null> };
        if (cancelled) return;
        setTermsById((current) => ({ ...current, ...(data.terms || {}) }));
      } catch {
        // ignore lookup failures; callers can fall back to raw IDs
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedIds, termsById]);

  return termsById;
}
