"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import React, { useMemo, useState } from "react";
import { Network, Tag, Shapes, FileText, Database, Plus, Check, FlaskConical, ChevronDown, ChevronUp, Copy, Loader2, Info } from "lucide-react";
import { useEntitySelection } from "@/contexts/entity-selection-context";
import { MoleculeStructure } from "./molecule_structure";
import { fetchMeilisearchDocuments } from "@/lib/meilisearch/search";
import { INDEXES } from "@/lib/meilisearch/client";
import { EntityDetailsDialog } from "./entity-details-dialog";
import { getUnifiedCvTerms } from "@/lib/cv-terms";

// Component that shows a ResultCardContent in a HoverCard for entities
export function EntityHoverCard({
  entityId,
  children
}: {
  entityId: string;
  children: React.ReactNode;
}) {
  const [entity, setEntity] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleOpenChange = async (open: boolean) => {
    if (open && !hasLoaded) {
      setLoading(true);
      try {
        const normalizedId = entityId.trim();
        const { documents } = await fetchMeilisearchDocuments(
          INDEXES.ENTITIES,
          [normalizedId],
          "entity_id",
        );

        if (documents.length > 0) {
          setEntity(documents[0] as SearchResult);
        }
      } catch (error) {
        console.error('Failed to fetch entity:', error);
      } finally {
        setLoading(false);
        setHasLoaded(true);
      }
    }
  };

  return (
    <HoverCard openDelay={300} closeDelay={100} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-80 p-0">
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : entity ? (
          <ResultCardContent result={entity} />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            No details available
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// Component that shows a ResultCardContent in a HoverCard for CV terms
export function CvTermHoverCard({
  termId,
  children
}: {
  termId: string;
  children: React.ReactNode;
}) {
  const [term, setTerm] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleOpenChange = async (open: boolean) => {
    if (open && !hasLoaded) {
      setLoading(true);
      try {
        const response = await fetch("/api/ontology/terms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            termIds: [termId]
          }),
        });

        if (!response.ok) throw new Error("Failed to fetch term");

        const data = await response.json();
        const terms = data.terms || {};
        const termData = terms[termId];

        if (termData) {
          // Map to SearchResult format for compatibility with ResultCardContent
          setTerm({
            id: termData.id,
            type: "cv_term",
            name: termData.name,
            definition: termData.definition,
            namespace_name: termData.namespace,
          } as SearchResult);
        }
      } catch (error) {
        console.error('Failed to fetch CV term:', error);
      } finally {
        setLoading(false);
        setHasLoaded(true);
      }
    }
  };

  return (
    <HoverCard openDelay={300} closeDelay={100} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-80 p-0">
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : term ? (
          <ResultCardContent result={term} />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            No details available
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// Helper function to convert <em> tags to highlighted spans
const convertEmToHighlight = (text: string | undefined) => {
  if (!text) return '';
  return text.replace(/<em>/g, '<span class="bg-yellow-200 dark:bg-blue-500 px-1 rounded">').replace(/<\/em>/g, '</span>');
};

const stripHtml = (text: string): string => text.replace(/<[^>]*>/g, '');

type DescriptionSection = {
  label: string;
  items: string[];
};

const DESCRIPTION_SECTION_LABELS = [
  "FUNCTION",
  "DISEASE",
  "SUBCELLULAR LOCATION",
  "PATHWAY",
  "CATALYTIC ACTIVITY",
  "COFACTOR",
  "ACTIVITY REGULATION",
  "TISSUE SPECIFICITY",
  "SIMILARITY",
  "DEVELOPMENTAL STAGE",
  "INDUCTION",
  "DOMAIN",
  "NOTE",
] as const;

const SECTION_MATCH_PATTERN = `(${DESCRIPTION_SECTION_LABELS.map(label => label.replace(/\s+/g, "\\s+")).join("|")}):`;

const cleanDescriptionText = (text: string): string => {
  return stripHtml(text)
    .replace(/\{[^{}]*(?:ECO:|PubMed:|UniProtKB:)[^{}]*\}/g, "")
    .replace(/\[[^\]]*(?:MIM:|PubMed:|UniProtKB:)[^\]]*\]/g, "")
    .replace(/\((?:[^)]*(?:PubMed:|ECO:|UniProtKB:|MIM:)[^)]*)\)/g, "")
    .replace(/\b(?:PubMed|ECO|UniProtKB|MIM):[^\s;,.)]*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([;,.])/g, "$1")
    .trim();
};

