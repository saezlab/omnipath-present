"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatNumber } from "@/lib/utils";
import type { ResourceRecord } from "@/lib/resources";
import { resourceSupportsAnnotations, resourceSupportsInteractions } from "@/lib/resource-capabilities";
import { downloadResourceSelection, downloadSingleResource } from "@/lib/resource-downloads";
import { Check, CirclePlus, Copy, Database, Download, ExternalLink, Layers3, Network, Search, Tags } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

interface ResourcesSummary {
  totalResources: number;
  totalEntities: number;
  totalInteractions: number;
  totalAssociations: number;
  totalAnnotations: number;
  totalIdentifiers: number;
  totalOntologyTerms: number;
  totalBytes: number;
  buildStatusCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
}

function sentenceCase(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatFileSize(bytes: number | null | undefined): string {
  const value = bytes || 0;
  if (value < 1024) return `${value} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function iconForCategories(categories: string[]) {
  if (categories.includes("interaction")) return Network;
  if (categories.includes("annotation")) return Layers3;
  if (categories.includes("association")) return Tags;
  return Database;
}

function Pill({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MiniTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/30 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function ScrollableDescription({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg bg-muted/20 px-3 py-2.5">
      <div className="max-h-32 overflow-y-auto pr-1 text-sm leading-6 text-muted-foreground [scrollbar-width:thin]">
        {children}
      </div>
    </div>
  );
}

export default function ResourcesPage({
  resources,
  summary,
}: {
  resources: ResourceRecord[];
  summary: ResourcesSummary;
}) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [downloadingResourceId, setDownloadingResourceId] = useState<string | null>(null);
  const [downloadingSelection, setDownloadingSelection] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const categories = useMemo(
    () => ["all", ...Object.keys(summary.categoryCounts).sort((a, b) => a.localeCompare(b))],
    [summary.categoryCounts],
  );

  const filteredResources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return resources.filter((resource) => {
      const searchableText = resource.resource_name.toLowerCase();

      const matchesQuery = normalizedQuery.length === 0 || searchableText.includes(normalizedQuery);
      const matchesCategory = selectedCategory === "all" || resource.categories.includes(selectedCategory);

      return matchesQuery && matchesCategory;
    });
  }, [query, resources, selectedCategory]);

  const selectedResources = useMemo(
    () => resources.filter((resource) => selectedIds.includes(resource.resource_id)),
    [resources, selectedIds],
  );

  const selectedTotalBytes = useMemo(
    () => selectedResources.reduce((sum, item) => sum + (item.total_size_bytes || 0), 0),
    [selectedResources],
  );

  const openInteractionWorkspaceHref = useMemo(() => {
    const params = new URLSearchParams({ resources: selectedIds.join(",") });
    return `/duckdb/resources/workspace?${params.toString()}`;
  }, [selectedIds]);

  const openAnnotationWorkspaceHref = useMemo(() => {
    const params = new URLSearchParams({ resources: selectedIds.join(",") });
    return `/duckdb/annotations/workspace?${params.toString()}`;
  }, [selectedIds]);

  const canOpenInteractionWorkspace = useMemo(
    () => selectedResources.some((resource) => resourceSupportsInteractions(resource)),
    [selectedResources],
  );

  const canOpenAnnotationWorkspace = useMemo(
    () => selectedResources.some((resource) => resourceSupportsAnnotations(resource)),
    [selectedResources],
  );

  function toggleSelected(resourceId: string) {
    setSelectedIds((current) =>
      current.includes(resourceId) ? current.filter((id) => id !== resourceId) : [...current, resourceId],
    );
  }

  async function copySelectedIds() {
    if (selectedIds.length === 0) return;
    await navigator.clipboard.writeText(selectedIds.join(","));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function handleSingleResourceDownload(resourceId: string) {
    try {
      setDownloadError(null);
      setDownloadingResourceId(resourceId);
      await downloadSingleResource(resourceId);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setDownloadingResourceId(null);
    }
  }

  async function handleSelectionDownload() {
    if (selectedIds.length === 0) return;

    try {
      setDownloadError(null);
      setDownloadingSelection(true);
      await downloadResourceSelection(selectedIds);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setDownloadingSelection(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Resources</h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground">
              Browse the current OmniPath build resources from <code>resources.parquet</code>, with each resource categorized as
              annotation, interaction, and/or association based on the artifacts present in the current gold snapshot.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search resource name…"
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <Pill key={category} active={selectedCategory === category} onClick={() => setSelectedCategory(category)}>
                  {category === "all" ? "All categories" : sentenceCase(category)}
                </Pill>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 pb-28">
          <section className="space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredResources.length} of {resources.length} resources.
                </p>
              </div>
              <div className="text-sm text-muted-foreground">
                {formatNumber(summary.totalEntities)} entities • {formatNumber(summary.totalInteractions)} interactions • {formatNumber(summary.totalAnnotations)} annotations • {formatNumber(summary.totalOntologyTerms)} ontology terms
              </div>
            </div>

            <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
              {filteredResources.map((resource) => {
                const Icon = iconForCategories(resource.categories);
                const isSelected = selectedIds.includes(resource.resource_id);
                const stats = [
                  { label: "Entities", value: resource.entity_count },
                  { label: "Interactions", value: resource.interaction_count },
                  { label: "Associations", value: resource.association_count },
                  { label: "Annotations", value: resource.annotation_count },
                  { label: "Ontology Terms", value: resource.ontology_term_count },
                ].filter((stat) => stat.value > 0);

                return (
                  <article
                    key={resource.resource_id}
                    className="mb-4 break-inside-avoid rounded-xl border border-border/50 bg-card p-4 transition-colors hover:bg-muted/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-lg font-semibold tracking-tight">{resource.resource_name}</div>
                          <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                            {resource.resource_id}
                          </div>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
                          resource.build_status === "success"
                            ? "bg-secondary/15 text-secondary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {sentenceCase(resource.build_status)}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {resource.categories.map((category) => (
                        <MiniTag key={`${resource.resource_id}-${category}`}>{sentenceCase(category)}</MiniTag>
                      ))}
                    </div>

                    {resource.annotation_ontologies.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {resource.annotation_ontologies.map((ontology) => (
                          <MiniTag key={`${resource.resource_id}-${ontology}`}>{ontology}</MiniTag>
                        ))}
                      </div>
                    ) : null}

                    <ScrollableDescription>
                      {resource.description || "No description available."}
                    </ScrollableDescription>

                    {stats.length > 0 ? (
                      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/50 pt-4">
                        {stats.map((stat) => (
                          <div key={`${resource.resource_id}-${stat.label}`}>
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</div>
                            <div className="mt-1 text-sm font-medium">{formatNumber(stat.value)}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <dl className="mt-4 space-y-2 border-t border-border/50 pt-4 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">License</dt>
                        <dd className="max-w-[65%] truncate text-right text-foreground/90">{resource.license || "—"}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Last Built</dt>
                        <dd className="text-right text-foreground/90">{formatDate(resource.last_built_at)}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Snapshot Size</dt>
                        <dd className="text-right text-foreground/90">{formatFileSize(resource.total_size_bytes)}</dd>
                      </div>
                    </dl>

                    <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {resource.homepage_url ? (
                            <Link
                              href={resource.homepage_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                            >
                              Site
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                          {resource.pubmed_id ? (
                            <Link
                              href={`https://pubmed.ncbi.nlm.nih.gov/${resource.pubmed_id}/`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                            >
                              PMID
                              <Tags className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSingleResourceDownload(resource.resource_id)}
                          disabled={resource.build_status !== "success" || downloadingResourceId === resource.resource_id || downloadingSelection}
                        >
                          {downloadingResourceId === resource.resource_id ? "Preparing…" : "Download"}
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleSelected(resource.resource_id)}
                        className={cn(
                          "inline-flex w-full items-center justify-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {isSelected ? (
                          <>
                            Selected
                            <Check className="h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Select
                            <CirclePlus className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {filteredResources.length === 0 ? (
              <div className="rounded-xl border border-border/50 bg-card px-6 py-12 text-center text-muted-foreground">
                No resources matched the current search and filter settings.
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {selectedResources.length > 0 ? (
        <div className="fixed inset-x-4 bottom-4 z-40">
          <div className="mx-auto w-full max-w-screen-xl rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-base font-medium">{selectedResources.length} resources selected</div>
                <div className="text-sm text-muted-foreground">Estimated total size: {formatFileSize(selectedTotalBytes)}</div>
                {downloadError ? <div className="mt-1 text-sm text-destructive">{downloadError}</div> : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="ghost" onClick={() => setSelectedIds([])}>
                  Clear selection
                </Button>
                <Button variant="outline" onClick={copySelectedIds}>
                  {copied ? "Copied IDs" : "Copy selected IDs"}
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={handleSelectionDownload} disabled={downloadingSelection || downloadingResourceId !== null}>
                  {downloadingSelection ? "Preparing bundle…" : "Download selection"}
                  <Download className="h-4 w-4" />
                </Button>
                {canOpenAnnotationWorkspace ? (
                  <Button asChild variant="outline">
                    <Link href={openAnnotationWorkspaceHref}>
                      Open annotation workspace
                      <Layers3 className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" disabled>
                    Open annotation workspace
                    <Layers3 className="h-4 w-4" />
                  </Button>
                )}
                {canOpenInteractionWorkspace ? (
                  <Button asChild>
                    <Link href={openInteractionWorkspaceHref}>
                      Open interaction workspace
                      <Database className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button disabled>
                    Open interaction workspace
                    <Database className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
