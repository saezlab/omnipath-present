import { useMemo } from "react";
import { Search, ArrowRight, Layers3, ExternalLink, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EntityBadge } from "@/components/entity-badge";
import {
  getEntityDisplayName,
  getEntityPublicId,
  getEntitySecondaryName,
  getEntityTypeLabel,
} from "@/lib/entities/display";
import type { InteractionDetailsData, InteractionListRow } from "@/features/interactions-search/types";

interface InteractionDetailsProps {
  selectedInteraction: InteractionDetailsData | InteractionListRow | null;
  evidenceLoading?: boolean;
}

type ParsedAnnotation = {
  term: string;
  termId?: string;
  value?: string;
  unit?: string;
  unitId?: string;
};

type EvidenceGroup = {
  key: string;
  source: string;
  evidenceCount: number;
  pubmedIds: string[];
  subjectAnnotations: ParsedAnnotation[];
  relationAnnotations: ParsedAnnotation[];
  objectAnnotations: ParsedAnnotation[];
};

function splitLabelAndId(value: string): { label: string; id?: string } {
  const colonIndex = value.indexOf(":");
  if (colonIndex <= 0) return { label: value };
  return {
    label: value.substring(0, colonIndex),
    id: value.substring(colonIndex + 1),
  };
}

function normalizeAnnotationArray(value: unknown): ParsedAnnotation[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.term !== "string" || !record.term.trim()) return [];

    const term = splitLabelAndId(record.term);
    const unit = typeof record.unit === "string" ? splitLabelAndId(record.unit) : undefined;

    return [{
      term: term.label,
      termId: term.id,
      value: typeof record.value === "string" ? record.value : undefined,
      unit: unit?.label,
      unitId: unit?.id,
    }];
  });
}