const getDescriptionEntries = (definition: string | undefined, descriptions: string[] = []): string[] => {
  const unique = Array.from(
    new Set([definition, ...descriptions].filter((value): value is string => Boolean(value?.trim())))
  );

  return unique.sort((a, b) => {
    const aIsFunction = stripHtml(a).trim().toLowerCase().startsWith("function:");
    const bIsFunction = stripHtml(b).trim().toLowerCase().startsWith("function:");
    if (aIsFunction && !bIsFunction) return -1;
    if (!aIsFunction && bIsFunction) return 1;
    return 0;
  });
};

const getDescriptionSections = (definition: string | undefined, descriptions: string[] = []): DescriptionSection[] => {
  const entries = getDescriptionEntries(definition, descriptions);
  const grouped = new Map<string, string[]>();

  for (const entry of entries) {
    const normalized = stripHtml(entry);
    const matches = Array.from(normalized.matchAll(new RegExp(SECTION_MATCH_PATTERN, "gi")));

    if (matches.length === 0) {
      const cleaned = cleanDescriptionText(normalized);
      if (cleaned) {
        const existing = grouped.get("DESCRIPTION") || [];
        existing.push(cleaned);
        grouped.set("DESCRIPTION", existing);
      }
      continue;
    }

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      const label = (current[1] || "DESCRIPTION").toUpperCase();
      const start = current.index! + current[0].length;
      const end = next ? next.index! : normalized.length;
      const rawContent = normalized.slice(start, end).replace(/^\s*[;,-]\s*/, "").trim();
      const cleaned = cleanDescriptionText(rawContent);

      if (!cleaned) continue;

      const existing = grouped.get(label) || [];
      if (!existing.includes(cleaned)) {
        existing.push(cleaned);
      }
      grouped.set(label, existing);
    }
  }

  const sectionOrder = ["FUNCTION", "DISEASE", "SUBCELLULAR LOCATION", ...DESCRIPTION_SECTION_LABELS.filter(label => !["FUNCTION", "DISEASE", "SUBCELLULAR LOCATION"].includes(label)), "DESCRIPTION"];

  return Array.from(grouped.entries())
    .sort(([a], [b]) => {
      const aIdx = sectionOrder.indexOf(a);
      const bIdx = sectionOrder.indexOf(b);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    })
    .map(([label, items]) => ({ label, items }));
};

// Helper to detect if entity is a small molecule or lipid (displayed similarly)
const isSmallMolecule = (result: SearchResult): boolean => {
  const entityType = result._formatted?.entity_type || result.entity_type || '';
  // Extract type label from "Label:Accession" format and normalize (remove spaces/underscores)
  const typeLabel = entityType.split(':')[0].toLowerCase().replace(/[\s_]/g, '');
  return typeLabel === 'smallmolecule' ||
    typeLabel === 'compound' ||
    typeLabel === 'metabolite' ||
    typeLabel === 'drug' ||
    typeLabel === 'lipid' ||
    // Also check if we have molecule-specific data
    !!(result.canonical_smiles || result.formula || result.molecular_weight);
};

// Identifier object structure from search_entities
// New format: {key: "type:accession", value: "identifier_value"}
// e.g., {key: "uniprot:OM:0001", value: "P0A6M2"}
export type Identifier = { key: string; value: string };

