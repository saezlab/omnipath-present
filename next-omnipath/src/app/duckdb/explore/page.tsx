"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Check, Database, Dna, Layers3, Network, Search, Tags, X } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type SeedMode = "entities" | "ontology" | "sources";
type OntologyScope = "participant" | "interaction" | "both";

type CategoryKey = "pathways" | "signaling" | "chemical-protein" | "ppi";

const ENTITY_SUGGESTIONS = ["TP53", "EGFR", "AKT1", "MTOR", "STAT3", "ERBB2"];
const ONTOLOGY_RESULTS = [
  { id: "GO:0006915", label: "apoptotic process" },
  { id: "GO:0007165", label: "signal transduction" },
  { id: "HP:0001250", label: "seizures" },
  { id: "WP254", label: "EGFR signaling pathway" },
  { id: "R-HSA-177929", label: "Signaling by EGFR" },
];
const SOURCE_OPTIONS = [
  "Reactome",
  "WikiPathways",
  "SIGNOR",
  "IntAct",
  "BindingDB",
  "BioGRID",
  "STRING",
];
const SOURCE_CATEGORIES: Array<{ key: CategoryKey; title: string; description: string; sources: string[] }> = [
  {
    key: "pathways",
    title: "Pathways",
    description: "Curated pathway resources",
    sources: ["Reactome", "WikiPathways"],
  },
  {
    key: "signaling",
    title: "Signaling",
    description: "Causal and signaling-focused resources",
    sources: ["SIGNOR"],
  },
  {
    key: "chemical-protein",
    title: "Chemical–protein interactions",
    description: "Compound, ligand, and target interaction resources",
    sources: ["BindingDB"],
  },
  {
    key: "ppi",
    title: "Protein–protein interactions (PPI)",
    description: "Physical interaction resources",
    sources: ["IntAct", "BioGRID", "STRING"],
  },
];

function SeedCard({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border bg-card p-4 text-left transition-colors",
        active ? "border-primary ring-2 ring-primary/15" : "hover:border-primary/40",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("rounded-xl border p-2", active ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground")}>
          <Icon className="size-4" />
        </div>
        <div className="space-y-1">
          <div className="font-medium">{title}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
      </div>
    </button>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1">
      <span>{label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="rounded-full hover:text-foreground" aria-label={`Remove ${label}`}>
          <X className="size-3" />
        </button>
      ) : null}
    </Badge>
  );
}

function ScopeSentence({
  seedMode,
  entityCount,
  ontologyCount,
  sourceCount,
}: {
  seedMode: SeedMode;
  entityCount: number;
  ontologyCount: number;
  sourceCount: number;
}) {
  const sentence =
    seedMode === "entities"
      ? `Build around ${entityCount || 0} selected ${entityCount === 1 ? "entity" : "entities"}.`
      : seedMode === "ontology"
        ? `Build around ${ontologyCount || 0} selected ontology ${ontologyCount === 1 ? "term" : "terms"}.`
        : `Build around ${sourceCount || 0} selected ${sourceCount === 1 ? "source" : "sources"}.`;

  return <p className="text-sm text-muted-foreground">{sentence}</p>;
}

