"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEntitySelection } from "@/contexts/entity-selection-context";
import { AnnotationBrowserTab } from "@/features/explore/components/annotation-browser-tab";
import { EntitiesExploreTab } from "@/features/explore/components/entities-explore-tab";
import { ExploreBrowserShell } from "@/features/explore/components/explore-browser-shell";
import { InteractionsExploreTab } from "@/features/explore/components/interactions-explore-tab";
import type { SearchFilters } from "@/types/search";

const exploreTabParser = parseAsStringLiteral(["entity", "relations", "ontology"] as const).withDefault("entity");
const speciesParser = parseAsString.withDefault("9606");
const queryParser = parseAsString.withDefault("");

const SPECIES_OPTIONS = [
  { value: "9606", label: "Human" },
  { value: "10090", label: "Mouse" },
  { value: "10116", label: "Rat" },
  { value: "7227", label: "Fruit fly" },
  { value: "6239", label: "C. elegans" },
  { value: "7955", label: "Zebrafish" },
] as const;

function buildSelectionHref(entityIds: string[], annotationIds: string[]) {
  const params = new URLSearchParams();
  if (entityIds.length > 0) params.set("entities", entityIds.join(","));
  if (annotationIds.length > 0) params.set("annotations", annotationIds.join(","));
  return `/selection${params.toString() ? `?${params.toString()}` : ""}`;
}

export default function ExplorePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useQueryState("tab", exploreTabParser);
  const [query, setQuery] = useQueryState("q", queryParser);
  const [species, setSpecies] = useQueryState("species", speciesParser);
  const [draftQuery, setDraftQuery] = useState(query);
  const [entityFilters, setEntityFilters] = useState<SearchFilters>({ ncbi_tax_id: [species || "9606"] });
  const [interactionFilters, setInteractionFilters] = useState<SearchFilters>({ relation_categories: ["interaction"] });
  const { entityIds, annotationIds, totalSelectionCount } = useEntitySelection();

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    setEntityFilters((prev) => ({
      ...prev,
      ncbi_tax_id: species ? [species] : ["9606"],
    }));
  }, [species]);

  const submitSearch = useCallback(() => {
    void setQuery(draftQuery.trim() || null);
  }, [draftQuery, setQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTypingTarget = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable;

      if (event.key === "/" && !isTypingTarget) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      if ((event.key === "s" || event.key === "S") && !isTypingTarget && totalSelectionCount > 0) {
        event.preventDefault();
        router.push(buildSelectionHref(entityIds, annotationIds));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotationIds, entityIds, router, totalSelectionCount]);

  const selectionHref = useMemo(() => buildSelectionHref(entityIds, annotationIds), [annotationIds, entityIds]);

  const content = tab === "entity"
    ? (
      <EntitiesExploreTab
        query={query}
        species={species || "9606"}
        filters={entityFilters}
        onFiltersChange={setEntityFilters}
      />
    ) : tab === "relations"
      ? (
        <InteractionsExploreTab
          filters={interactionFilters}
          onFilterChange={setInteractionFilters}
          useInternalRefineLayout={false}
        />
      ) : (
        <AnnotationBrowserTab query={query} species={species || "9606"} />
      );

  return (
    <ExploreBrowserShell
      query={query}
      draftQuery={draftQuery}
      onDraftQueryChange={setDraftQuery}
      onSubmitSearch={submitSearch}
      tab={tab}
      onTabChange={(next) => void setTab(next)}
      tabs={[
        { value: "entity", label: "entity" },
        { value: "relations", label: "relations" },
        { value: "ontology", label: "ontology" },
      ]}
      content={content}
      searchPlaceholder={tab === "ontology" ? "Search ontology terms…" : tab === "relations" ? "Search relations…" : "Search entities…"}
      searchInputRef={inputRef}
      species={species}
      onSpeciesChange={(value) => void setSpecies(value)}
      showSpeciesPicker={tab === "entity"}
      speciesOptions={SPECIES_OPTIONS}
      footerCta={totalSelectionCount > 0 ? (
        <Button asChild size="lg" className="fixed bottom-6 right-6 z-40 h-12 rounded-full px-4 shadow-lg">
          <Link href={selectionHref} className="flex items-center gap-2">
            <span>Open Selection</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs">
              {totalSelectionCount}
            </Badge>
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : null}
    />
  );
}
