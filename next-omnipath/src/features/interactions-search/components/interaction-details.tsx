import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { FileText, Search, ArrowRight, Minus, Plus, Layers3, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMemo } from "react"
import { MeilisearchInteraction, InteractionEvidence, InteractionDirection } from "@/types/meilisearch"
import { CvTermHoverCard } from "@/features/search/components/result-card"
import { EntityBadge } from "@/components/entity-badge"

interface InteractionDetailsProps {
  selectedInteraction: MeilisearchInteraction | null
}

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

function getInteractionDirections(interaction: MeilisearchInteraction | null): InteractionDirection[] {
  if (!interaction) return [];
  if (interaction.directions?.length) return interaction.directions;
  return [{
    direction: interaction.is_directed ? 'a-b' : 'undirected',
    sign: interaction.sign,
  }];
}

function shouldSwapMembers(_directions: InteractionDirection[]): boolean {
  return false;
}

type FormattedAnnotation = {
  term: string;
  termId?: string;
  value?: string;
  unit?: string;
  unitId?: string;
};

type EvidenceSign = -1 | 0 | 1 | null;
type EvidenceDirection = 'a-b' | 'b-a' | 'undirected' | null;

type AggregatedEvidenceGroup = {
  key: string;
  direction: EvidenceDirection;
  sign: EvidenceSign;
  label: string;
  evidenceCount: number;
  sourceDatabases: string[];
  pubmedIds: string[];
  sourceAnnotations: FormattedAnnotation[];
  interactionAnnotations: FormattedAnnotation[];
  targetAnnotations: FormattedAnnotation[];
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

function dedupeAnnotations(annotations: FormattedAnnotation[]): FormattedAnnotation[] {
  const seen = new Set<string>();
  const deduped: FormattedAnnotation[] = [];

  annotations.forEach((annotation) => {
    const key = [annotation.term, annotation.termId, annotation.value, annotation.unit, annotation.unitId].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(annotation);
  });

  return deduped.sort((a, b) => {
    const byTerm = a.term.localeCompare(b.term);
    if (byTerm !== 0) return byTerm;
    const byValue = (a.value || '').localeCompare(b.value || '');
    if (byValue !== 0) return byValue;
    return (a.unit || '').localeCompare(b.unit || '');
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

        const chip = (
          <div className="rounded-md border bg-background px-2.5 py-1.5 text-xs">
            <div className="font-medium leading-tight">{valueText}</div>
            {meta && <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{meta}</div>}
          </div>
        );

        return annotation.termId ? (
          <CvTermHoverCard key={idx} termId={annotation.termId}>
            {chip}
          </CvTermHoverCard>
        ) : (
          <div key={idx}>{chip}</div>
        );
      })}
    </div>
  );
}

function getOverallSign(directions: InteractionDirection[]): 'positive' | 'negative' | null {
  if (!directions || directions.length === 0) return null;
  if (directions.some(d => d.sign === 1)) return 'positive';
  if (directions.some(d => d.sign === -1)) return 'negative';
  return null;
}

