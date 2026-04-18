"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Network, Tag, Shapes, FileText, Database, Loader2 } from "lucide-react";
import type { SearchResult } from "./result-card";
import { MoleculeStructure } from "./molecule_structure";
import { InteractionsExploreTab } from "@/features/explore/components/interactions-explore-tab";
import { MeilisearchFilters, MeilisearchAssociation } from "@/types/meilisearch";
import { searchAssociations, searchInteractions } from "@/features/interactions-search/api/queries";
import { getEntityTypeEmoji } from "@/lib/utils/entity-types";
import SearchPage from "@/features/search/page";
import { getUnifiedCvTerms } from "@/lib/cv-terms";

interface EntityDetailsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entity: SearchResult | null;
}

const getDescriptionEntries = (definition: string | undefined, descriptions: string[] = []): string[] => {
    const unique = Array.from(
        new Set([definition, ...descriptions].filter((value): value is string => Boolean(value?.trim())))
    );

    return unique.sort((a, b) => {
        const aIsFunction = a.trim().toLowerCase().startsWith("function:");
        const bIsFunction = b.trim().toLowerCase().startsWith("function:");
        if (aIsFunction && !bIsFunction) return -1;
        if (!aIsFunction && bIsFunction) return 1;
        return 0;
    });
};

// Helper to detect if entity is a small molecule
const isSmallMolecule = (result: SearchResult): boolean => {
    const entityType = result._formatted?.entity_type || result.entity_type || '';
    const typeLabel = entityType.split(':')[0].toLowerCase().replace(/[\s_]/g, '');
    return typeLabel === 'smallmolecule' ||
        typeLabel === 'compound' ||
        typeLabel === 'metabolite' ||
        typeLabel === 'drug' ||
        typeLabel === 'lipid' ||
        !!(result.canonical_smiles || result.formula || result.molecular_weight);
};

