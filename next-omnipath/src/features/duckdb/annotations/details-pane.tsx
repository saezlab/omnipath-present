"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { useOntologyTerms } from "@/features/ontology/use-ontology-terms";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { formatNumber } from "@/lib/utils";
import { useDuckDbAnnotationWorkspace } from "./context";

export function DuckDbAnnotationDetailsPane() {
  const {
    entitySummaries,
    focusedEntityKey,
    focusedEntityTerms,
    focusedTermId,
    focusedTermSupport,
    rows,
    selectedTerms,
    setFocusedEntityKey,
    setFocusedTermId,
  } = useDuckDbAnnotationWorkspace();

  const focusedEntityRow = rows.find((row) => row.key === focusedEntityKey) || null;
  const focusedEntitySummary = focusedEntityKey ? entitySummaries.get(focusedEntityKey) || null : null;
  const focusedTermInfo = useOntologyTerms(focusedTermId ? [focusedTermId] : []);
  const focusedEntityTermInfo = useOntologyTerms(focusedEntityTerms);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <Card className="flex-1 overflow-auto">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          {focusedTermId ? (
            <section className="space-y-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Focused term</div>
                <div className="mt-1 text-base font-semibold"><OntologyTermLabel termId={focusedTermId} /></div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{focusedTermId}</div>
              </div>
              {focusedTermInfo[focusedTermId]?.definition ? (
                <p className="leading-6 text-muted-foreground">{focusedTermInfo[focusedTermId]?.definition}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {focusedTermInfo[focusedTermId]?.namespace ? <Badge variant="outline">{focusedTermInfo[focusedTermId]?.namespace}</Badge> : null}
                <Badge variant="secondary">{formatNumber(focusedTermSupport.reduce((sum, item) => sum + item.entity_count, 0))} local entities</Badge>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Per-resource support</div>
                {focusedTermSupport.length > 0 ? focusedTermSupport.map((item) => (
                  <div key={`${focusedTermId}-${item.resource_id}`} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span>{item.resource_id}</span>
                    <span className="text-muted-foreground">{formatNumber(item.entity_count)} entities · {formatNumber(item.annotation_count)} rows</span>
                  </div>
                )) : <div className="text-muted-foreground">No local support found for this term.</div>}
              </div>
            </section>
          ) : null}

          {focusedEntityRow && focusedEntitySummary ? (
            <section className="space-y-3 border-t pt-6 first:border-t-0 first:pt-0">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Focused entity</div>
                <div className="mt-1 text-base font-semibold">{focusedEntitySummary.display_name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{focusedEntitySummary.canonical_identifier}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{focusedEntityRow.resource_id}</Badge>
                {focusedEntitySummary.entity_type_name ? <Badge variant="outline">{focusedEntitySummary.entity_type_name}</Badge> : null}
                {focusedEntityRow.taxonomy_id ? <Badge variant="outline">Taxonomy {focusedEntityRow.taxonomy_id}</Badge> : null}
                <Badge variant="secondary">{formatNumber(focusedEntityRow.matched_term_count)} matched terms</Badge>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">All local annotation terms</div>
                {focusedEntityTerms.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {focusedEntityTerms.map((termId) => (
                      <button
                        key={`${focusedEntityKey}-${termId}`}
                        type="button"
                        onClick={() => setFocusedTermId(termId)}
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 hover:bg-muted/40"
                      >
                        <CvTermHoverCard termId={termId}>
                          <span className="cursor-help underline decoration-dotted underline-offset-2">
                            {focusedEntityTermInfo[termId]?.name || termId}
                          </span>
                        </CvTermHoverCard>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">No local annotation terms available for this entity.</div>
                )}
              </div>
            </section>
          ) : null}

          {!focusedTermId && !focusedEntityRow ? (
            <section className="space-y-3 text-muted-foreground">
              <p>Select a term chip or entity row to inspect ontology metadata and local support.</p>
              {selectedTerms.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide">Selected terms</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTerms.map((termId) => (
                      <button
                        key={termId}
                        type="button"
                        onClick={() => setFocusedTermId(termId)}
                        className="inline-flex items-center rounded-full border px-3 py-1.5 hover:bg-muted/40"
                      >
                        <OntologyTermLabel termId={termId} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {rows.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide">Visible entities</div>
                  <div className="flex flex-wrap gap-2">
                    {rows.slice(0, 12).map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => setFocusedEntityKey(row.key)}
                        className="inline-flex items-center rounded-full border px-3 py-1.5 hover:bg-muted/40"
                      >
                        {entitySummaries.get(row.key)?.display_name || row.entity_id}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