const getSignColor = (sign: 'positive' | 'negative' | null) => {
  if (sign === 'positive') return 'text-green-600 bg-green-50 border-green-200';
  if (sign === 'negative') return 'text-red-600 bg-red-50 border-red-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

const getSignLabel = (sign: 'positive' | 'negative' | null) => {
  if (sign === 'positive') return 'Activation';
  if (sign === 'negative') return 'Inhibition';
  return 'Unsigned';
}

const POSITIVE_SIGN_ACCESSIONS = new Set([
  'MI:0840', 'MI:2235', 'MI:2236', 'MI:2237', 'MI:2238', 'MI:2239',
  'OM:0901', 'OM:0902', 'OM:0903', 'OM:0905', 'OM:0930', 'OM:0950',
  'OM:0952', 'OM:1001', 'OM:1003',
]);

const NEGATIVE_SIGN_ACCESSIONS = new Set([
  'MI:0586', 'MI:2240', 'MI:2241', 'MI:2242', 'MI:2243', 'MI:2244',
  'OM:0904', 'OM:0920', 'OM:0931', 'OM:0932', 'OM:0933', 'OM:0951',
  'OM:0970', 'OM:1002', 'OM:1004', 'OM:1020', 'OM:1021',
]);

const SOURCE_ROLE_ACCESSIONS = new Set([
  'MI:0501', 'MI:0586', 'MI:0840', 'MI:1160', 'MI:2274', 'OM:1001', 'OM:1002', 'OM:1003', 'OM:1004',
]);

const TARGET_ROLE_ACCESSIONS = new Set(['MI:0502', 'MI:2275']);
const ACTIVATORY_PARAMETER_ACCESSIONS = new Set(['MI:0642']);
const INHIBITORY_PARAMETER_ACCESSIONS = new Set(['MI:0641', 'MI:0643']);

type EvidenceCombo = { direction: EvidenceDirection; sign: EvidenceSign };

function getEvidenceDirection(evidence: InteractionEvidence): EvidenceDirection {
  const raw = (evidence as InteractionEvidence & { direction?: unknown }).direction;
  if (raw === 'a-b' || raw === 'b-a') return raw;
  if (raw === 'undirected') return 'undirected';
  return null;
}

function getEvidenceSign(evidence: InteractionEvidence): EvidenceSign {
  const raw = (evidence as InteractionEvidence & { sign?: unknown }).sign;
  if (raw === 1 || raw === -1 || raw === 0) return raw;
  if (raw === 'positive') return 1;
  if (raw === 'negative') return -1;
  if (raw === 'mixed') return 0;
  return null;
}

function getTermAccession(term: string | undefined): string | null {
  if (!term) return null;
  const trimmed = term.trim();
  if (/^[A-Z]{2}:\d{4,}$/.test(trimmed)) return trimmed;
  const split = splitLabelAndId(trimmed);
  if (split.id && /^[A-Z]{2}:\d{4,}$/.test(split.id)) return split.id;
  return null;
}

function getAnnotationAccessions(
  annotations: { term: string; value?: string | null; unit?: string | null }[]
): string[] {
  return annotations
    .map((annotation) => getTermAccession(annotation.term))
    .filter((value): value is string => Boolean(value));
}

function getInteractionTypeDirection(interaction: MeilisearchInteraction): EvidenceDirection {
  const typeA = extractLabel(interaction.member_types[0] || '').trim().toLowerCase();
  const typeB = extractLabel(interaction.member_types[1] || '').trim().toLowerCase();

  if (typeA === 'small molecule' && typeB === 'protein') return 'a-b';
  if (typeB === 'small molecule' && typeA === 'protein') return 'b-a';
  return null;
}

function collapseSigns(signs: Set<-1 | 1>, fallbackSign: EvidenceSign = null): EvidenceSign {
  const hasPos = signs.has(1);
  const hasNeg = signs.has(-1);
  if (hasPos && hasNeg) return 0;
  if (hasPos) return 1;
  if (hasNeg) return -1;
  return fallbackSign;
}

function inferEvidenceCombos(
  interaction: MeilisearchInteraction,
  evidence: InteractionEvidence,
): EvidenceCombo[] {
  const explicitDirection = getEvidenceDirection(evidence);
  const explicitSign = getEvidenceSign(evidence);
  if (explicitDirection !== null || explicitSign !== null) {
    return [{ direction: explicitDirection, sign: explicitSign }];
  }

  const byDirection = new Map<EvidenceDirection, Set<-1 | 1>>();
  const ensureDirection = (direction: EvidenceDirection) => {
    if (!direction) return;
    if (!byDirection.has(direction)) byDirection.set(direction, new Set<-1 | 1>());
  };
  const addSignedDirection = (direction: EvidenceDirection, sign: -1 | 1 | null) => {
    if (!direction) return;
    ensureDirection(direction);
    if (sign === 1 || sign === -1) byDirection.get(direction)?.add(sign);
  };

  const memberASigns = getAnnotationAccessions(evidence.member_a_annotations || []);
  const memberBSigns = getAnnotationAccessions(evidence.member_b_annotations || []);
  const interactionSigns = getAnnotationAccessions(evidence.interaction_annotations || []);

  memberASigns.forEach((accession) => {
    const sign = POSITIVE_SIGN_ACCESSIONS.has(accession) ? 1 : NEGATIVE_SIGN_ACCESSIONS.has(accession) ? -1 : null;
    if (SOURCE_ROLE_ACCESSIONS.has(accession)) addSignedDirection('a-b', sign);
    if (TARGET_ROLE_ACCESSIONS.has(accession)) addSignedDirection('b-a', sign);
  });

  memberBSigns.forEach((accession) => {
    const sign = POSITIVE_SIGN_ACCESSIONS.has(accession) ? 1 : NEGATIVE_SIGN_ACCESSIONS.has(accession) ? -1 : null;
    if (SOURCE_ROLE_ACCESSIONS.has(accession)) addSignedDirection('b-a', sign);
    if (TARGET_ROLE_ACCESSIONS.has(accession)) addSignedDirection('a-b', sign);
  });

  const paramDirection = getInteractionTypeDirection(interaction);
  interactionSigns.forEach((accession) => {
    if (ACTIVATORY_PARAMETER_ACCESSIONS.has(accession)) addSignedDirection(paramDirection, 1);
    if (INHIBITORY_PARAMETER_ACCESSIONS.has(accession)) addSignedDirection(paramDirection, -1);
  });

  const interactionFallbackSign = collapseSigns(new Set(interactionSigns.flatMap((accession) => {
    if (POSITIVE_SIGN_ACCESSIONS.has(accession)) return [1 as const];
    if (NEGATIVE_SIGN_ACCESSIONS.has(accession)) return [-1 as const];
    return [];
  })));

  const inferred = Array.from(byDirection.entries()).map(([direction, signs]) => ({
    direction,
    sign: collapseSigns(signs, interactionFallbackSign),
  }));

  return inferred;
}

function getFallbackCombos(directions: InteractionDirection[]): EvidenceCombo[] {
  const distinct = Array.from(new Set((directions || []).map((dir) => `${dir.direction}|${dir.sign}`)))
    .map((key) => {
      const [direction, sign] = key.split('|');
      return {
        direction: direction === 'a-b' || direction === 'b-a' ? direction : null,
        sign: sign === '1' ? 1 : sign === '-1' ? -1 : sign === '0' ? 0 : null,
      } as EvidenceCombo;
    });

  return distinct.length > 0 ? distinct : [{ direction: null, sign: null }];
}

function splitPubmedAnnotations(annotations: FormattedAnnotation[]): {
  pubmedIds: string[];
  annotations: FormattedAnnotation[];
} {
  const pubmedIds = new Set<string>();
  const filtered: FormattedAnnotation[] = [];

  annotations.forEach((annotation) => {
    const normalizedTerm = annotation.term.trim().toLowerCase();
    const isPubmed = normalizedTerm === 'pubmed' || normalizedTerm === 'pmid';

    if (isPubmed) {
      const matches = `${annotation.value || ''} ${annotation.termId || ''} ${annotation.unitId || ''}`.match(/\b\d{4,9}\b/g);
      matches?.forEach((id) => pubmedIds.add(id));
      return;
    }

    filtered.push(annotation);
  });

  return {
    pubmedIds: Array.from(pubmedIds).sort((a, b) => Number(a) - Number(b)),
    annotations: filtered,
  };
}

function getDirectionLabel(direction: EvidenceDirection, interaction: MeilisearchInteraction): string {
  if (direction === 'a-b') return `${interaction.member_a_id} → ${interaction.member_b_id}`;
  if (direction === 'b-a') return `${interaction.member_b_id} → ${interaction.member_a_id}`;
  if (direction === 'undirected') return `${interaction.member_a_id} — ${interaction.member_b_id}`;
  return 'All evidence';
}

function getSignBadgeClasses(sign: EvidenceSign): string {
  if (sign === 1) return 'text-green-600 bg-green-50 border-green-200';
  if (sign === -1) return 'text-red-600 bg-red-50 border-red-200';
  if (sign === 0) return 'text-gray-600 bg-gray-50 border-gray-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

function getSignText(sign: EvidenceSign): string {
  if (sign === 1) return 'Activation';
  if (sign === -1) return 'Inhibition';
  if (sign === 0) return 'Unsigned';
  return 'Unspecified sign';
}

function extractAnnotationTerms(evidence: InteractionEvidence[]): string[] {
  const terms = new Set<string>();
  evidence.forEach(e => {
    e.interaction_annotations?.forEach(a => terms.add(a.term));
    e.member_a_annotations?.forEach(a => terms.add(a.term));
    e.member_b_annotations?.forEach(a => terms.add(a.term));
  });
  return Array.from(terms);
}

function buildEvidenceGroups(
  interaction: MeilisearchInteraction,
  swap: boolean,
): AggregatedEvidenceGroup[] {
  if (!interaction.evidence?.length) return [];

  const groups = new Map<string, {
    direction: EvidenceDirection;
    sign: EvidenceSign;
    evidenceCount: number;
    sourceDatabases: Set<string>;
    pubmedIds: Set<string>;
    sourceAnnotations: FormattedAnnotation[];
    interactionAnnotations: FormattedAnnotation[];
    targetAnnotations: FormattedAnnotation[];
  }>();

  const fallbackCombos = getFallbackCombos(getInteractionDirections(interaction));

  interaction.evidence.forEach((evidence) => {
    const inferredCombos = inferEvidenceCombos(interaction, evidence);
    const combos = inferredCombos.length > 0 ? inferredCombos : fallbackCombos;

    const sourceSplit = splitPubmedAnnotations(formatAnnotations(swap ? evidence.member_b_annotations : evidence.member_a_annotations));
    const interactionSplit = splitPubmedAnnotations(formatAnnotations(evidence.interaction_annotations || []));
    const targetSplit = splitPubmedAnnotations(formatAnnotations(swap ? evidence.member_a_annotations : evidence.member_b_annotations));

    combos.forEach(({ direction, sign }) => {
      const key = `${direction ?? 'all'}|${sign ?? 'all'}`;

      if (!groups.has(key)) {
        groups.set(key, {
          direction,
          sign,
          evidenceCount: 0,
          sourceDatabases: new Set<string>(),
          pubmedIds: new Set<string>(),
          sourceAnnotations: [],
          interactionAnnotations: [],
          targetAnnotations: [],
        });
      }

      const group = groups.get(key)!;
      group.evidenceCount += 1;

      if (evidence.source) {
        group.sourceDatabases.add(extractLabel(evidence.source));
      }

      sourceSplit.pubmedIds.forEach((id) => group.pubmedIds.add(id));
      interactionSplit.pubmedIds.forEach((id) => group.pubmedIds.add(id));
      targetSplit.pubmedIds.forEach((id) => group.pubmedIds.add(id));

      group.sourceAnnotations.push(...sourceSplit.annotations);
      group.interactionAnnotations.push(...interactionSplit.annotations);
      group.targetAnnotations.push(...targetSplit.annotations);
    });
  });

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      direction: group.direction,
      sign: group.sign,
      label: `${getDirectionLabel(group.direction, interaction)} · ${getSignText(group.sign)}`,
      evidenceCount: group.evidenceCount,
      sourceDatabases: Array.from(group.sourceDatabases).sort((a, b) => a.localeCompare(b)),
      pubmedIds: Array.from(group.pubmedIds).sort((a, b) => Number(a) - Number(b)),
      sourceAnnotations: dedupeAnnotations(group.sourceAnnotations),
      interactionAnnotations: dedupeAnnotations(group.interactionAnnotations),
      targetAnnotations: dedupeAnnotations(group.targetAnnotations),
    }))
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.label.localeCompare(b.label));
}

