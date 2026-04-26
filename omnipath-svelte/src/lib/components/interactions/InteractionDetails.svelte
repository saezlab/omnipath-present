<script lang="ts">
  import { Search, ExternalLink, Minus } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import EntityBadge from '$lib/components/entity/EntityBadge.svelte';
  import {
    getEntityDisplayName,
    getEntityPublicId,
    getEntitySecondaryName,
    getEntityTypeLabel,
  } from '$lib/entities/display';
  import type { InteractionDetailsData, InteractionListRow, ParsedAnnotation, EvidenceGroup } from '$lib/types/interactions';
  import { getEntityTypeEmoji } from '$lib/utils/entity-types';
  import { cn } from '$lib/utils';

  interface Props {
    selectedInteraction: InteractionDetailsData | InteractionListRow | null;
    evidenceLoading?: boolean;
  }

  let { selectedInteraction, evidenceLoading = false }: Props = $props();

  function parseAnnotationTerm(value: string): { term: string; termId?: string } {
    const text = value.trim();
    const parts = text.split(":");

    // Format: PREFIX:NUMBER:Label (e.g., OM:1228:Source, MI:0840:positive)
    if (parts.length >= 3) {
      return {
        termId: `${parts[0]}:${parts[1]}`,
        term: parts.slice(2).join(":").trim(),
      };
    }

    // Fallback: simple label:id split (e.g., pubmed:12345)
    const colonIndex = text.indexOf(":");
    if (colonIndex <= 0) return { term: text };
    return {
      term: text.substring(0, colonIndex),
      termId: text.substring(colonIndex + 1),
    };
  }

  function normalizeAnnotationArray(value: unknown): ParsedAnnotation[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.term !== "string" || !record.term.trim()) return [];

      const term = parseAnnotationTerm(record.term);
      const unit = typeof record.unit === "string" ? parseAnnotationTerm(record.unit) : undefined;

      return [{
        term: term.term,
        termId: term.termId,
        value: typeof record.value === "string" ? record.value : undefined,
        unit: unit?.term,
        unitId: unit?.termId,
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

  function formatParticipantType(value: string) {
    const parts = value.split(":");
    const label = parts.length >= 3 ? parts.slice(2).join(":") : value;
    return {
      label,
      icon: getEntityTypeEmoji(label),
    };
  }

  function buildEvidenceRows(evidence: InteractionDetailsData["evidence"]) {
    return evidence.map((row, index) => {
      const subjectSplit = splitPubmedAnnotations(normalizeAnnotationArray(row.subjectAttributes));
      const relationSplit = splitPubmedAnnotations([
        ...normalizeAnnotationArray(row.recordAttributes),
        ...normalizeAnnotationArray(row.evidence),
      ]);
      const objectSplit = splitPubmedAnnotations(normalizeAnnotationArray(row.objectAttributes));

      return {
        key: `${row.source || 'unknown'}-${index}`,
        source: row.source,
        pubmedIds: Array.from(new Set([
          ...subjectSplit.pubmedIds,
          ...relationSplit.pubmedIds,
          ...objectSplit.pubmedIds,
        ])).sort((a, b) => Number(a) - Number(b)),
        subjectAnnotations: dedupeAnnotations(subjectSplit.annotations),
        relationAnnotations: dedupeAnnotations(relationSplit.annotations),
        objectAnnotations: dedupeAnnotations(objectSplit.annotations),
      };
    });
  }

  const detailedInteraction = $derived(
    selectedInteraction && "evidence" in selectedInteraction ? selectedInteraction : null
  );
  const evidence = $derived(detailedInteraction?.evidence ?? []);
  const evidenceRows = $derived(buildEvidenceRows(evidence));
  const subjectEntity = $derived(selectedInteraction!.subjectEntity);
  const objectEntity = $derived(selectedInteraction!.objectEntity);
</script>

{#snippet annotationPills(title: string, annotations: ParsedAnnotation[], emptyText: string)}
  <div class="space-y-2">
    {#if title}
      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
    {/if}
    {#if annotations.length === 0}
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Minus class="size-3" />
        {emptyText}
      </div>
    {:else}
      <div class="flex flex-wrap gap-1.5">
        {#each annotations as annotation}
          <span class="inline-flex max-w-full flex-col rounded-lg border bg-background px-2.5 py-1.5 text-xs">
            <span class="truncate font-medium leading-tight">{formatAnnotationText(annotation)}</span>
            {#if annotation.termId || annotation.unitId}
              <span class="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
                {[annotation.termId, annotation.unitId].filter(Boolean).join(' · ')}
              </span>
            {/if}
          </span>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#if !selectedInteraction}
  <div class="p-6">
    <div class="rounded-xl border bg-card p-8 text-center">
      <Search class="mx-auto mb-4 size-10 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">Select a relation to view details.</p>
    </div>
  </div>
{:else}
  <div class="space-y-4 p-6">
    <section class="rounded-2xl border bg-card/70 p-4">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <div class="min-w-0">
          <EntityBadge
            displayName={getEntityDisplayName(subjectEntity)}
            canonicalIdentifier={getEntitySecondaryName(subjectEntity) || subjectEntity.canonicalIdentifier}
            entityType={getEntityTypeLabel(subjectEntity)}
          />
        </div>

        <div class="flex items-center justify-center">
          <div class="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm">
            <span class="font-medium">{selectedInteraction.relation.predicate || '—'}</span>
          </div>
        </div>

        <div class="min-w-0">
          <EntityBadge
            displayName={getEntityDisplayName(objectEntity)}
            canonicalIdentifier={getEntitySecondaryName(objectEntity) || objectEntity.canonicalIdentifier}
            entityType={getEntityTypeLabel(objectEntity)}
          />
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2 border-t pt-4">
        <Badge variant="outline">{selectedInteraction.relation.relationCategory}</Badge>
        <Badge variant="secondary">{selectedInteraction.relation.evidenceCount.toLocaleString()} evidence</Badge>
        {#each selectedInteraction.relation.sources as source}
          <Badge variant="secondary">📚 {source}</Badge>
        {/each}
        {#each selectedInteraction.relation.participantTypes as participantType}
          {@const formatted = formatParticipantType(participantType)}
          <Badge variant="outline">{formatted.icon ? `${formatted.icon} ` : ''}{formatted.label}</Badge>
        {/each}
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold">Evidence</h3>
        <Badge variant="secondary">{evidence.length.toLocaleString()} rows</Badge>
      </div>

      {#if evidenceLoading}
        <div class="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Loading evidence…</div>
      {:else if evidenceRows.length === 0}
        <div class="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No evidence rows available.</div>
      {:else}
        <div class="overflow-hidden rounded-2xl border bg-card/70">
          <div class="grid grid-cols-3 border-b bg-muted/25 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <div>Subject</div>
            <div>Relation</div>
            <div>Object</div>
          </div>

          {#each evidenceRows as row, index (row.key)}
            <article class={cn('px-4 py-4', index > 0 ? 'border-t' : '')}>
              <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">📚 {row.source || 'Unknown source'}</Badge>
                  <Badge variant="outline">Evidence {index + 1}</Badge>
                </div>
                {#if row.pubmedIds.length > 0}
                  <div class="flex flex-wrap justify-end gap-1.5">
                    {#each row.pubmedIds as pubmedId}
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/`}
                        target="_blank"
                        rel="noreferrer"
                        class="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
                      >
                        PMID:{pubmedId}
                        <ExternalLink class="size-3" />
                      </a>
                    {/each}
                  </div>
                {/if}
              </div>

              <div class="grid gap-4 lg:grid-cols-3">
                {@render annotationPills('', row.subjectAnnotations, 'No subject annotations')}
                {@render annotationPills('', row.relationAnnotations, 'No relation annotations')}
                {@render annotationPills('', row.objectAnnotations, 'No object annotations')}
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </div>
{/if}
