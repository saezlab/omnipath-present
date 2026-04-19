"use server";

import "server-only";

import { getApiServiceUrl } from "@/lib/api/config";

interface TermsResponse {
  terms?: Record<string, {
    id: string;
    name?: string | null;
    definition?: string | null;
    namespace?: string | null;
  } | null>;
}

interface OntologyTreeNode {
  id: string;
  name?: string;
  distance?: number;
  children?: OntologyTreeNode[];
}

interface OntologyTreeResponse {
  root?: OntologyTreeNode | null;
}

const ONTOLOGY_ID_PATTERN = /^(GO|MI|OM|HP|KW|CHEBI):\d+$/i;

export async function normalizeOntologyFilterValues(terms: string[] | undefined): Promise<string[] | undefined> {
  if (!terms?.length) return undefined;

  const normalizedTerms = terms
    .map((term) => String(term).trim())
    .filter((term) => term.length > 0);

  if (normalizedTerms.length === 0) return undefined;

  const idsToResolve = normalizedTerms.filter((term) => ONTOLOGY_ID_PATTERN.test(term));
  if (idsToResolve.length === 0) return [...new Set(normalizedTerms)];

  try {
    const response = await fetch(`${getApiServiceUrl()}/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term_ids: [...new Set(idsToResolve)] }),
    });

    if (!response.ok) {
      throw new Error(`Failed to normalize ontology filter values (${response.status})`);
    }

    const data = (await response.json()) as TermsResponse;
    const expandedTerms = new Set<string>(normalizedTerms);

    for (const term of idsToResolve) {
      const resolved = data.terms?.[term];
      const name = resolved?.name?.trim();
      if (name) expandedTerms.add(`${name}:${term}`);
    }

    return [...expandedTerms];
  } catch (error) {
    console.error("Error normalizing ontology filter values:", error);
    return [...new Set(normalizedTerms)];
  }
}

export async function exploreOntologyTree(termIds: string[]): Promise<OntologyTreeNode | null> {
  const normalizedTermIds = termIds.map((termId) => termId.trim()).filter(Boolean);
  if (normalizedTermIds.length === 0) {
    return null;
  }

  const response = await fetch(`${getApiServiceUrl()}/tree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term_ids: normalizedTermIds }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API service error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as OntologyTreeResponse;
  return data.root || null;
}
