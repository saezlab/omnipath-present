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
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Network, Tag, Shapes, FileText, Database, Plus, Check, FlaskConical, ChevronDown, ChevronUp, Copy, Loader2, Info } from "lucide-react";
import { useEntitySelection } from "@/contexts/entity-selection-context";
import { MoleculeStructure } from "./molecule_structure";
import { EntityDetailsDialog } from "./entity-details-dialog";
import { getUnifiedCvTerms } from "@/lib/cv-terms";
import {
  classifyEntityIdentifiers,
  getEntityDescriptions,
  getEntityDisplayName,
  getEntityIdentifiers,
  getEntityPublicId,
  getEntitySecondaryName,
  getEntitySmiles,
  getEntityTypeLabel,
  getEntityTypeValue,
  isSmallMoleculeEntity,
  type EntityLike,
} from "@/lib/entities/display";
import { useEntity } from "@/hooks/use-entity";
import type { Identifier } from "@/types/entities";
import type { SearchResult } from "@/types/search-results";

// Component that shows a ResultCardContent in a HoverCard for entities
export function EntityHoverCard({
  entityId,
  children
}: {
  entityId: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { data: entity, loading } = useEntity(isOpen ? entityId : undefined);

  return (
    <HoverCard openDelay={300} closeDelay={100} onOpenChange={setIsOpen}>
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
  const [isOpen, setIsOpen] = useState(false);

  const { data: term, isLoading: loading } = useQuery({
    queryKey: ["cv-term", termId],
    enabled: isOpen && termId.trim().length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch("/api/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term_ids: [termId] }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch term (${response.status})`);
      }

      const data = await response.json() as {
        terms?: Record<string, { id: string; name?: string; definition?: string; namespace?: string } | null>;
      };
      const termData = data.terms?.[termId];

      if (!termData) {
        return null;
      }

      return {
        id: termData.id,
        type: "cv_term",
        name: termData.name,
        definition: termData.definition,
        namespace_name: termData.namespace,
      } as SearchResult;
    },
  });

  return (
    <HoverCard openDelay={300} closeDelay={100} onOpenChange={setIsOpen}>
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

const isSmallMolecule = (result: SearchResult): boolean => isSmallMoleculeEntity(result as EntityLike);

export type { Identifier } from "@/types/entities";
export type { SearchResult } from "@/types/search-results";

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
  const entity = result as EntityLike;
  const entityTypeLabel = getEntityTypeLabel(entity) || "Small Molecule";
  const identifiers = useMemo(() => getEntityIdentifiers(entity), [entity]);
  const primaryName = useMemo(() => getEntityDisplayName(entity), [entity]);
  const smiles = useMemo(() => getEntitySmiles(entity), [entity]);

  const { addEntity, removeEntity, isSelected } = useEntitySelection();
  const entityId = getEntityPublicId(entity);
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
      {entityId && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <Button
            size="sm"
            variant={selected ? "default" : "outline"}
            onClick={handleAddToSelection}
            className="h-8 shrink-0"
            title={selected ? "Remove from selection" : "Add to selection"}
          >
            {selected ? <Check className="size-4" /> : <Plus className="size-4" />}
            {selected ? "Selected" : "Add"}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full shadow-sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDetailsOpen(true);
            }}
            title="View details"
          >
            <Info className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Entity Details Dialog */}
      <EntityDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        entity={entity}
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

export function ResultCard({ result }: { result: SearchResult | EntityLike }) {
  const { addEntity, removeEntity, isSelected } = useEntitySelection();
  const type = ('type' in result && result.type) || "entity";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [descriptionsOpen, setDescriptionsOpen] = useState(false);

  if (type === "source") {
    const sourceResult = result as SearchResult;
    const visibleFunctionRecords = (sourceResult.function_records || []).filter(
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
          <CardTitle className="text-lg line-clamp-2">{sourceResult.source_name || sourceResult.name || sourceResult.source_ref}</CardTitle>
        </CardHeader>

        {sourceResult.resource_description && (
          <CardContent className="px-4 py-3 flex-grow min-h-0">
            <p className="text-sm text-muted-foreground line-clamp-4">{sourceResult.resource_description}</p>
          </CardContent>
        )}

        {visibleFunctionRecords.length > 0 && (
          <div className="border-t px-3 py-2 bg-muted/30">
            <div className="flex flex-wrap gap-1.5 text-xs">
              {visibleFunctionRecords.map((fn) => (
                <Badge key={`${sourceResult.id}-${fn.function}`} variant="outline" className="text-xs">
                  {fn.function} ({fn.records})
                </Badge>
              ))}
            </div>
          </div>
        )}

        <CardFooter className="flex items-center justify-between shrink-0 p-2.5 border-t">
          <div className="flex items-center gap-3 text-sm flex-wrap">
            {sourceResult.total_records !== undefined && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Database className="h-4 w-4" />
                <span>{sourceResult.total_records}</span>
              </div>
            )}
          </div>
          <Badge variant="secondary" className="text-xs">
            {cvLabel(sourceResult.license_cv) || "Source"}
          </Badge>
        </CardFooter>
      </Card>
    );
  }

  // Check if this is a small molecule and render specialized card
  if (isSmallMolecule(result as SearchResult)) {
    return <MoleculeResultCard result={result as SearchResult} />;
  }

  const searchResult = result as SearchResult;
  const entity = type === 'entity' ? result as EntityLike : null;
  const getDisplayName = () => entity ? getEntityDisplayName(entity) : `Entity ${searchResult.id}`;

  const entityId = entity ? getEntityPublicId(entity) : (searchResult.entity_id ?? searchResult.id)?.toString();
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
        entityId: searchResult.entity_id,
        name: getDisplayName(),
        type: (entity ? getEntityTypeLabel(entity) : searchResult.entity_type?.split(':')[0]) || searchResult.type,
        cv_terms: getUnifiedCvTerms(searchResult),
        references: searchResult.references,
        fullResult: searchResult,
      });
    }
  };

  // Extract data based on type
  const descriptions = entity ? getEntityDescriptions(entity) : (searchResult.descriptions || []);
  const { names, geneSymbols, synonyms } = entity
    ? classifyEntityIdentifiers(entity)
    : { names: searchResult.names || [], geneSymbols: searchResult.gene_symbols || [], synonyms: searchResult.synonyms || [] };
  const identifiers: Identifier[] = entity ? getEntityIdentifiers(entity) : (searchResult.identifiers || []);
  const references = searchResult.references || [];
  const sources = searchResult.sources || entity?.sources || [];
  const complexes = searchResult.complexes || [];
  const cvTerms = getUnifiedCvTerms(searchResult);
  const entityType = entity ? getEntityTypeValue(entity) : searchResult.entity_type;
  const namespaceName = searchResult.namespace_name;
  const definition = searchResult.definition;
  const descriptionSections = getDescriptionSections(definition, descriptions);

  const entityTypeLabel = entity ? getEntityTypeLabel(entity) : (entityType ? entityType.split(':')[0] : "Entity");
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

  if (type === 'entity' && entity) {
    const displayName = getEntityDisplayName(entity);
    const secondaryName = getEntitySecondaryName(entity);
    const truncatedDisplayName = truncateText(displayName);

    if (secondaryName) {
      primaryIdentifier = secondaryName;
      const truncatedPrimaryId = truncateText(primaryIdentifier);
      title = `${truncatedDisplayName} <span class="text-sm text-muted-foreground">(${truncatedPrimaryId})</span>`;
    } else {
      title = truncatedDisplayName;
    }

    subtitle = entityTypeLabel;
  } else if (type === 'cv_term') {
    const displayName = searchResult.name || `Term ${searchResult.id}`;
    const truncatedDisplayName = truncateText(displayName);
    title = truncatedDisplayName;
    subtitle = namespaceName || "Ontology Term";
    primaryIdentifier = searchResult.id;
  }

  // Stats
  const interactionCount = searchResult.num_interactions || 0;
  const entityCount = searchResult.associated_entity_ids?.length || 0;
  const resultKey = entity ? getEntityPublicId(entity) : searchResult.id;

  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow h-full result-card group relative">
      {type === 'entity' && entityId && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <Button
            size="sm"
            variant={selected ? "default" : "outline"}
            onClick={handleAddToSelection}
            className="h-8 shrink-0"
            title={selected ? "Remove from selection" : "Add to selection"}
          >
            {selected ? <Check className="size-4" /> : <Plus className="size-4" />}
            {selected ? "Selected" : "Add"}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full shadow-sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDetailsOpen(true);
            }}
            title="View details"
          >
            <Info className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Entity Details Dialog */}
      <EntityDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        entity={entity}
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
                <section key={`${resultKey}-description-section-${section.label}`} className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {section.label}
                  </h3>
                  <div className="space-y-2">
                    {section.items.map((item, idx) => (
                      <p key={`${resultKey}-description-section-item-${section.label}-${idx}`} className="text-sm leading-relaxed text-foreground">
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

      <CardHeader className="relative space-y-0 p-3 pr-24 border-b shrink-0">
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
                <div className="min-w-0 max-w-full space-y-3 pr-1 text-sm text-muted-foreground">
                  {descriptionSections.map((section) => (
                    <div key={`${resultKey}-description-preview-${section.label}`} className="min-w-0 max-w-full space-y-1">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
                        {section.label}
                      </h4>
                      {section.items.map((item, index) => (
                        <p key={`${resultKey}-description-preview-item-${section.label}-${index}`} className="max-w-full whitespace-normal break-words">
                          <span className="whitespace-normal break-words" dangerouslySetInnerHTML={{ __html: convertEmToHighlight(item) }} />
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
export function ResultCardContent({ result }: { result: SearchResult | EntityLike }) {
  const type = ('type' in result && result.type) || "entity";
  const entity = type === 'entity' ? result as EntityLike : null;

  const descriptions = entity ? getEntityDescriptions(entity) : ((result as SearchResult).descriptions || []);
  const namespaceName = 'namespace_name' in result ? result.namespace_name : undefined;
  const definition = 'definition' in result ? result.definition : undefined;
  const descriptionSections = getDescriptionSections(definition, descriptions);
  const entityTypeLabel = entity ? getEntityTypeLabel(entity) : "Entity";

  let title = "";
  let subtitle = "";
  const resultKey = entity ? getEntityPublicId(entity) : ('id' in result ? result.id : 'entity');

  if (type === 'entity' && entity) {
    title = getEntityDisplayName(entity);
    subtitle = entityTypeLabel;
  } else if (type === 'cv_term') {
    const searchResult = result as SearchResult;
    title = searchResult.name || `Term ${searchResult.id}`;
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
              <div key={`${resultKey}-hover-description-section-${section.label}`} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">{section.label}</p>
                {section.items.slice(0, 1).map((item, index) => (
                  <p key={`${resultKey}-hover-description-${section.label}-${index}`} className="text-xs text-muted-foreground">
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