// Entity Card Header Component
function EntityCardHeader({ entity }: { entity: SearchResult }) {
    const entityType = entity._formatted?.entity_type || entity.entity_type;
    const entityTypeLabel = entityType ? entityType.split(':')[0] : "Entity";
    const names = entity._formatted?.names || entity.names || [];
    const geneSymbols = entity._formatted?.gene_symbols || entity.gene_symbols || [];
    const descriptions = entity._formatted?.descriptions || entity.descriptions || [];
    const definition = entity._formatted?.definition || entity.definition;
    const descriptionEntries = getDescriptionEntries(definition, descriptions);
    // Get display name
    const displayName = geneSymbols[0] || names[0] || `Entity ${entity.entity_id || entity.id}`;

    // Extract SMILES for molecules
    const smiles = useMemo(() => {
        if (!isSmallMolecule(entity)) return null;
        const identifiers = entity._formatted?.identifiers || entity.identifiers || [];
        for (const id of identifiers) {
            const idType = id.key?.split(':')[0].toLowerCase().trim();
            if (idType === 'biotin tag' || idType === 'biotin' || idType === 'smiles' || idType === 'canonical_smiles') {
                return id.value;
            }
        }
        return entity.canonical_smiles || null;
    }, [entity]);

    const entityTypeEmoji = getEntityTypeEmoji(entityTypeLabel);

    return (
        <div className="flex gap-4 p-4 bg-muted/20">
            {/* Molecule structure image if applicable */}
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
                {/* Title and type badge */}
                <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="text-xl font-semibold truncate">{displayName}</h2>
                    <Badge variant="secondary" className="flex items-center gap-1 shrink-0">
                        {entityTypeEmoji && <span>{entityTypeEmoji}</span>}
                        {entityTypeLabel}
                    </Badge>
                </div>

                {/* Description */}
                {descriptionEntries.length > 0 && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                        {descriptionEntries[0]}
                    </p>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                    {entity.num_interactions && entity.num_interactions > 0 && (
                        <div className="flex items-center gap-1">
                            <Network className="h-4 w-4" />
                            <span>{entity.num_interactions} interactions</span>
                        </div>
                    )}
                    {entity.complexes && entity.complexes.length > 0 && (
                        <div className="flex items-center gap-1">
                            <Shapes className="h-4 w-4" />
                            <span>{entity.complexes.length} complexes</span>
                        </div>
                    )}
                    {getUnifiedCvTerms(entity).length > 0 && (
                        <div className="flex items-center gap-1">
                            <Tag className="h-4 w-4" />
                            <span>{getUnifiedCvTerms(entity).length} annotations</span>
                        </div>
                    )}
                    {entity.references && entity.references.length > 0 && (
                        <div className="flex items-center gap-1">
                            <FileText className="h-4 w-4" />
                            <span>{entity.references.length} refs</span>
                        </div>
                    )}
                    {entity.sources && entity.sources.length > 0 && (
                        <div className="flex items-center gap-1">
                            <Database className="h-4 w-4" />
                            <span>{entity.sources.length} sources</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function EntityDetailsDialog({ open, onOpenChange, entity }: EntityDetailsDialogProps) {
    const [activeTab, setActiveTab] = useState("interactions");

    // Get entity ID
    const entityId = useMemo(() => {
        if (!entity) return null;
        const raw = entity.entity_id ?? entity.id;
        if (raw === undefined || raw === null) return null;
        return String(raw);
    }, [entity]);
    const entityIds = useMemo(() => (entityId ? [entityId] : []), [entityId]);

    // Filters for interactions tab
    const [interactionFilters, setInteractionFilters] = useState<MeilisearchFilters>({});

    // Update filters when entity changes
    useEffect(() => {
        if (entityIds.length > 0) {
            setInteractionFilters({ entity_ids: entityIds });
        }
    }, [entityIds]);

    const { data: entityCounts, isLoading: loadingCounts } = useQuery({
        queryKey: ["entity-details-counts", entityId],
        enabled: open && !!entityId,
        staleTime: 5 * 60 * 1000,
        queryFn: async () => {
            const resolvedEntityId = entityId!;

            const interactionsResponse = await searchInteractions("", { entity_ids: [resolvedEntityId] }, 1, 0);

            const [parentsResponse, membersResponse] = await Promise.all([
                searchAssociations("", { member_entity_ids: [resolvedEntityId] }, 10000, 0),
                searchAssociations("", { parent_entity_ids: [resolvedEntityId] }, 10000, 0)
            ]);

            const entityIdSet = new Set<string>();
            const parentHits = parentsResponse.hits as MeilisearchAssociation[];
            const memberHits = membersResponse.hits as MeilisearchAssociation[];

            parentHits.forEach(hit => {
                if (hit.parent_entity_id) entityIdSet.add(hit.parent_entity_id);
            });
            memberHits.forEach(hit => {
                if (hit.member_entity_id) entityIdSet.add(hit.member_entity_id);
            });

            const associatedEntityIds = Array.from(entityIdSet);

            return {
                interactionsCount: interactionsResponse.estimatedTotalHits || 0,
                associationsCount: associatedEntityIds.length,
                associatedEntityIds,
            };
        }
    });

    const interactionsCount = entityCounts?.interactionsCount ?? null;
    const associationsCount = entityCounts?.associationsCount ?? 0;
    const associatedEntityIds = entityCounts?.associatedEntityIds ?? [];

    // Set default active tab based on what's available
    useEffect(() => {
        if (!loadingCounts) {
            if ((interactionsCount ?? 0) > 0) {
                setActiveTab("interactions");
            } else if (associationsCount > 0) {
                setActiveTab("associations");
            }
        }
    }, [loadingCounts, interactionsCount, associationsCount]);

    if (!entity) return null;

    const hasInteractions = (interactionsCount ?? 0) > 0;
    const hasAssociations = associationsCount > 0;
    const hasAnyTab = hasInteractions || hasAssociations;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
                {/* Visually hidden title for accessibility */}
                <DialogTitle className="sr-only">
                    Entity Details
                </DialogTitle>

                {/* Entity Card Header */}
                <EntityCardHeader entity={entity} />

                {/* Tabs - only show if there's content */}
                {hasAnyTab ? (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                        <div className="px-4">
                            <TabsList className="h-10">
                                {hasInteractions && (
                                    <TabsTrigger value="interactions" className="flex items-center gap-2">
                                        Interactions
                                        {loadingCounts ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <Badge variant="secondary" className="text-xs">
                                                {interactionsCount?.toLocaleString() || 0}
                                            </Badge>
                                        )}
                                    </TabsTrigger>
                                )}
                                {hasAssociations && (
                                    <TabsTrigger value="associations" className="flex items-center gap-2">
                                        Associations
                                        <Badge variant="secondary" className="text-xs">
                                            {associationsCount}
                                        </Badge>
                                    </TabsTrigger>
                                )}
                            </TabsList>
                        </div>

                        {hasInteractions && (
                            <TabsContent value="interactions" className="flex-1 min-h-0 m-0 overflow-hidden">
                                <div className="h-full overflow-hidden [&>div]:h-full [&>div]:!max-h-full [&_.h-svh]:h-full">
                                    {entityIds.length > 0 && (
                                        <InteractionsExploreTab
                                            filters={interactionFilters}
                                            onFilterChange={setInteractionFilters}
                                            onFilterCountsUpdate={() => { }}
                                        />
                                    )}
                                </div>
                            </TabsContent>
                        )}

                        {hasAssociations && (
                            <TabsContent value="associations" className="flex-1 min-h-0 m-0 overflow-hidden">
                                <SearchPage
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
                            "No interactions or associations found"
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
