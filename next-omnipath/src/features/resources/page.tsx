"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ResourceRecord, ResourcesSummary } from "@/lib/resource";
import { cn, formatNumber } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  ExternalLink,
  Layers3,
  Network,
  Search,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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
  if (categories.includes("membership") || categories.includes("association")) return Tags;
  return Database;
}

function Pill({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MiniTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function ResourceCard({
  resource,
  selected,
  onToggle,
}: {
  resource: ResourceRecord;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = iconForCategories(resource.categories);
  const stats = [
    { label: "Entities", value: resource.entity_count },
    { label: "Interactions", value: resource.interaction_count },
    { label: "Memberships", value: resource.membership_count },
    { label: "Annotations", value: resource.annotation_count },
    { label: "Ontology Terms", value: resource.ontology_term_count },
  ].filter((stat) => stat.value > 0);

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-[1.25rem] border bg-card/70 p-4 transition-all",
        selected ? "border-primary/60 bg-primary/[0.04] ring-1 ring-primary/20" : "border-border/50 hover:bg-muted/[0.18]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-border/60 bg-muted/25 p-2.5">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold tracking-tight">{resource.resource_name}</div>
          </div>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
            resource.build_status === "success"
              ? "bg-secondary/15 text-secondary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {sentenceCase(resource.build_status)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {resource.categories.map((category) => (
          <MiniTag key={`${resource.resource_id}-${category}`}>{sentenceCase(category)}</MiniTag>
        ))}
        {!expanded && resource.annotation_ontologies.slice(0, 1).map((ontology) => (
          <MiniTag key={`${resource.resource_id}-${ontology}`}>{ontology}</MiniTag>
        ))}
      </div>

      <div className="mt-3 rounded-xl bg-muted/18 px-3.5 py-3">
        <p
          className={cn(
            "text-sm leading-6 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] overflow-hidden",
            expanded ? "[-webkit-line-clamp:8]" : "[-webkit-line-clamp:2]",
          )}
        >
          {resource.description || "No description available."}
        </p>
      </div>

      <div className="mt-auto flex flex-col pt-3">
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            {expanded ? (
              <>
                Hide details
                <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                More details
                <ChevronDown className="h-4 w-4" />
              </>
            )}
          </button>

          <Button className="rounded-full" variant={selected ? "default" : "outline"} onClick={onToggle}>
            {selected ? "Selected" : "Select"}
            {selected ? <Check className="h-4 w-4" /> : null}
          </Button>
        </div>

        {expanded ? (
          <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
            {resource.annotation_ontologies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {resource.annotation_ontologies.map((ontology) => (
                  <MiniTag key={`${resource.resource_id}-${ontology}`}>{ontology}</MiniTag>
                ))}
              </div>
            ) : null}

            {stats.length > 0 ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {stats.map((stat) => (
                  <div key={`${resource.resource_id}-${stat.label}`} className="rounded-lg bg-muted/15 px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</div>
                    <div className="mt-1 text-sm font-semibold">{formatNumber(stat.value)}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <dl className="grid gap-2 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Resource ID</dt>
                <dd className="max-w-[65%] text-right font-mono text-foreground/90 break-words">{resource.resource_id}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">License</dt>
                <dd className="max-w-[65%] text-right text-foreground/90 break-words">{resource.license || "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Last Downloaded</dt>
                <dd className="text-right text-foreground/90">{formatDate(resource.last_downloaded_at)}</dd>
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

            <div className="flex flex-wrap items-center gap-1">
              {resource.homepage_url ? (
                <Link
                  href={resource.homepage_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
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
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  PMID
                  <Tags className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
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

  const categories = useMemo(
    () => ["all", ...Object.keys(summary.categoryCounts).sort((a, b) => a.localeCompare(b))],
    [summary.categoryCounts],
  );

  const filteredResources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return resources.filter((resource) => {
      const searchableText = [
        resource.resource_name,
        resource.resource_id,
        resource.description,
        ...(resource.categories || []),
        ...(resource.annotation_ontologies || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

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

  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col px-4 py-4 md:px-6 md:py-5">
      <div className="min-h-0 flex-1 overflow-y-auto pb-32 pr-1">
        <div className="space-y-4">
          <div className="rounded-[1.4rem] border bg-card p-3 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-semibold tracking-tight">Resource catalog</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Browse curated OmniPath resources directly from the local catalog table.
                  </p>
                </div>

                <div className="relative w-full xl:max-w-xl">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search resources, IDs, categories, or ontologies…"
                    className="h-11 rounded-[1rem] border-0 bg-muted/40 pl-10 text-sm shadow-none sm:text-base"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <Pill key={category} active={selectedCategory === category} onClick={() => setSelectedCategory(category)}>
                    {category === "all" ? "All categories" : sentenceCase(category)}
                  </Pill>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm text-muted-foreground">
                <span>{formatNumber(summary.totalResources)} resources</span>
                <span>•</span>
                <span>{formatNumber(summary.totalEntities)} entities</span>
                <span>•</span>
                <span>{formatNumber(summary.totalInteractions)} interactions</span>
                <span>•</span>
                <span>{formatNumber(summary.totalMemberships)} memberships</span>
                <span>•</span>
                <span>{formatNumber(summary.totalAnnotations)} annotations</span>
              </div>
            </div>
          </div>

          <section className="space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredResources.length} of {resources.length} resources.
                </p>
              </div>
              <div className="text-sm text-muted-foreground">
                {formatNumber(summary.totalOntologyTerms)} ontology terms • {formatFileSize(summary.totalBytes)} total size
              </div>
            </div>

            {filteredResources.length > 0 ? (
              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {filteredResources.map((resource) => (
                  <ResourceCard
                    key={resource.resource_id}
                    resource={resource}
                    selected={selectedIds.includes(resource.resource_id)}
                    onToggle={() => toggleSelected(resource.resource_id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[1.25rem] border border-border/60 bg-card px-6 py-14 text-center text-muted-foreground shadow-sm">
                No resources matched the current search and filter settings.
              </div>
            )}
          </section>
        </div>
      </div>

      {selectedResources.length > 0 ? (
        <div className="fixed inset-x-4 bottom-4 z-40">
          <div className="mx-auto w-full max-w-7xl rounded-[1.25rem] border border-border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-base font-medium">{selectedResources.length} resources selected</div>
                <div className="text-sm text-muted-foreground">Estimated total size: {formatFileSize(selectedTotalBytes)}</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button variant="ghost" onClick={() => setSelectedIds([])}>
                  Clear selection
                </Button>
                <Button variant="outline" onClick={copySelectedIds}>
                  {copied ? "Copied IDs" : "Copy selected IDs"}
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
