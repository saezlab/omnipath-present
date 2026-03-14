import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { FileText, Search, ArrowRight, Minus, Plus, Layers3 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMemo } from "react"
import { MeilisearchInteraction, InteractionEvidence, InteractionDirection } from "@/types/meilisearch"

interface InteractionDetailsProps {
  selectedInteraction: MeilisearchInteraction | null
}

// Helper function to extract label from "Label:ID" format
function extractLabel(value: string): string {
  const colonIndex = value.indexOf(':');
  return colonIndex > 0 ? value.substring(0, colonIndex) : value;
}

function splitLabelAndId(value: string): { label: string; id?: string } {
  const colonIndex = value.indexOf(':');
  if (colonIndex <= 0) return { label: value };
  return {
    label: value.substring(0, colonIndex),
    id: value.substring(colonIndex + 1),
  };
}

// Helper function to determine if members should be swapped based on direction
function shouldSwapMembers(directions: InteractionDirection[]): boolean {
  if (!directions || directions.length === 0) return false;
  return directions[0]?.direction === 'b-a';
}

type FormattedAnnotation = {
  term: string;
  termId?: string;
  value?: string;
  unit?: string;
  unitId?: string;
};

function formatAnnotations(
  annotations: { term: string; value?: string | null; unit?: string | null }[]
): FormattedAnnotation[] {
  return annotations.map((a) => {
    const term = splitLabelAndId(a.term);
    const unit = a.unit ? splitLabelAndId(a.unit) : undefined;

    return {
      term: term.label,
      termId: term.id,
      value: a.value ?? undefined,
      unit: unit?.label,
      unitId: unit?.id,
    };
  });
}

function AnnotationChips({
  annotations,
  emptyLabel,
}: {
  annotations: FormattedAnnotation[];
  emptyLabel: string;
}) {
  if (annotations.length === 0) {
    return <div className="text-xs text-muted-foreground">{emptyLabel}</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {annotations.map((annotation, idx) => {
        const valueText = annotation.value
          ? `${annotation.term}: ${annotation.value}${annotation.unit ? ` ${annotation.unit}` : ''}`
          : annotation.term;
        const meta = [annotation.termId, annotation.unitId].filter(Boolean).join(' · ');

        return (
          <div key={idx} className="rounded-md border bg-background px-2.5 py-1.5 text-xs">
            <div className="font-medium leading-tight">{valueText}</div>
            {meta && <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{meta}</div>}
          </div>
        );
      })}
    </div>
  );
}

// Helper to determine overall sign from directions
function getOverallSign(directions: InteractionDirection[]): 'positive' | 'negative' | 'mixed' | null {
  if (!directions || directions.length === 0) return null;

  const hasPositive = directions.some(d => d.sign === 1 || d.sign === 0);
  const hasNegative = directions.some(d => d.sign === -1 || d.sign === 0);

  if (hasPositive && hasNegative) return 'mixed';
  if (hasPositive) return 'positive';
  if (hasNegative) return 'negative';
  return null;
}