function dedupeAnnotations(values: ParsedAnnotation[]): ParsedAnnotation[] {
  const seen = new Set<string>();
  const deduped: ParsedAnnotation[] = [];

  for (const value of values) {
    const key = [value.term, value.termId, value.value, value.unit, value.unitId].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  return deduped.sort((a, b) => {
    const byTerm = a.term.localeCompare(b.term);
    if (byTerm !== 0) return byTerm;
    return (a.value || "").localeCompare(b.value || "");
  });
}

function splitPubmedAnnotations(annotations: ParsedAnnotation[]): {
  pubmedIds: string[];
  annotations: ParsedAnnotation[];
} {
  const pubmedIds = new Set<string>();
  const filtered: ParsedAnnotation[] = [];

  for (const annotation of annotations) {
    const normalizedTerm = annotation.term.trim().toLowerCase();
    const isPubmed = normalizedTerm === "pubmed" || normalizedTerm === "pmid";
    if (!isPubmed) {
      filtered.push(annotation);
      continue;
    }

    const matches = `${annotation.value || ""} ${annotation.termId || ""} ${annotation.unitId || ""}`.match(/\b\d{4,9}\b/g);
    matches?.forEach((id) => pubmedIds.add(id));
  }

  return {
    pubmedIds: Array.from(pubmedIds).sort((a, b) => Number(a) - Number(b)),
    annotations: filtered,
  };
}

function formatAnnotationText(annotation: ParsedAnnotation): string {
  if (!annotation.value) return annotation.term;
  return `${annotation.term}: ${annotation.value}${annotation.unit ? ` ${annotation.unit}` : ""}`;
}

function AnnotationChips({
  annotations,
  emptyLabel,
}: {
  annotations: ParsedAnnotation[];
  emptyLabel: string;
}) {
  if (annotations.length === 0) {
    return <div className="text-xs text-muted-foreground">{emptyLabel}</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {annotations.map((annotation, index) => (
        <div key={`${annotation.term}-${annotation.value || ""}-${index}`} className="rounded-md border bg-background px-2.5 py-1.5 text-xs">
          <div className="font-medium leading-tight">{formatAnnotationText(annotation)}</div>
          {(annotation.termId || annotation.unitId) && (
            <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
              {[annotation.termId, annotation.unitId].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function buildEvidenceGroups(evidence: InteractionDetailsData["evidence"]): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();

  for (const row of evidence) {
    const subjectSplit = splitPubmedAnnotations(normalizeAnnotationArray(row.subjectAttributes));
    const relationSplit = splitPubmedAnnotations([
      ...normalizeAnnotationArray(row.recordAttributes),
      ...normalizeAnnotationArray(row.evidence),
    ]);
    const objectSplit = splitPubmedAnnotations(normalizeAnnotationArray(row.objectAttributes));

    const key = row.source || "unknown";
    const existing = groups.get(key) ?? {
      key,
      source: row.source,
      evidenceCount: 0,
      pubmedIds: [],
      subjectAnnotations: [],
      relationAnnotations: [],
      objectAnnotations: [],
    };

    existing.evidenceCount += 1;
    existing.pubmedIds = Array.from(new Set([
      ...existing.pubmedIds,
      ...subjectSplit.pubmedIds,
      ...relationSplit.pubmedIds,
      ...objectSplit.pubmedIds,
    ])).sort((a, b) => Number(a) - Number(b));
    existing.subjectAnnotations.push(...subjectSplit.annotations);
    existing.relationAnnotations.push(...relationSplit.annotations);
    existing.objectAnnotations.push(...objectSplit.annotations);

    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      subjectAnnotations: dedupeAnnotations(group.subjectAnnotations),
      relationAnnotations: dedupeAnnotations(group.relationAnnotations),
      objectAnnotations: dedupeAnnotations(group.objectAnnotations),
    }))
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.source.localeCompare(b.source));
}

function getAnnotationTermCount(evidence: InteractionDetailsData["evidence"]): number {
  const terms = new Set<string>();

  for (const row of evidence) {
    [row.subjectAttributes, row.recordAttributes, row.evidence, row.objectAttributes].forEach((value) => {
      for (const annotation of normalizeAnnotationArray(value)) {
        terms.add(annotation.termId || annotation.term);
      }
    });
  }

  return terms.size;
}

export function InteractionDetails({ selectedInteraction, evidenceLoading = false }: InteractionDetailsProps) {
  const detailedInteraction = selectedInteraction && "evidence" in selectedInteraction ? selectedInteraction : null;
  const evidence = detailedInteraction?.evidence ?? [];

  const evidenceGroups = useMemo(() => buildEvidenceGroups(evidence), [evidence]);
  const annotationTermCount = useMemo(() => getAnnotationTermCount(evidence), [evidence]);

  if (!selectedInteraction) {
    return (
      <div className="p-4">
        <div className="rounded-lg border bg-card p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <Search className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="mb-2 text-lg font-medium text-muted-foreground">No relation selected</p>
            <p className="text-sm text-muted-foreground">Select a relation to view detailed evidence</p>
          </div>
        </div>
      </div>
    );
  }

  const subjectEntity = selectedInteraction.subjectEntity;
  const objectEntity = selectedInteraction.objectEntity;
  const subjectId = getEntityPublicId(subjectEntity);
  const objectId = getEntityPublicId(objectEntity);

  return (
    <div className="space-y-6 p-4 pb-8">
      <div className="rounded-lg border bg-card p-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-6">
          <div className="min-w-0">
            <EntityBadge
              displayName={getEntityDisplayName(subjectEntity)}
              canonicalIdentifier={getEntitySecondaryName(subjectEntity) || subjectEntity.canonicalIdentifier}
              entityId={subjectId}
              entityType={getEntityTypeLabel(subjectEntity)}
            />
          </div>

          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ArrowRight className="h-8 w-8" />
            <Badge variant="outline">{selectedInteraction.relation.predicate || "—"}</Badge>
          </div>

          <div className="min-w-0">
            <EntityBadge
              displayName={getEntityDisplayName(objectEntity)}
              canonicalIdentifier={getEntitySecondaryName(objectEntity) || objectEntity.canonicalIdentifier}
              entityId={objectId}
              entityType={getEntityTypeLabel(objectEntity)}
            />
          </div>
        </div>

        <div className="space-y-4 border-t pt-4">
          {selectedInteraction.relation.participantTypes.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {selectedInteraction.relation.participantTypes.map((participantType) => (
                <Badge key={participantType} variant="secondary">{participantType}</Badge>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{selectedInteraction.relation.evidenceCount}</div>
              <div className="text-xs text-muted-foreground">Evidence{selectedInteraction.relation.evidenceCount !== 1 ? "s" : ""}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{annotationTermCount}</div>
              <div className="text-xs text-muted-foreground">Annotation Term{annotationTermCount !== 1 ? "s" : ""}</div>
            </div>
          </div>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={["summary", "evidence"]} className="space-y-4">
        <AccordionItem value="summary" className="rounded-lg border">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <span className="font-medium">Evidence summary table</span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {evidenceLoading ? (
              <div className="text-sm text-muted-foreground">Loading evidence…</div>
            ) : evidenceGroups.length === 0 ? (
              <div className="text-sm text-muted-foreground">No evidence rows available.</div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-center">Evidence</TableHead>
                      <TableHead className="text-center">Subject ann.</TableHead>
                      <TableHead className="text-center">Relation ann.</TableHead>
                      <TableHead className="text-center">Object ann.</TableHead>
                      <TableHead className="text-center">PubMed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evidenceGroups.map((group) => (
                      <TableRow key={group.key}>
                        <TableCell className="font-medium">{group.source || "—"}</TableCell>
                        <TableCell className="text-center">{group.evidenceCount}</TableCell>
                        <TableCell className="text-center">{group.subjectAnnotations.length}</TableCell>
                        <TableCell className="text-center">{group.relationAnnotations.length}</TableCell>
                        <TableCell className="text-center">{group.objectAnnotations.length}</TableCell>
                        <TableCell className="text-center">{group.pubmedIds.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="evidence" className="rounded-lg border">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5" />
              <span className="font-medium">Aggregated evidence</span>
              <Badge variant="secondary">{evidence.length}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {evidenceLoading ? (
              <div className="text-sm text-muted-foreground">Loading evidence…</div>
            ) : evidenceGroups.length === 0 ? (
              <div className="text-sm text-muted-foreground">No evidence rows available.</div>
            ) : (
              <div className="space-y-4">
                {evidenceGroups.map((group) => (
                  <div key={group.key} className="rounded-lg border bg-muted/20 p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {group.evidenceCount} evidence{group.evidenceCount !== 1 ? "s" : ""}
                        </Badge>
                      </div>

                      <Badge variant="secondary" className="text-xs">
                        {group.source || "Unknown source"}
                      </Badge>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-blue-700">
                          Subject ({subjectId})
                        </div>
                        <AnnotationChips annotations={group.subjectAnnotations} emptyLabel="No subject annotations" />
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Relation</div>
                        <AnnotationChips annotations={group.relationAnnotations} emptyLabel="No relation-level annotations" />
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-purple-700">
                          Object ({objectId})
                        </div>
                        <AnnotationChips annotations={group.objectAnnotations} emptyLabel="No object annotations" />
                      </div>
                    </div>

                    <div className="mt-4 border-t pt-4">
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">PubMed</div>
                      {group.pubmedIds.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {group.pubmedIds.map((pubmedId) => (
                            <a
                              key={pubmedId}
                              href={`https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
                            >
                              PMID:{pubmedId}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Minus className="h-3 w-3" />
                          No PubMed references available
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