export function InteractionDetails({ selectedInteraction }: InteractionDetailsProps) {
  const directions = useMemo(() => getInteractionDirections(selectedInteraction), [selectedInteraction]);

  const overallSign = useMemo(() => {
    if (!selectedInteraction) return null;
    return getOverallSign(directions);
  }, [directions, selectedInteraction]);

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
      directions: directions.length,
      annotationTerms: allTerms.length,
    };
  }, [selectedInteraction]);

  const swap = shouldSwapMembers(directions);

  const evidenceGroups = useMemo(() => {
    if (!selectedInteraction) return [] as AggregatedEvidenceGroup[];
    return buildEvidenceGroups(selectedInteraction, swap);
  }, [selectedInteraction, swap]);

  if (!selectedInteraction) {
    return (
      <div className="p-4">
        <div className="rounded-lg border bg-card p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <Search className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="mb-2 text-lg font-medium text-muted-foreground">No interaction selected</p>
            <p className="text-sm text-muted-foreground">Select an interaction to view detailed evidence</p>
          </div>
        </div>
      </div>
    )
  }

  const sourceId = swap ? selectedInteraction.member_b_id : selectedInteraction.member_a_id;
  const targetId = swap ? selectedInteraction.member_a_id : selectedInteraction.member_b_id;
  const sourceType = swap
    ? (selectedInteraction.member_types[1] ? extractLabel(selectedInteraction.member_types[1]) : 'Unknown')
    : (selectedInteraction.member_types[0] ? extractLabel(selectedInteraction.member_types[0]) : 'Unknown');
  const targetType = swap
    ? (selectedInteraction.member_types[0] ? extractLabel(selectedInteraction.member_types[0]) : 'Unknown')
    : (selectedInteraction.member_types[1] ? extractLabel(selectedInteraction.member_types[1]) : 'Unknown');

  return (
    <div className="space-y-6 p-4 pb-8">
      <div className="rounded-lg border bg-card p-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-6">
          <div className="min-w-0">
            <EntityBadge
              displayName={String(sourceId)}
              canonicalIdentifier={String(sourceId)}
              entityId={String(sourceId)}
              entityType={sourceType}
            />
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className={cn("flex items-center", getInteractionColor())}>
              {selectedInteraction.is_directed ? (
                <ArrowRight className="h-8 w-8" />
              ) : (
                <Minus className="h-8 w-8" />
              )}
            </div>
            {overallSign && (
              <Badge className={cn("border px-2 py-1 text-xs", getSignColor(overallSign))}>
                {overallSign === 'positive' && <Plus className="mr-1 h-3 w-3" />}
                {overallSign === 'negative' && <Minus className="mr-1 h-3 w-3" />}
                {getSignLabel(overallSign)}
              </Badge>
            )}
          </div>

          <div className="min-w-0">
            <EntityBadge
              displayName={String(targetId)}
              canonicalIdentifier={String(targetId)}
              entityId={String(targetId)}
              entityType={targetType}
            />
          </div>
        </div>

        {evidenceStats && (
          <div className="grid grid-cols-3 gap-4 border-t pt-4">
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
        {directions.length > 0 && (
          <AccordionItem value="directions" className="rounded-lg border">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-5 w-5" />
                <span className="font-medium">Directions & Signs</span>
                <Badge variant="secondary" className="ml-2">
                  {directions.length}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="space-y-2">
                {directions.map((dir, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
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
                      {dir.sign === 1 && <Plus className="mr-1 h-3 w-3" />}
                      {dir.sign === -1 && <Minus className="mr-1 h-3 w-3" />}
                      {dir.sign === 1 ? 'Activation' : dir.sign === -1 ? 'Inhibition' : 'Mixed'}
                    </Badge>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        <AccordionItem value="evidence" className="rounded-lg border">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5" />
              <span className="font-medium">Aggregated evidence</span>
              <Badge variant="secondary" className="ml-2">
                {selectedInteraction.evidence?.length || 0}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-4">
              {evidenceGroups.map((group) => (
                <div key={group.key} className="rounded-lg border bg-muted/20 p-4">
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {getDirectionLabel(group.direction, selectedInteraction)}
                        </Badge>
                        <Badge className={cn("border text-xs", getSignBadgeClasses(group.sign))}>
                          {group.sign === 1 && <Plus className="mr-1 h-3 w-3" />}
                          {group.sign === -1 && <Minus className="mr-1 h-3 w-3" />}
                          {getSignText(group.sign)}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {group.evidenceCount} evidence{group.evidenceCount !== 1 ? 's' : ''}
                        </Badge>
                      </div>

                      {group.sourceDatabases.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</span>
                          {group.sourceDatabases.map((source) => (
                            <Badge key={source} variant="secondary" className="text-xs">
                              {source}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-blue-700">
                        Source ({sourceId})
                      </div>
                      <AnnotationChips
                        annotations={group.sourceAnnotations}
                        emptyLabel="No source annotations"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Interaction</div>
                      <AnnotationChips
                        annotations={group.interactionAnnotations}
                        emptyLabel="No interaction-level annotations"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-purple-700">
                        Target ({targetId})
                      </div>
                      <AnnotationChips
                        annotations={group.targetAnnotations}
                        emptyLabel="No target annotations"
                      />
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
                      <div className="text-xs text-muted-foreground">No PubMed references available</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {selectedInteraction.interaction_annotation_terms && selectedInteraction.interaction_annotation_terms.length > 0 && (
          <AccordionItem value="annotation_terms" className="rounded-lg border">
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