export interface SearchResult {
  id: string;
  entity_id?: string | number;  // Canonical entity ID
  type?: string;
  _formatted?: {
    entity_type?: string;        // "Label:entity_id" like "Protein:385235"
    names?: string[];
    synonyms?: string[];
    gene_symbols?: string[];
    descriptions?: string[];
    references?: string[];
    identifiers?: Identifier[];
    sources?: string[];          // "source_name:source_id"
    // CV term fields
    namespace_name?: string;
    definition?: string;
    name?: string;
    [key: string]: unknown;
  };
  // Raw fields (non-formatted)
  entity_type?: string;
  names?: string[];
  synonyms?: string[];
  gene_symbols?: string[];
  descriptions?: string[];
  references?: string[];
  identifiers?: Identifier[];
  sources?: string[];
  complexes?: number[];
  cv_terms?: string[];
  cv_terms_go?: string[];
  cv_terms_mi?: string[];
  cv_terms_om?: string[];
  cv_terms_hp?: string[];
  cv_terms_kw?: string[];
  pathways?: number[];
  reactions?: number[];
  num_interactions?: number;
  // CV term fields
  namespace_name?: string;
  definition?: string;
  name?: string;
  is_annotated?: boolean;
  associated_entity_ids?: string[];
  // Small molecule / compound fields
  canonical_smiles?: string;
  formula?: string;
  molecular_weight?: number;
  // Source-browser fields
  source_name?: string;
  source_ref?: string;
  source?: string;
  source_accession?: string;
  resource_url?: string;
  resource_description?: string;
  function_records?: Array<{ function: string; records: number }>;
  function_names?: string[];
  content_category_cv_terms?: string[];
  total_records?: number;
  license_cv?: string;
  update_category_cv?: string;
  pubmed?: string[];
  finished_at?: string;
  [key: string]: unknown; // Add index signature for compatibility with DataRow
}

// Single identifier badge with copy functionality
function IdentifierBadge({ id, idx }: { id: { type: string; value: string }; idx: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span
      key={`${id.type}-${idx}`}
      className="group/id inline-flex items-center gap-1 bg-background/80 border rounded px-1.5 py-0.5 hover:bg-background"
      title={`${id.type}: ${id.value}`}
    >
      <span className="text-muted-foreground font-medium">{id.type}:</span>
      <span className="font-mono truncate max-w-[120px]">{id.value}</span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover/id:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </span>
  );
}

