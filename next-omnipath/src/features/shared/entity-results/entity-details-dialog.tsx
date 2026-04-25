"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Database, Loader2, Network, Shapes, Tag } from "lucide-react";
import { MoleculeStructure } from "./molecule_structure";
import { EntityIdentifiersSection } from "./entity-identifiers-section";
import { RelationsExploreTab } from "@/features/explore/components/relations-explore-tab";
import type { SearchFilters } from "@/types/search";
import EntitySearchWorkspace from "@/features/explore/components/entity-search-workspace";
import { getEntityDetails } from "@/lib/queries/entity-details";
import { getAssociatedEntityIds } from "@/lib/queries/relation";
import { getEntityTypeEmoji } from "@/lib/utils/entity-types";
import {
  getEntityDescriptions,
  getEntityDisplayName,
  getEntityIdentifiers,
  getEntityPublicId,
  getEntitySecondaryName,
  getEntitySmiles,
  getEntityTypeLabel,
  type EntityLike,
} from "@/lib/entities/display";

interface EntityDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: EntityLike | null;
}

const getDescriptionEntries = (descriptions: string[] = []): string[] => {
  return Array.from(new Set(descriptions.filter((value) => Boolean(value?.trim()))));
};

function EntityCardHeader({
  entity,
  interactionsCount,
  annotationsCount,
}: {
  entity: EntityLike;
  interactionsCount: number;
  annotationsCount: number;
}) {
  const entityTypeLabel = getEntityTypeLabel(entity);
  const descriptionEntries = getDescriptionEntries(getEntityDescriptions(entity));
  const displayName = getEntityDisplayName(entity);
  const secondaryName = getEntitySecondaryName(entity);
  const identifiers = useMemo(() => getEntityIdentifiers(entity), [entity]);
  const smiles = useMemo(() => getEntitySmiles(entity), [entity]);
  const entityTypeEmoji = getEntityTypeEmoji(entityTypeLabel);
  const sources = entity.sources || [];

  return (
    <div className="flex gap-4 p-4 bg-muted/20">
      {smiles && (
        <div className="shrink-0">
          <MoleculeStructure
            smiles={smiles}
            width={120}
            height={100}
            compoundName={displayName}
            className="rounded-md"
          />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold truncate">{displayName}</h2>
            {secondaryName && secondaryName !== displayName && (
              <div className="text-sm font-mono text-muted-foreground truncate" title={secondaryName}>{secondaryName}</div>
            )}
          </div>
          <Badge variant="secondary" className="flex items-center gap-1 shrink-0">
            {entityTypeEmoji && <span>{entityTypeEmoji}</span>}
            {entityTypeLabel}
          </Badge>
        </div>

        {descriptionEntries.length > 0 && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {descriptionEntries[0]}
          </p>
        )}

        <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
          {interactionsCount > 0 && (
            <div className="flex items-center gap-1">
              <Network className="h-4 w-4" />
              <span>{interactionsCount} interactions</span>
            </div>
          )}
          {annotationsCount > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="h-4 w-4" />
              <span>{annotationsCount} annotations</span>
            </div>
          )}
          {sources.length > 0 && (
            <div className="flex items-center gap-1">
              <Database className="h-4 w-4" />
              <span>{sources.length} sources</span>
            </div>
          )}
        </div>
        <EntityIdentifiersSection identifiers={identifiers} className="mt-3 rounded-md border bg-background/50 [&>div]:border-t-0" />
      </div>
    </div>
  );
}

export function EntityDetailsDialog({ open, onOpenChange, entity }: EntityDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState("interactions");

  const entityId = useMemo(() => {
    if (!entity) return null;
    const value = getEntityPublicId(entity).trim();
    return value || null;
  }, [entity]);
  const entityIds = useMemo(() => (entityId ? [entityId] : []), [entityId]);

  const [interactionFilters, setInteractionFilters] = useState<SearchFilters>({});

  useEffect(() => {
    if (entityIds.length > 0) {
      setInteractionFilters({ entity_ids: entityIds });
    }
  }, [entityIds]);

  const { data: details, isLoading: loadingDetails } = useQuery({
    queryKey: ["entity-details", entityId],
    enabled: open && !!entityId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => getEntityDetails(entityId!),
  });

  const resolvedEntity = details?.entity ?? entity;
  const resolvedEntityPk = resolvedEntity?.entityPk;

  const { data: associationScope, isLoading: loadingAssociations } = useQuery({
    queryKey: ["entity-associated-scope", resolvedEntityPk],
    enabled: open && typeof resolvedEntityPk === "number",
    staleTime: 5 * 60 * 1000,
    queryFn: async () => ({ associatedEntityIds: await getAssociatedEntityIds([resolvedEntityPk!]) }),
  });
  const interactionsCount = Number(details?.summary?.interactionCount ?? 0);
  const annotationsCount = details?.annotations?.length ?? 0;
  const associatedEntityIds = associationScope?.associatedEntityIds ?? [];
  const associationsCount = associatedEntityIds.length;
  const loadingCounts = loadingDetails || loadingAssociations;

  useEffect(() => {
    if (!loadingCounts) {
      if (interactionsCount > 0) {
        setActiveTab("interactions");
      } else if (associationsCount > 0) {
        setActiveTab("associations");
      }
    }
  }, [loadingCounts, interactionsCount, associationsCount]);

  if (!resolvedEntity) return null;

  const hasInteractions = interactionsCount > 0;
  const hasAssociations = associationsCount > 0;
  const hasAnyTab = hasInteractions || hasAssociations;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogTitle className="sr-only">Entity Details</DialogTitle>

        <EntityCardHeader
          entity={resolvedEntity}
          interactionsCount={interactionsCount}
          annotationsCount={annotationsCount}
        />

        {hasAnyTab ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <div className="px-4">
              <TabsList className="h-10">
                {hasInteractions && (
                  <TabsTrigger value="interactions" className="flex items-center gap-2">
                    Interactions
                    {loadingDetails ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {interactionsCount.toLocaleString()}
                      </Badge>
                    )}
                  </TabsTrigger>
                )}
                {hasAssociations && (
                  <TabsTrigger value="associations" className="flex items-center gap-2">
                    Associations
                    {loadingAssociations ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {associationsCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {hasInteractions && (
              <TabsContent value="interactions" className="flex-1 min-h-0 m-0 overflow-hidden">
                <div className="h-full overflow-hidden [&>div]:h-full [&>div]:!max-h-full [&_.h-svh]:h-full">
                  {entityIds.length > 0 && (
                    <RelationsExploreTab
                      filters={interactionFilters}
                      onFilterChange={setInteractionFilters}
                    />
                  )}
                </div>
              </TabsContent>
            )}

            {hasAssociations && (
              <TabsContent value="associations" className="flex-1 min-h-0 m-0 overflow-hidden">
                <EntitySearchWorkspace
                  embedded={true}
                  allowOntologyInEmbedded={false}
                  showLayoutSwitcherInEmbedded={false}
                  showFilters={false}
                  initialFilters={{ entity_ids: associatedEntityIds }}
                />
              </TabsContent>
            )}
          </Tabs>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            {loadingCounts ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Shapes className="h-4 w-4" />
                No interactions or associations found
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
