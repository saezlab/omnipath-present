<script lang="ts">
  import { Search, ArrowRight, Layers3, ExternalLink, Minus } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '$lib/components/ui/accordion/index.js';
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table/index.js';
  import EntityBadge from '$lib/components/entity/EntityBadge.svelte';
  import {
    getEntityDisplayName,
    getEntityPublicId,
    getEntitySecondaryName,
    getEntityTypeLabel,
  } from '$lib/entities/display';
  import type { InteractionDetailsData, InteractionListRow, ParsedAnnotation, EvidenceGroup } from '$lib/types/interactions';

  interface Props {
    selectedInteraction: InteractionDetailsData | InteractionListRow | null;
    evidenceLoading?: boolean;
  }

  let { selectedInteraction, evidenceLoading = false }: Props = $props();

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

  const detailedInteraction = $derived(
    selectedInteraction && "evidence" in selectedInteraction ? selectedInteraction : null
  );
  const evidence = $derived(detailedInteraction?.evidence ?? []);
  const evidenceGroups = $derived(buildEvidenceGroups(evidence));
  const annotationTermCount = $derived(getAnnotationTermCount(evidence));

  const subjectEntity = $derived(selectedInteraction!.subjectEntity);
  const objectEntity = $derived(selectedInteraction!.objectEntity);
  const subjectId = $derived(getEntityPublicId(subjectEntity));
  const objectId = $derived(getEntityPublicId(objectEntity));
</script>