const getSignColor = (sign: 'positive' | 'negative' | 'mixed' | null) => {
  if (sign === 'positive') return 'text-green-600 bg-green-50 border-green-200';
  if (sign === 'negative') return 'text-red-600 bg-red-50 border-red-200';
  if (sign === 'mixed') return 'text-orange-600 bg-orange-50 border-orange-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

const getSignLabel = (sign: 'positive' | 'negative' | 'mixed' | null) => {
  if (sign === 'positive') return 'Activation';
  if (sign === 'negative') return 'Inhibition';
  if (sign === 'mixed') return 'Mixed';
  return 'Unknown';
}

// Extract all unique terms from evidence annotations
function extractAnnotationTerms(evidence: InteractionEvidence[]): string[] {
  const terms = new Set<string>();
  evidence.forEach(e => {
    e.interaction_annotations?.forEach(a => terms.add(a.term));
    e.member_a_annotations?.forEach(a => terms.add(a.term));
    e.member_b_annotations?.forEach(a => terms.add(a.term));
  });
  return Array.from(terms);
}

export function InteractionDetails({ selectedInteraction }: InteractionDetailsProps) {
  const overallSign = useMemo(() => {
    if (!selectedInteraction) return null;
    return getOverallSign(selectedInteraction.directions);
  }, [selectedInteraction]);

  const getInteractionColor = () => {
    if (!selectedInteraction) return "text-gray-500";
    if (overallSign === 'positive') return "text-green-500";
    if (overallSign === 'negative') return "text-red-500";
    if (overallSign === 'mixed') return "text-orange-500";
    return "text-gray-500";
  }

  const evidenceStats = useMemo(() => {
    if (!selectedInteraction?.evidence) return null;

    const allTerms = extractAnnotationTerms(selectedInteraction.evidence);

    return {
      total: selectedInteraction.evidence.length,
      directions: selectedInteraction.directions.length,
      annotationTerms: allTerms.length,
    };
  }, [selectedInteraction]);

  const evidenceGroups = useMemo(() => {
    if (!selectedInteraction?.evidence) return [] as Array<{ source: string; items: InteractionEvidence[] }>;

    const groups = new Map<string, InteractionEvidence[]>();
    selectedInteraction.evidence.forEach((item) => {
      const source = item.source ? extractLabel(item.source) : 'Unknown source';
      groups.set(source, [...(groups.get(source) || []), item]);
    });

    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([source, items]) => ({ source, items }));
  }, [selectedInteraction]);

  if (!selectedInteraction) {
    return (
      <div className="p-4">
        <div className="rounded-lg border bg-card p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">No interaction selected</p>
            <p className="text-sm text-muted-foreground">Select an interaction to view detailed evidence</p>
          </div>
        </div>
      </div>
    )
  }

  const swap = shouldSwapMembers(selectedInteraction.directions);
  const sourceId = swap ? selectedInteraction.member_b_id : selectedInteraction.member_a_id;
  const targetId = swap ? selectedInteraction.member_a_id : selectedInteraction.member_b_id;
  const sourceType = swap
    ? (selectedInteraction.member_types[1] ? extractLabel(selectedInteraction.member_types[1]) : 'Unknown')
    : (selectedInteraction.member_types[0] ? extractLabel(selectedInteraction.member_types[0]) : 'Unknown');
  const targetType = swap
    ? (selectedInteraction.member_types[0] ? extractLabel(selectedInteraction.member_types[0]) : 'Unknown')
    : (selectedInteraction.member_types[1] ? extractLabel(selectedInteraction.member_types[1]) : 'Unknown');

  return (
    <div className="p-4 pb-8 space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-center gap-6 py-6">
          <div className="flex flex-col items-center">
            <span className="font-bold text-lg text-center break-all">{sourceId}</span>
            <Badge variant="secondary" className="text-xs mt-1">{sourceType}</Badge>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className={cn("flex items-center", getInteractionColor())}>
              {selectedInteraction.has_direction ? (
                <ArrowRight className="h-8 w-8" />
              ) : (
                <Minus className="h-8 w-8" />
              )}
            </div>
            {overallSign && (
              <Badge className={cn("text-xs px-2 py-1 border", getSignColor(overallSign))}>
                {overallSign === 'positive' && <Plus className="h-3 w-3 mr-1" />}
                {overallSign === 'negative' && <Minus className="h-3 w-3 mr-1" />}
                {getSignLabel(overallSign)}
              </Badge>
            )}
          </div>

          <div className="flex flex-col items-center">
            <span className="font-bold text-lg text-center break-all">{targetId}</span>
            <Badge variant="secondary" className="text-xs mt-1">{targetType}</Badge>
          </div>
        </div>

        {evidenceStats && (
          <div className="grid grid-cols-3 gap-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{evidenceStats.total}</div>
              <div className="text-xs text-muted-foreground">Evidence{evidenceStats.total !== 1 ? 's' : ''}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{evidenceStats.directions}</div>
              <div className="text-xs text-muted-foreground">Direction{evidenceStats.directions !== 1 ? 's' : ''}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{evidenceStats.annotationTerms}</div>
              <div className="text-xs text-muted-foreground">Annotation Term{evidenceStats.annotationTerms !== 1 ? 's' : ''}</div>
            </div>
          </div>
        )}
      </div>

      <Accordion type="multiple" defaultValue={["directions", "evidence"]} className="space-y-4">
        {selectedInteraction.directions.length > 0 && (
          <AccordionItem value="directions" className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-5 w-5" />
                <span className="font-medium">Directions & Signs</span>
                <Badge variant="secondary" className="ml-2">
                  {selectedInteraction.directions.length}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="space-y-2">
                {selectedInteraction.directions.map((dir, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-3 p-3 border rounded-lg bg-muted/30">
                    <Badge variant="outline" className="text-xs">
                      {dir.direction === 'a-b' ? `${selectedInteraction.member_a_id} → ${selectedInteraction.member_b_id}` : `${selectedInteraction.member_b_id} → ${selectedInteraction.member_a_id}`}
                    </Badge>
                    <Badge
                      className={cn(
                        "text-xs",
                        dir.sign === 1 && "text-green-600 bg-green-50 border-green-200",
                        dir.sign === -1 && "text-red-600 bg-red-50 border-red-200",
                        dir.sign === 0 && "text-orange-600 bg-orange-50 border-orange-200"
                      )}
                    >
                      {dir.sign === 1 && <Plus className="h-3 w-3 mr-1" />}
                      {dir.sign === -1 && <Minus className="h-3 w-3 mr-1" />}
                      {dir.sign === 1 ? 'Activation' : dir.sign === -1 ? 'Inhibition' : 'Mixed'}
                    </Badge>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        <AccordionItem value="evidence" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5" />
              <span className="font-medium">Evidence by source</span>
              <Badge variant="secondary" className="ml-2">
                {selectedInteraction.evidence?.length || 0}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-6">
              {evidenceGroups.map((group) => (
                <div key={group.source} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{group.source}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {group.items.length} evidence{group.items.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="space-y-4">
                    {group.items.map((evidence, index) => {
                      const sourceAnnotations = formatAnnotations(swap ? evidence.member_b_annotations : evidence.member_a_annotations);
                      const targetAnnotations = formatAnnotations(swap ? evidence.member_a_annotations : evidence.member_b_annotations);
                      const interactionAnnotations = formatAnnotations(evidence.interaction_annotations || []);
                      const sourceMeta = splitLabelAndId(evidence.source);

                      return (
                        <div key={`${group.source}-${evidence.evidence_serial ?? index}`} className="rounded-lg border bg-muted/20 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  Evidence {evidence.evidence_serial ?? index + 1}: {sourceMeta.label}
                                </Badge>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {interactionAnnotations.length + sourceAnnotations.length + targetAnnotations.length} annotations
                            </div>
                          </div>

                          <div className="grid gap-4 lg:grid-cols-3">
                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Interaction</div>
                              <AnnotationChips
                                annotations={interactionAnnotations}
                                emptyLabel="No interaction-level annotations"
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-blue-700">
                                Source ({sourceId})
                              </div>
                              <AnnotationChips
                                annotations={sourceAnnotations}
                                emptyLabel="No source annotations"
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-purple-700">
                                Target ({targetId})
                              </div>
                              <AnnotationChips
                                annotations={targetAnnotations}
                                emptyLabel="No target annotations"
                              />
                            </div>
                          </div>

                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {selectedInteraction.interaction_annotation_terms && selectedInteraction.interaction_annotation_terms.length > 0 && (
          <AccordionItem value="annotation_terms" className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                <span className="font-medium">All Annotation Terms</span>
                <Badge variant="secondary" className="ml-2">
                  {selectedInteraction.interaction_annotation_terms.length}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                {selectedInteraction.interaction_annotation_terms.map((term, idx) => {
                  const parsed = splitLabelAndId(term);
                  return (
                    <div key={idx} className="rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs">
                      <div className="font-medium">{parsed.label}</div>
                      {parsed.id && <div className="text-[11px] text-muted-foreground">{parsed.id}</div>}
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  )
}
