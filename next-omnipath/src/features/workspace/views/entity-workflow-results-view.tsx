"use client";

import Link from "next/link";
import { ArrowRight, Dna, Search, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEntitySelection } from "@/lib/navigation/url-state";
import { useSearchUrlState } from "@/lib/navigation/url-state";
import { AnnotationsExploreTab } from "@/features/explore/components/annotations-explore-tab";
import { EntitiesResultsView } from "./entities-results-view";

const MODE_COPY = {
  direct_lookup: {
    title: "Direct lookup",
    description: "Find entities directly by name, identifier, or batch lookup.",
    icon: Search,
  },
  annotations_to_entities: {
    title: "Annotations → Entities",
    description: "Start from ontology terms, then review matching entities.",
    icon: Tags,
  },
  entities_to_annotations: {
    title: "Entities → Annotations",
    description: "Start from selected entities, then summarize the annotations connected to them.",
    icon: Dna,
  },
} as const;

export function EntityWorkflowResultsView() {
  const { entityWorkflow, setEntityWorkflow, filters } = useSearchUrlState();
  const { selectedEntities } = useEntitySelection();
  const activeCopy = MODE_COPY[entityWorkflow];
  const ActiveIcon = activeCopy.icon;
  const ontologyTermCount = filters.ontology_terms?.length || 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b bg-background/60 backdrop-blur-md">
        <div className="w-full space-y-4 px-4 py-4">
          <div className="rounded-2xl bg-background/60 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Entities</Badge>
                  <Badge variant="secondary">Workflow mode</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="rounded-xl border p-2 text-primary">
                    <ActiveIcon className="size-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{activeCopy.title}</div>
                    <div className="text-sm text-muted-foreground">{activeCopy.description}</div>
                  </div>
                </div>
              </div>
              <Tabs value={entityWorkflow} onValueChange={(value) => setEntityWorkflow(value as typeof entityWorkflow)}>
                <TabsList className="h-auto w-full flex-wrap justify-start rounded-full bg-muted/60 p-1 md:w-auto">
                  <TabsTrigger value="entities_to_annotations" className="rounded-full">Entities → Annotations</TabsTrigger>
                  <TabsTrigger value="annotations_to_entities" className="rounded-full">Annotations → Entities</TabsTrigger>
                  <TabsTrigger value="direct_lookup" className="rounded-full">Direct lookup</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {entityWorkflow === "direct_lookup" ? <EntitiesResultsView /> : null}

        {entityWorkflow === "annotations_to_entities" ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Matching entities</CardTitle>
                <CardDescription>
                  {ontologyTermCount > 0
                    ? `Showing entities matched by ${ontologyTermCount} selected ontology term${ontologyTermCount === 1 ? "" : "s"}.`
                    : "Select one or more ontology terms in the refine pane to begin."}
                </CardDescription>
              </CardHeader>
            </Card>
            <div className="min-h-0">
              <EntitiesResultsView hideSearchArea />
            </div>
          </div>
        ) : null}

        {entityWorkflow === "entities_to_annotations" ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Annotations across selected entities</CardTitle>
                <CardDescription>
                  {selectedEntities.length > 0
                    ? `Summarizing annotations across ${selectedEntities.length} selected entit${selectedEntities.length === 1 ? "y" : "ies"}.`
                    : "Add entities from the refine pane to summarize their annotations."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/selection">
                    Open selection
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEntityWorkflow("direct_lookup")}>
                  Switch to direct lookup
                </Button>
              </CardContent>
            </Card>
            <AnnotationsExploreTab />
          </div>
        ) : null}
      </div>
    </div>
  );
}