{#if !selectedInteraction}
  <div class="p-4">
    <div class="rounded-lg border bg-card p-8">
      <div class="flex flex-col items-center justify-center text-center">
        <Search class="mb-4 h-12 w-12 text-muted-foreground" />
        <p class="mb-2 text-lg font-medium text-muted-foreground">No relation selected</p>
        <p class="text-sm text-muted-foreground">Select a relation to view detailed evidence</p>
      </div>
    </div>
  </div>
{:else}
  <div class="space-y-6 p-4 pb-8">
    <div class="rounded-lg border bg-card p-6">
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-6">
        <div class="min-w-0">
          <EntityBadge
            displayName={getEntityDisplayName(subjectEntity)}
            canonicalIdentifier={getEntitySecondaryName(subjectEntity) || subjectEntity.canonicalIdentifier}
            entityType={getEntityTypeLabel(subjectEntity)}
          />
        </div>

        <div class="flex flex-col items-center gap-2 text-muted-foreground">
          <ArrowRight class="h-8 w-8" />
          <Badge variant="outline">{selectedInteraction.relation.predicate || "—"}</Badge>
        </div>

        <div class="min-w-0">
          <EntityBadge
            displayName={getEntityDisplayName(objectEntity)}
            canonicalIdentifier={getEntitySecondaryName(objectEntity) || objectEntity.canonicalIdentifier}
            entityType={getEntityTypeLabel(objectEntity)}
          />
        </div>
      </div>

      <div class="space-y-4 border-t pt-4">
        {#if selectedInteraction.relation.participantTypes.length > 0}
          <div class="flex flex-wrap justify-center gap-2">
            {#each selectedInteraction.relation.participantTypes as participantType}
              <Badge variant="secondary">{participantType}</Badge>
            {/each}
          </div>
        {/if}

        <div class="grid grid-cols-2 gap-4">
          <div class="text-center">
            <div class="text-2xl font-bold text-primary">{selectedInteraction.relation.evidenceCount}</div>
            <div class="text-xs text-muted-foreground">Evidence{selectedInteraction.relation.evidenceCount !== 1 ? "s" : ""}</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-purple-600">{annotationTermCount}</div>
            <div class="text-xs text-muted-foreground">Annotation Term{annotationTermCount !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>
    </div>

    <Accordion type="multiple" value={["summary", "evidence"]} class="space-y-4">
      <AccordionItem value="summary" class="rounded-lg border">
        <AccordionTrigger class="px-4 py-3 hover:no-underline">
          <span class="font-medium">Evidence summary table</span>
        </AccordionTrigger>
        <AccordionContent class="px-4 pb-4">
          {#if evidenceLoading}
            <div class="text-sm text-muted-foreground">Loading evidence…</div>
          {:else if evidenceGroups.length === 0}
            <div class="text-sm text-muted-foreground">No evidence rows available.</div>
          {:else}
            <div class="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead class="text-center">Evidence</TableHead>
                    <TableHead class="text-center">Subject ann.</TableHead>
                    <TableHead class="text-center">Relation ann.</TableHead>
                    <TableHead class="text-center">Object ann.</TableHead>
                    <TableHead class="text-center">PubMed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {#each evidenceGroups as group}
                    <TableRow>
                      <TableCell class="font-medium">{group.source || "—"}</TableCell>
                      <TableCell class="text-center">{group.evidenceCount}</TableCell>
                      <TableCell class="text-center">{group.subjectAnnotations.length}</TableCell>
                      <TableCell class="text-center">{group.relationAnnotations.length}</TableCell>
                      <TableCell class="text-center">{group.objectAnnotations.length}</TableCell>
                      <TableCell class="text-center">{group.pubmedIds.length}</TableCell>
                    </TableRow>
                  {/each}
                </TableBody>
              </Table>
            </div>
          {/if}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="evidence" class="rounded-lg border">
        <AccordionTrigger class="px-4 py-3 hover:no-underline">
          <div class="flex items-center gap-2">
            <Layers3 class="h-5 w-5" />
            <span class="font-medium">Aggregated evidence</span>
            <Badge variant="secondary">{evidence.length}</Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent class="px-4 pb-4">
          {#if evidenceLoading}
            <div class="text-sm text-muted-foreground">Loading evidence…</div>
          {:else if evidenceGroups.length === 0}
            <div class="text-sm text-muted-foreground">No evidence rows available.</div>
          {:else}
            <div class="space-y-4">
              {#each evidenceGroups as group}
                <div class="rounded-lg border bg-muted/20 p-4">
                  <div class="mb-4 flex items-start justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" class="text-xs">
                        {group.evidenceCount} evidence{group.evidenceCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>

                    <Badge variant="secondary" class="text-xs">
                      {group.source || "Unknown source"}
                    </Badge>
                  </div>

                  <div class="grid gap-4 lg:grid-cols-3">
                    <div class="space-y-2">
                      <div class="text-xs font-medium uppercase tracking-wide text-blue-700">
                        Subject ({subjectId})
                      </div>
                      {#if group.subjectAnnotations.length === 0}
                        <div class="text-xs text-muted-foreground">No subject annotations</div>
                      {:else}
                        <div class="flex flex-wrap gap-2">
                          {#each group.subjectAnnotations as annotation}
                            <div class="rounded-md border bg-background px-2.5 py-1.5 text-xs">
                              <div class="font-medium leading-tight">{formatAnnotationText(annotation)}</div>
                              {#if annotation.termId || annotation.unitId}
                                <div class="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                                  {[annotation.termId, annotation.unitId].filter(Boolean).join(" · ")}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>

                    <div class="space-y-2">
                      <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Relation</div>
                      {#if group.relationAnnotations.length === 0}
                        <div class="text-xs text-muted-foreground">No relation-level annotations</div>
                      {:else}
                        <div class="flex flex-wrap gap-2">
                          {#each group.relationAnnotations as annotation}
                            <div class="rounded-md border bg-background px-2.5 py-1.5 text-xs">
                              <div class="font-medium leading-tight">{formatAnnotationText(annotation)}</div>
                              {#if annotation.termId || annotation.unitId}
                                <div class="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                                  {[annotation.termId, annotation.unitId].filter(Boolean).join(" · ")}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>

                    <div class="space-y-2">
                      <div class="text-xs font-medium uppercase tracking-wide text-purple-700">
                        Object ({objectId})
                      </div>
                      {#if group.objectAnnotations.length === 0}
                        <div class="text-xs text-muted-foreground">No object annotations</div>
                      {:else}
                        <div class="flex flex-wrap gap-2">
                          {#each group.objectAnnotations as annotation}
                            <div class="rounded-md border bg-background px-2.5 py-1.5 text-xs">
                              <div class="font-medium leading-tight">{formatAnnotationText(annotation)}</div>
                              {#if annotation.termId || annotation.unitId}
                                <div class="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                                  {[annotation.termId, annotation.unitId].filter(Boolean).join(" · ")}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>

                  <div class="mt-4 border-t pt-4">
                    <div class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">PubMed</div>
                    {#if group.pubmedIds.length > 0}
                      <div class="flex flex-wrap gap-2">
                        {#each group.pubmedIds as pubmedId}
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/`}
                            target="_blank"
                            rel="noreferrer"
                            class="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
                          >
                            PMID:{pubmedId}
                            <ExternalLink class="h-3 w-3" />
                          </a>
                        {/each}
                      </div>
                    {:else}
                      <div class="flex items-center gap-1 text-xs text-muted-foreground">
                        <Minus class="h-3 w-3" />
                        No PubMed references available
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>
{/if}