export default function DuckDbExplorePage() {
  const [seedMode, setSeedMode] = useState<SeedMode>("entities");
  const [entityInput, setEntityInput] = useState("");
  const [selectedEntities, setSelectedEntities] = useState<string[]>(["TP53", "EGFR", "AKT1"]);
  const [ontologyInput, setOntologyInput] = useState("");
  const [selectedOntologyTerms, setSelectedOntologyTerms] = useState<Array<{ id: string; label: string }>>([
    { id: "GO:0007165", label: "signal transduction" },
  ]);
  const [ontologyScope, setOntologyScope] = useState<OntologyScope>("participant");
  const [ontologyMatchMode, setOntologyMatchMode] = useState<"any" | "all">("any");
  const [selectedSourceCategories, setSelectedSourceCategories] = useState<CategoryKey[]>(["pathways"]);
  const [selectedSources, setSelectedSources] = useState<string[]>(["Reactome", "WikiPathways"]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceRestrictionEnabled, setSourceRestrictionEnabled] = useState(true);
  const [ontologyRestrictionEnabled, setOntologyRestrictionEnabled] = useState(true);
  const [entityRestrictionEnabled, setEntityRestrictionEnabled] = useState(false);
  const [onlyHuman, setOnlyHuman] = useState(true);
  const [includeEntitySubset, setIncludeEntitySubset] = useState(true);

  const filteredOntologyResults = useMemo(() => {
    const query = ontologyInput.trim().toLowerCase();
    if (!query) return ONTOLOGY_RESULTS;
    return ONTOLOGY_RESULTS.filter((term) => `${term.id} ${term.label}`.toLowerCase().includes(query));
  }, [ontologyInput]);

  const filteredSourceOptions = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();
    if (!query) return SOURCE_OPTIONS;
    return SOURCE_OPTIONS.filter((source) => source.toLowerCase().includes(query));
  }, [sourceSearch]);

  const uniqueSources = useMemo(() => Array.from(new Set(selectedSources)).sort(), [selectedSources]);

  const sourceCategoryTitles = useMemo(
    () => SOURCE_CATEGORIES.filter((category) => selectedSourceCategories.includes(category.key)).map((category) => category.title),
    [selectedSourceCategories],
  );

  const hasSeedSelection =
    (seedMode === "entities" && selectedEntities.length > 0) ||
    (seedMode === "ontology" && selectedOntologyTerms.length > 0) ||
    (seedMode === "sources" && uniqueSources.length > 0);

  const preview = useMemo(() => {
    const entityFactor = Math.max(selectedEntities.length, seedMode === "entities" ? 2 : 0);
    const ontologyFactor = Math.max(selectedOntologyTerms.length, seedMode === "ontology" ? 2 : 0);
    const sourceFactor = Math.max(uniqueSources.length, seedMode === "sources" ? 2 : 0);
    const interactions = Math.max(250, entityFactor * 1800 + ontologyFactor * 2600 + sourceFactor * 1500);
    const entities = Math.max(120, Math.round(interactions * 0.18));
    const sizeMb = Math.max(3.2, interactions / 900);
    return {
      interactions,
      entities,
      sizeMb,
    };
  }, [seedMode, selectedEntities.length, selectedOntologyTerms.length, uniqueSources.length]);

  const workspaceHref = useMemo(() => {
    const params = new URLSearchParams({ view: "interactions", builder: seedMode });
    if (selectedEntities.length > 0) params.set("entity_ids", selectedEntities.join(","));
    if (selectedOntologyTerms.length > 0) params.set("ontology_terms", selectedOntologyTerms.map((term) => term.id).join(","));
    if (uniqueSources.length > 0) params.set("sources", uniqueSources.join(","));
    return `/duckdb/workspace?${params.toString()}`;
  }, [seedMode, selectedEntities, selectedOntologyTerms, uniqueSources]);

  function addEntity(value: string) {
    const normalized = value.trim();
    if (!normalized || selectedEntities.includes(normalized)) return;
    setSelectedEntities((current) => [...current, normalized]);
    setEntityInput("");
  }

  function addOntologyTerm(term: { id: string; label: string }) {
    if (selectedOntologyTerms.some((current) => current.id === term.id)) return;
    setSelectedOntologyTerms((current) => [...current, term]);
  }

  function toggleSourceCategory(categoryKey: CategoryKey) {
    const category = SOURCE_CATEGORIES.find((item) => item.key === categoryKey);
    if (!category) return;

    setSelectedSourceCategories((current) =>
      current.includes(categoryKey) ? current.filter((item) => item !== categoryKey) : [...current, categoryKey],
    );

    setSelectedSources((current) => {
      const hasCategory = selectedSourceCategories.includes(categoryKey);
      if (hasCategory) {
        const remainingCategorySources = SOURCE_CATEGORIES.filter((item) => item.key !== categoryKey)
          .filter((item) => selectedSourceCategories.includes(item.key))
          .flatMap((item) => item.sources);
        return current.filter((source) => category.sources.includes(source) ? remainingCategorySources.includes(source) : true);
      }

      return Array.from(new Set([...current, ...category.sources]));
    });
  }

  function toggleSource(source: string) {
    setSelectedSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
    );
  }

  function resetBuilder() {
    setSeedMode("entities");
    setSelectedEntities(["TP53", "EGFR", "AKT1"]);
    setSelectedOntologyTerms([{ id: "GO:0007165", label: "signal transduction" }]);
    setSelectedSourceCategories(["pathways"]);
    setSelectedSources(["Reactome", "WikiPathways"]);
    setOntologyScope("participant");
    setOntologyMatchMode("any");
    setOnlyHuman(true);
    setIncludeEntitySubset(true);
    setSourceRestrictionEnabled(true);
    setOntologyRestrictionEnabled(true);
    setEntityRestrictionEnabled(false);
    setEntityInput("");
    setOntologyInput("");
    setSourceSearch("");
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 md:py-10">
      <div className="space-y-6">
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">DuckDB</Badge>
              <Badge variant="secondary">Dataset builder</Badge>
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl tracking-tight">Build a dataset</CardTitle>
              <CardDescription className="max-w-3xl text-sm md:text-base">
                Choose entities, ontology terms, or sources to define the subset you want to load locally in DuckDB.
                Server scope controls what gets exported. Workspace filters refine the dataset after loading.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 1 · Choose a starting point</CardTitle>
                <CardDescription>
                  Start from one primary seed, then add optional restrictions before materializing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <SeedCard
                    active={seedMode === "entities"}
                    icon={Dna}
                    title="Entities"
                    description="All interactions involving selected entities"
                    onClick={() => setSeedMode("entities")}
                  />
                  <SeedCard
                    active={seedMode === "ontology"}
                    icon={Layers3}
                    title="Ontology terms"
                    description="Annotated entities or interactions"
                    onClick={() => setSeedMode("ontology")}
                  />
                  <SeedCard
                    active={seedMode === "sources"}
                    icon={Database}
                    title="Sources"
                    description="Selected resources or categories"
                    onClick={() => setSeedMode("sources")}
                  />
                </div>

                <div className="rounded-2xl border bg-card/50 p-4 md:p-5">
                  {seedMode === "entities" ? (
                    <div className="space-y-5">
                      <div>
                        <h2 className="text-base font-semibold">Entities</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Get all interactions involving one or more selected entities.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <Label htmlFor="entity-input">Search or paste entities</Label>
                        <div className="flex gap-2">
                          <Input
                            id="entity-input"
                            value={entityInput}
                            onChange={(event) => setEntityInput(event.target.value)}
                            placeholder="TP53, EGFR, UniProt accession…"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addEntity(entityInput);
                              }
                            }}
                          />
                          <Button type="button" variant="outline" onClick={() => addEntity(entityInput)}>
                            Add
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {ENTITY_SUGGESTIONS.map((entity) => (
                            <Button key={entity} type="button" size="sm" variant="secondary" onClick={() => addEntity(entity)}>
                              {entity}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label>Selected entities</Label>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedEntities([])}>
                            Clear all
                          </Button>
                        </div>
                        <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border border-dashed p-3">
                          {selectedEntities.length > 0 ? (
                            selectedEntities.map((entity) => (
                              <Chip key={entity} label={entity} onRemove={() => setSelectedEntities((current) => current.filter((item) => item !== entity))} />
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">No entities selected yet.</span>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3 rounded-xl bg-muted/40 p-4 md:grid-cols-2">
                        <label className="flex items-start gap-3 rounded-lg border bg-background p-3">
                          <Checkbox checked={onlyHuman} onCheckedChange={(checked) => setOnlyHuman(Boolean(checked))} />
                          <div>
                            <div className="font-medium">Only human</div>
                            <div className="text-sm text-muted-foreground">Apply a human-focused export scope.</div>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 rounded-lg border bg-background p-3">
                          <Checkbox checked={includeEntitySubset} onCheckedChange={(checked) => setIncludeEntitySubset(Boolean(checked))} />
                          <div>
                            <div className="font-medium">Include entity subset metadata</div>
                            <div className="text-sm text-muted-foreground">Support local badges, hover cards, and labels.</div>
                          </div>
                        </label>
                      </div>

                      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                        Includes interactions where any selected entity appears as a participant.
                      </div>
                    </div>
                  ) : null}

                  {seedMode === "ontology" ? (
                    <div className="space-y-5">
                      <div>
                        <h2 className="text-base font-semibold">Ontology terms</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Build a dataset from biological annotations on entities or interactions.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-3">
                          <Label>Annotation scope</Label>
                          <RadioGroup value={ontologyScope} onValueChange={(value) => setOntologyScope(value as OntologyScope)}>
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="participant" id="participant" />
                              <Label htmlFor="participant">Participant / entity annotations</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="interaction" id="interaction" />
                              <Label htmlFor="interaction">Interaction annotations</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="both" id="both" />
                              <Label htmlFor="both">Both</Label>
                            </div>
                          </RadioGroup>
                        </div>
                        <div className="space-y-3">
                          <Label htmlFor="ontology-match">Matching</Label>
                          <Select value={ontologyMatchMode} onValueChange={(value) => setOntologyMatchMode(value as "any" | "all") }>
                            <SelectTrigger id="ontology-match">
                              <SelectValue placeholder="Select matching mode" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Match any selected term</SelectItem>
                              <SelectItem value="all">Match all selected terms</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label htmlFor="ontology-input">Search ontology terms</Label>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="ontology-input"
                            value={ontologyInput}
                            onChange={(event) => setOntologyInput(event.target.value)}
                            className="pl-9"
                            placeholder="GO, HP, pathway accession, CV term…"
                          />
                        </div>
                        <div className="space-y-2 rounded-xl border p-3">
                          {filteredOntologyResults.map((term) => (
                            <div key={term.id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                              <div className="min-w-0">
                                <div className="font-medium">{term.label}</div>
                                <div className="text-xs text-muted-foreground">{term.id}</div>
                              </div>
                              <Button type="button" size="sm" variant="outline" onClick={() => addOntologyTerm(term)}>
                                Add
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Selected terms</Label>
                        <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border border-dashed p-3">
                          {selectedOntologyTerms.length > 0 ? (
                            selectedOntologyTerms.map((term) => (
                              <Chip
                                key={term.id}
                                label={`${term.id} ${term.label}`}
                                onRemove={() => setSelectedOntologyTerms((current) => current.filter((item) => item.id !== term.id))}
                              />
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">No ontology terms selected yet.</span>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                        Includes {ontologyScope === "interaction" ? "interactions" : ontologyScope === "participant" ? "entities/participants" : "entities and interactions"} annotated with {ontologyMatchMode === "any" ? "any" : "all"} selected terms.
                      </div>
                    </div>
                  ) : null}

                  {seedMode === "sources" ? (
                    <div className="space-y-5">
                      <div>
                        <h2 className="text-base font-semibold">Sources</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Build a dataset from specific resources or curated source categories.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <Label>Source categories</Label>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {SOURCE_CATEGORIES.map((category) => {
                            const selected = selectedSourceCategories.includes(category.key);
                            return (
                              <button
                                key={category.key}
                                type="button"
                                onClick={() => toggleSourceCategory(category.key)}
                                className={cn(
                                  "rounded-2xl border p-4 text-left transition-colors",
                                  selected ? "border-primary bg-primary/5 ring-2 ring-primary/15" : "hover:border-primary/40",
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="font-medium">{category.title}</div>
                                    <div className="mt-1 text-sm text-muted-foreground">{category.description}</div>
                                  </div>
                                  {selected ? <Check className="size-4 text-primary" /> : null}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {category.sources.map((source) => (
                                    <Badge key={source} variant="outline">{source}</Badge>
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label htmlFor="source-search">Individual sources</Label>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="source-search"
                            value={sourceSearch}
                            onChange={(event) => setSourceSearch(event.target.value)}
                            className="pl-9"
                            placeholder="Search sources…"
                          />
                        </div>
                        <div className="grid gap-2 rounded-xl border p-3 md:grid-cols-2">
                          {filteredSourceOptions.map((source) => {
                            const checked = uniqueSources.includes(source);
                            return (
                              <label key={source} className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                                <Checkbox checked={checked} onCheckedChange={() => toggleSource(source)} />
                                <span className="text-sm">{source}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Selected source scope</Label>
                        <div className="rounded-xl border border-dashed p-3">
                          <div className="space-y-3">
                            <div>
                              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Categories</div>
                              <div className="flex flex-wrap gap-2">
                                {sourceCategoryTitles.length > 0 ? sourceCategoryTitles.map((title) => <Chip key={title} label={title} />) : <span className="text-sm text-muted-foreground">No source categories selected.</span>}
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</div>
                              <div className="flex flex-wrap gap-2">
                                {uniqueSources.length > 0 ? uniqueSources.map((source) => <Chip key={source} label={source} onRemove={() => toggleSource(source)} />) : <span className="text-sm text-muted-foreground">No sources selected.</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                        Includes all interactions and entities contributed by the selected sources.
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 2 · Optional restrictions</CardTitle>
                <CardDescription>
                  Narrow the seed dataset before export without turning this page into the full workspace filter sidebar.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" defaultValue={["sources", "ontology"]} className="space-y-3">
                  <AccordionItem value="sources" className="rounded-xl border px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 text-left">
                        <Tags className="size-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">Restrict by sources</div>
                          <div className="text-sm font-normal text-muted-foreground">Narrow the dataset to selected source resources.</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <label className="flex items-center gap-3 rounded-lg border p-3">
                        <Checkbox checked={sourceRestrictionEnabled} onCheckedChange={(checked) => setSourceRestrictionEnabled(Boolean(checked))} />
                        <div>
                          <div className="font-medium">Enable source restriction</div>
                          <div className="text-sm text-muted-foreground">Use current source selections as export constraints.</div>
                        </div>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {uniqueSources.length > 0 ? uniqueSources.map((source) => <Chip key={source} label={source} onRemove={() => toggleSource(source)} />) : <span className="text-sm text-muted-foreground">No source restrictions configured.</span>}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="ontology" className="rounded-xl border px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 text-left">
                        <Layers3 className="size-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">Restrict by ontology terms</div>
                          <div className="text-sm font-normal text-muted-foreground">Use annotations to narrow the exported subset.</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <label className="flex items-center gap-3 rounded-lg border p-3">
                        <Checkbox checked={ontologyRestrictionEnabled} onCheckedChange={(checked) => setOntologyRestrictionEnabled(Boolean(checked))} />
                        <div>
                          <div className="font-medium">Enable ontology restriction</div>
                          <div className="text-sm text-muted-foreground">Apply the selected ontology terms as export constraints.</div>
                        </div>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {selectedOntologyTerms.length > 0 ? selectedOntologyTerms.map((term) => <Chip key={term.id} label={term.id} />) : <span className="text-sm text-muted-foreground">No ontology restrictions configured.</span>}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="entities" className="rounded-xl border px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 text-left">
                        <Network className="size-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">Restrict by entities</div>
                          <div className="text-sm font-normal text-muted-foreground">Useful when the seed is ontology- or source-based.</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <label className="flex items-center gap-3 rounded-lg border p-3">
                        <Checkbox checked={entityRestrictionEnabled} onCheckedChange={(checked) => setEntityRestrictionEnabled(Boolean(checked))} />
                        <div>
                          <div className="font-medium">Enable entity restriction</div>
                          <div className="text-sm text-muted-foreground">Only keep interactions touching the selected entities.</div>
                        </div>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {selectedEntities.length > 0 ? selectedEntities.map((entity) => <Chip key={entity} label={entity} />) : <span className="text-sm text-muted-foreground">No entity restrictions configured.</span>}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Dataset summary</CardTitle>
                <CardDescription>
                  Preview the scope that will be materialized into a local DuckDB session.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Seed</div>
                  <div className="font-medium capitalize">{seedMode}</div>
                  <ScopeSentence
                    seedMode={seedMode}
                    entityCount={selectedEntities.length}
                    ontologyCount={selectedOntologyTerms.length}
                    sourceCount={uniqueSources.length}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current scope</div>
                  <div className="space-y-2">
                    <div>
                      <div className="mb-2 text-sm font-medium">Entities</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedEntities.length > 0 ? selectedEntities.map((entity) => <Chip key={entity} label={entity} />) : <span className="text-sm text-muted-foreground">None selected</span>}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-medium">Ontology terms</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedOntologyTerms.length > 0 ? selectedOntologyTerms.map((term) => <Chip key={term.id} label={term.id} />) : <span className="text-sm text-muted-foreground">None selected</span>}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-medium">Sources</div>
                      <div className="flex flex-wrap gap-2">
                        {uniqueSources.length > 0 ? uniqueSources.map((source) => <Chip key={source} label={source} />) : <span className="text-sm text-muted-foreground">None selected</span>}
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expected artifacts</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span>Interactions parquet</span>
                      <Badge variant="outline">Included</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span>Entities parquet</span>
                      <Badge variant="outline">{includeEntitySubset ? "Included" : "Optional"}</Badge>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground">Interactions</div>
                      <div className="mt-1 text-xl font-semibold">~{preview.interactions.toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground">Entities</div>
                      <div className="mt-1 text-xl font-semibold">~{preview.entities.toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground">Estimated download</div>
                      <div className="mt-1 text-xl font-semibold">{preview.sizeMb.toFixed(1)} MB</div>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-muted/20 p-3 text-sm text-muted-foreground">
                    Preview values are illustrative for now. The next step is wiring live estimate queries to the export API.
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Materialization</div>
                  <div className="rounded-xl border bg-muted/20 p-3 text-sm text-muted-foreground">
                    For now this opens the existing DuckDB workspace prototype with the current builder state encoded in the URL.
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button asChild disabled={!hasSeedSelection} className="w-full">
                      <Link href={workspaceHref}>
                        Materialize and open
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                    <Button type="button" variant="outline" onClick={resetBuilder}>
                      Reset builder
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