// Component to display identifiers in a collapsible section
function IdentifiersDisplay({ identifiers }: { identifiers: Identifier[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!identifiers || identifiers.length === 0) return null;

  const parsedIdentifiers = identifiers
    .map(id => {
      if (!id?.key || !id?.value) return null;
      const colonIndex = id.key.indexOf(':');
      const idType = colonIndex > 0 ? id.key.substring(0, colonIndex) : id.key;
      return { type: idType, value: id.value };
    })
    .filter(Boolean) as { type: string; value: string }[];

  if (parsedIdentifiers.length === 0) return null;

  // Show first 3 when collapsed
  const displayedIdentifiers = isExpanded ? parsedIdentifiers : parsedIdentifiers.slice(0, 3);
  const hasMore = parsedIdentifiers.length > 3;

  return (
    <div className="border-t px-3 py-2 bg-muted/30">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {displayedIdentifiers.map((id, idx) => (
          <IdentifierBadge key={`${id.type}-${idx}`} id={id} idx={idx} />
        ))}
        {hasMore && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors px-1"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                <span>+{parsedIdentifiers.length - 3} more</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}


// Molecule-specific result card
function MoleculeResultCard({ result }: { result: SearchResult }) {
  const entityType = result._formatted?.entity_type || result.entity_type;
  const entityTypeLabel = entityType ? entityType.split(':')[0] : "Small Molecule";

  // Memoize identifiers for stable reference in JSX
  const identifiers = useMemo(() =>
    result._formatted?.identifiers || result.identifiers || [],
    [result._formatted?.identifiers, result.identifiers]
  );

  // Get primary name from names or identifiers, prefer the shortest meaningful name
  const primaryName = useMemo(() => {
    const names = result._formatted?.names || result.names || [];
    const identifiers = result._formatted?.identifiers || result.identifiers || [];
    const validNames: string[] = [];

    // Collect valid names (skip ID-like names)
    for (const name of names) {
      if (!/^(MLS|SMR|cid_|ZINC|SID_|CID_)/i.test(name) && name.length > 3) {
        validNames.push(name);
      }
    }

    // Try to find names from identifiers
    for (const id of identifiers) {
      const idType = id.key?.split(':')[0].toLowerCase();
      if (idType && ['name', 'common_name', 'preferred_name'].includes(idType) && typeof id.value === 'string') {
        validNames.push(id.value);
      }
    }

    // Return the shortest valid name
    if (validNames.length > 0) {
      return validNames.reduce((shortest, current) =>
        current.length < shortest.length ? current : shortest
      );
    }

    // Fallback to first name if all look like IDs
    if (names.length > 0) {
      return names[0];
    }

    return `Compound ${result.entity_id || result.id}`;
  }, [result._formatted?.names, result.names, result._formatted?.identifiers, result.identifiers, result.entity_id, result.id]);

  // Extract SMILES from identifiers (stored in "biotin tag" identifier type)
  const smiles = useMemo(() => {
    const identifiers = result._formatted?.identifiers || result.identifiers || [];
    for (const id of identifiers) {
      const idType = id.key?.split(':')[0].toLowerCase().trim();
      if (idType === 'biotin tag' || idType === 'biotin' || idType === 'smiles' || idType === 'canonical_smiles') {
        return id.value;
      }
    }
    return result.canonical_smiles || null;
  }, [result._formatted?.identifiers, result.identifiers, result.canonical_smiles]);

  const { addEntity, removeEntity, isSelected } = useEntitySelection();
  const entityId = (result.entity_id ?? result.id)?.toString();
  const selected = entityId ? isSelected(entityId) : false;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleAddToSelection = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!entityId) return;

    if (selected) {
      removeEntity(entityId);
    } else {
      addEntity({
        id: entityId,
        entityId: result.entity_id,
        name: primaryName,
        type: entityTypeLabel,
        cv_terms: getUnifiedCvTerms(result),
        references: result.references,
        fullResult: result,
      });
    }
  };

  return (
    <Card
      className="flex flex-col hover:shadow-md transition-shadow h-full result-card group relative"
    >
      {/* Action buttons */}
      {entityId && (
        <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <Button
            variant="secondary"
            size="icon"
            className="h-6 w-6 rounded-full shadow-md"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDetailsOpen(true);
            }}
            title="View details"
          >
            <Info className="h-3 w-3" />
          </Button>
          <Button
            variant={selected ? "default" : "secondary"}
            size="icon"
            className="h-6 w-6 rounded-full shadow-md"
            onClick={handleAddToSelection}
            title={selected ? "Remove from selection" : "Add to selection"}
          >
            {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </Button>
        </div>
      )}

      {/* Entity Details Dialog */}
      <EntityDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        entity={result}
      />

      {/* Molecule structure visualization */}
      {smiles && (
        <CardContent className="p-3 flex-grow flex flex-col items-center">
          <MoleculeStructure
            smiles={smiles}
            width={180}
            height={140}
            compoundName={primaryName}
            className="rounded-md"
          />
        </CardContent>
      )}

      {/* Identifiers section */}
      <IdentifiersDisplay identifiers={identifiers} />

      <CardFooter className="flex items-center justify-between shrink-0 border-t p-2.5">
        {/* Stats */}
        <div className="flex items-center gap-3 text-sm flex-wrap">
          {result.num_interactions && result.num_interactions > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Network className="h-4 w-4" />
              <span>{result.num_interactions}</span>
            </div>
          )}
          {result.complexes && result.complexes.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Shapes className="h-4 w-4" />
              <span>{result.complexes.length}</span>
            </div>
          )}
          {getUnifiedCvTerms(result).length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Tag className="h-4 w-4" />
              <span>{getUnifiedCvTerms(result).length}</span>
            </div>
          )}
          {result.references && result.references.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>{result.references.length}</span>
            </div>
          )}
          {result.sources && result.sources.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Database className="h-4 w-4" />
              <span>{result.sources.length}</span>
            </div>
          )}
        </div>
        {/* Badge */}
        <Badge variant="secondary" className="flex items-center gap-1 text-xs">
          <FlaskConical className="h-3 w-3" />
          {entityTypeLabel}
        </Badge>
      </CardFooter>
    </Card>
  );
}

export function ResultCard({ result }: { result: SearchResult }) {
  const { addEntity, removeEntity, isSelected } = useEntitySelection();
  const type = result.type || "entity";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [descriptionsOpen, setDescriptionsOpen] = useState(false);

  if (type === "source") {
    const visibleFunctionRecords = (result.function_records || []).filter(
      (fn) => fn.function?.toLowerCase() !== "resource"
    );
    const cvLabel = (value?: string) => {
      if (!value) return undefined;
      const match = value.match(/^(.+):([A-Z]{2,}:\d+)$/);
      return match ? match[1] : value;
    };

    return (
      <Card className="flex flex-col hover:shadow-md transition-shadow h-full result-card">
        <CardHeader className="relative space-y-0 p-3 border-b shrink-0">
          <CardTitle className="text-lg line-clamp-2">{result.source_name || result.name || result.source_ref}</CardTitle>
        </CardHeader>

        {result.resource_description && (
          <CardContent className="px-4 py-3 flex-grow min-h-0">
            <p className="text-sm text-muted-foreground line-clamp-4">{result.resource_description}</p>
          </CardContent>
        )}

        {visibleFunctionRecords.length > 0 && (
          <div className="border-t px-3 py-2 bg-muted/30">
            <div className="flex flex-wrap gap-1.5 text-xs">
              {visibleFunctionRecords.map((fn) => (
                <Badge key={`${result.id}-${fn.function}`} variant="outline" className="text-xs">
                  {fn.function} ({fn.records})
                </Badge>
              ))}
            </div>
          </div>
        )}

        <CardFooter className="flex items-center justify-between shrink-0 p-2.5 border-t">
          <div className="flex items-center gap-3 text-sm flex-wrap">
            {result.total_records !== undefined && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Database className="h-4 w-4" />
                <span>{result.total_records}</span>
              </div>
            )}
          </div>
          <Badge variant="secondary" className="text-xs">
            {cvLabel(result.license_cv) || "Source"}
          </Badge>
        </CardFooter>
      </Card>
    );
  }

  // Check if this is a small molecule and render specialized card
  if (isSmallMolecule(result)) {
    return <MoleculeResultCard result={result} />;
  }

  // Get display name for selection
  const getDisplayName = () => {
    const geneSymbols = result._formatted?.gene_symbols || result.gene_symbols || [];
    const names = result._formatted?.names || result.names || [];
    return geneSymbols[0] || names[0] || `Entity ${result.entity_id || result.id}`;
  };

  const entityId = (result.entity_id ?? result.id)?.toString();
  const selected = entityId ? isSelected(entityId) : false;

  const handleAddToSelection = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!entityId) return;

    if (selected) {
      removeEntity(entityId);
    } else {
      addEntity({
        id: entityId,
        entityId: result.entity_id,
        name: getDisplayName(),
        type: result.entity_type?.split(':')[0] || result.type,
        cv_terms: getUnifiedCvTerms(result),
        references: result.references,
        fullResult: result,
      });
    }
  };

  // Extract data based on type
  const descriptions = result._formatted?.descriptions || result.descriptions || [];
  const names = result._formatted?.names || result.names || [];
  const geneSymbols = result._formatted?.gene_symbols || result.gene_symbols || [];
  const identifiers = result._formatted?.identifiers || result.identifiers || [];
  const synonyms = result._formatted?.synonyms || result.synonyms || [];
  const references = result._formatted?.references || result.references || [];
  const sources = result._formatted?.sources || result.sources || [];
  const complexes = result.complexes || [];
  const cvTerms = getUnifiedCvTerms(result);
  const entityType = result._formatted?.entity_type || result.entity_type;
  const namespaceName = result._formatted?.namespace_name || result.namespace_name;
  const definition = result._formatted?.definition || result.definition;
  const descriptionSections = getDescriptionSections(definition, descriptions);

  // Extract entity type label (e.g., "Protein" from "Protein:385235")
  const entityTypeLabel = entityType ? entityType.split(':')[0] : "Entity";
  const hasMiddleContent = descriptionSections.length > 0;

  // Helper function to truncate text to max characters
  const truncateText = (text: string, maxChars: number = 100): string => {
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars) + '...';
  };

  // Extract gene symbol or determine title
  let title = "";
  let subtitle = "";
  let primaryIdentifier = "";

  if (type === 'entity') {
    const geneSymbol = geneSymbols.length > 0 ? geneSymbols[0] : undefined;
    const name = names.length > 0 ? names[0] : undefined;
    const firstIdentifier = identifiers.length > 0 ? identifiers[0].value : undefined;

    // For proteins: prefer gene symbol, then UniProt identifier
    // For other entities: gene_symbols > names > first identifier
    const isProtein = entityTypeLabel.toLowerCase() === 'protein';

    let displayName: string;
    let secondaryName: string | undefined;

    if (isProtein) {
      // Try to find UniProt identifier
      const uniprotId = identifiers.find(id => {
        const idType = id.key?.split(':')[0].toLowerCase();
        return idType === 'uniprot' || idType === 'uniprot_id' || idType === 'uniprotkb';
      });
      const uniprotValue = uniprotId?.value;

      // For proteins: gene symbol first, fallback to UniProt
      displayName = geneSymbol || uniprotValue || name || firstIdentifier || `Entity ${result.id}`;
      // Show UniProt as secondary if gene symbol is primary
      if (geneSymbol && uniprotValue && geneSymbol !== uniprotValue) {
        secondaryName = uniprotValue;
      }
    } else {
      // Original logic for non-proteins
      displayName = geneSymbol || name || firstIdentifier || `Entity ${result.id}`;
      if (geneSymbol && name && geneSymbol !== name) {
        secondaryName = name;
      }
    }

    // Truncate the display name to 8 characters
    const truncatedDisplayName = truncateText(displayName);
    const formattedDisplayName = result._formatted ? convertEmToHighlight(truncatedDisplayName) : truncatedDisplayName;

    // Show secondary name in parentheses if available
    if (secondaryName) {
      primaryIdentifier = secondaryName;
      const truncatedPrimaryId = truncateText(primaryIdentifier);
      title = `${formattedDisplayName} <span class="text-sm text-muted-foreground">(${result._formatted ? convertEmToHighlight(truncatedPrimaryId) : truncatedPrimaryId})</span>`;
    } else {
      title = formattedDisplayName;
    }

    // Create subtitle from entity type
    subtitle = entityTypeLabel;
  } else if (type === 'cv_term') {
    const displayName = result._formatted?.name || result.name || `Term ${result.id}`;
    const truncatedDisplayName = truncateText(displayName);
    title = result._formatted ? convertEmToHighlight(truncatedDisplayName) : truncatedDisplayName;
    subtitle = namespaceName || "Ontology Term";
    primaryIdentifier = result.id;
  }

  // Stats
  const interactionCount = result.num_interactions || 0;
  const entityCount = result.associated_entity_ids?.length || 0;



  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow h-full result-card group relative">
      {/* Action buttons - positioned at bottom center, visible on hover for entities */}
      {type === 'entity' && entityId && (
        <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <Button
            variant="secondary"
            size="icon"
            className="h-6 w-6 rounded-full shadow-md"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDetailsOpen(true);
            }}
            title="View details"
          >
            <Info className="h-3 w-3" />
          </Button>
          <Button
            variant={selected ? "default" : "secondary"}
            size="icon"
            className="h-6 w-6 rounded-full shadow-md"
            onClick={handleAddToSelection}
            title={selected ? "Remove from selection" : "Add to selection"}
          >
            {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </Button>
        </div>
      )}

      {/* Entity Details Dialog */}
      <EntityDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        entity={result}
      />

      {/* Full-screen descriptions dialog */}
      <Dialog open={descriptionsOpen} onOpenChange={setDescriptionsOpen}>
        <DialogContent className="w-screen h-screen max-w-none rounded-none p-0 gap-0 flex flex-col">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle className="text-left">Descriptions</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-6">
              {descriptionSections.map((section) => (
                <section key={`${result.id}-description-section-${section.label}`} className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {section.label}
                  </h3>
                  <div className="space-y-2">
                    {section.items.map((item, idx) => (
                      <p key={`${result.id}-description-section-item-${section.label}-${idx}`} className="text-sm leading-relaxed text-foreground">
                        <span dangerouslySetInnerHTML={{ __html: convertEmToHighlight(item) }} />
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <CardHeader className="relative space-y-0 p-3 border-b shrink-0">
        <CardTitle className="text-lg line-clamp-3">
          <span dangerouslySetInnerHTML={{ __html: title }} />
        </CardTitle>
      </CardHeader>

      {/* Show content section only when there is actual content */}
      {hasMiddleContent && (
        <div className="flex flex-col min-h-0 flex-grow">
          <CardContent className="px-4 overflow-hidden flex flex-col flex-grow min-h-0">
            {/* Description */}
            {descriptionSections.length > 0 && (
              <ScrollArea
                className="flex-1 min-h-0 max-h-56 w-full mb-2 cursor-zoom-in"
                onClick={() => setDescriptionsOpen(true)}
              >
                <div className="space-y-3 text-sm text-muted-foreground pr-1">
                  {descriptionSections.map((section) => (
                    <div key={`${result.id}-description-preview-${section.label}`} className="space-y-1">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
                        {section.label}
                      </h4>
                      {section.items.map((item, index) => (
                        <p key={`${result.id}-description-preview-item-${section.label}-${index}`}>
                          <span dangerouslySetInnerHTML={{ __html: convertEmToHighlight(item) }} />
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

          </CardContent>
        </div>
      )}

      {/* Identifiers section */}
      {type === 'entity' && <IdentifiersDisplay identifiers={identifiers} />}

      <CardFooter className={`flex items-center justify-between shrink-0 p-2.5 ${(descriptionSections.length > 0 || identifiers.length > 0) ? 'border-t' : ''}`}>
        {/* Stats */}
        <div className="flex items-center gap-3 text-sm flex-wrap">
          {type === 'entity' && interactionCount > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Network className="h-4 w-4" />
              <span>{interactionCount}</span>
            </div>
          )}
          {type === 'entity' && complexes.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Shapes className="h-4 w-4" />
              <span>{complexes.length}</span>
            </div>
          )}
          {type === 'entity' && cvTerms.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Tag className="h-4 w-4" />
              <span>{cvTerms.length}</span>
            </div>
          )}
          {type === 'entity' && references.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>{references.length}</span>
            </div>
          )}
          {type === 'entity' && sources.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Database className="h-4 w-4" />
              <span>{sources.length}</span>
            </div>
          )}
          {type === 'cv_term' && entityCount > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Tag className="h-4 w-4" />
              <span>{entityCount}</span>
            </div>
          )}
          {type === 'cv_term' && synonyms.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              {synonyms.length} synonym{synonyms.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
        {/* Badge */}
        <Badge variant="secondary" className="text-xs">
          {subtitle}
        </Badge>
      </CardFooter>
    </Card>
  );
}

/**
 * Compact content version of ResultCard for use in hover cards.
 * Displays title, definition/description, and entity type without Card wrapper.
 */
export function ResultCardContent({ result }: { result: SearchResult }) {
  const type = result.type || "entity";

  // Extract data
  const descriptions = result._formatted?.descriptions || result.descriptions || [];
  const names = result._formatted?.names || result.names || [];
  const geneSymbols = result._formatted?.gene_symbols || result.gene_symbols || [];
  const entityType = result._formatted?.entity_type || result.entity_type;
  const namespaceName = result._formatted?.namespace_name || result.namespace_name;
  const definition = result._formatted?.definition || result.definition;
  const descriptionSections = getDescriptionSections(definition, descriptions);

  const entityTypeLabel = entityType ? entityType.split(':')[0] : "Entity";

  // Determine title
  let title = "";
  let subtitle = "";

  if (type === 'entity' || type === 'cv_term') {
    const geneSymbol = geneSymbols.length > 0 ? geneSymbols[0] : undefined;
    const name = names.length > 0 ? names[0] : undefined;
    const displayName = result._formatted?.name || result.name || geneSymbol || name || `Entity ${result.entity_id || result.id}`;
    title = displayName;
    subtitle = namespaceName || entityTypeLabel;
  }

  return (
    <div className="space-y-2 p-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm leading-tight line-clamp-2">
          {title}
        </h4>
        <Badge variant="secondary" className="text-xs flex-shrink-0">
          {subtitle}
        </Badge>
      </div>

      {/* Definition/Description */}
      {descriptionSections.length > 0 && (
        <div className="h-24 overflow-y-auto">
          <div className="space-y-2 pr-2">
            {descriptionSections.map((section) => (
              <div key={`${result.id}-hover-description-section-${section.label}`} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">{section.label}</p>
                {section.items.slice(0, 1).map((item, index) => (
                  <p key={`${result.id}-hover-description-${section.label}-${index}`} className="text-xs text-muted-foreground">
                    {item}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
