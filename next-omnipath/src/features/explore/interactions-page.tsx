"use client";

import { useSidebarContent } from "@/contexts/sidebar-content-context";
import { useCallback, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { InteractionsExploreTab } from "./components/interactions-explore-tab";
import { FilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import { MeilisearchFilters } from "@/types/meilisearch";
import { useEntitySelection } from "@/contexts/entity-selection-context";

interface InteractionsPageProps {
    useEntityFilters?: boolean;
    lockedEntityIds?: Array<string | number>;
}

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

export default function InteractionsPage({ useEntityFilters = true, lockedEntityIds = EMPTY_LOCKED_ENTITY_IDS }: InteractionsPageProps) {
    const { setSidebarContent } = useSidebarContent();
    const searchParams = useSearchParams();
    const { selectedEntities } = useEntitySelection();

    // Get selected entity IDs from context
    const selectedEntityIds = useMemo(
        () =>
            selectedEntities
                .map((e) => e.entityId ?? e.id)
                .map((id) => String(id).trim())
                .filter((id) => id.length > 0),
        [selectedEntities]
    );

    const normalizedLockedEntityIds = useMemo(
        () => lockedEntityIds.map((id) => String(id).trim()).filter((id) => id.length > 0),
        [lockedEntityIds]
    );

    const singleEntityParam = searchParams.get("entity") || "";
    const multiEntityParam = searchParams.get("entities") || "";

    // Parse entity IDs from URL params
    const urlEntityIds = useMemo(() => {
        if (multiEntityParam) {
            const ids = multiEntityParam
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id.length > 0);
            return ids.length > 0 ? ids : undefined;
        }
        if (singleEntityParam) {
            const id = singleEntityParam.trim();
            return id ? [id] : undefined;
        }
        return undefined;
    }, [singleEntityParam, multiEntityParam]);

    const enforceEntityScope = useCallback((next: MeilisearchFilters): MeilisearchFilters => {
        if (!useEntityFilters) return next;

        const scopedEntityIds =
            normalizedLockedEntityIds.length > 0
                ? normalizedLockedEntityIds
                : urlEntityIds ?? (selectedEntityIds.length > 0 ? selectedEntityIds : undefined);

        if (!scopedEntityIds || scopedEntityIds.length === 0) {
            return next;
        }

        const prevIds = (next.entity_ids || []).map((id) => String(id));
        const sameLength = prevIds.length === scopedEntityIds.length;
        const sameValues = sameLength && prevIds.every((id, idx) => id === scopedEntityIds[idx]);
        const alreadyScoped = sameValues && next.member_a_id === undefined && next.member_b_id === undefined;
        if (alreadyScoped) {
            return next;
        }

        return {
            ...next,
            entity_ids: scopedEntityIds,
            member_a_id: undefined,
            member_b_id: undefined,
        };
    }, [useEntityFilters, normalizedLockedEntityIds, urlEntityIds, selectedEntityIds]);

    // Interactions filter state - use locked IDs first, then URL params, then selection context
    const [filters, setFilters] = useState<MeilisearchFilters>(() => {
        if (!useEntityFilters) {
            return {};
        }
        return enforceEntityScope({});
    });
    const [filterCounts, setFilterCounts] = useState<Record<string, Record<string, number>>>({});

    // Handlers for interactions filters
    const handleFilterChange = useCallback((newFilters: MeilisearchFilters) => {
        setFilters(enforceEntityScope(newFilters));
    }, [enforceEntityScope]);

    const handleClearFilters = useCallback(() => {
        setFilters(enforceEntityScope({}));
    }, [enforceEntityScope]);

    const handleFilterCountsUpdate = useCallback((counts: Record<string, Record<string, number>>) => {
        setFilterCounts(counts);
    }, []);

    // Sync URL params / selection / locked scope with filter state
    useEffect(() => {
        if (!useEntityFilters) {
            return;
        }
        setFilters((prev) => enforceEntityScope(prev));
    }, [singleEntityParam, multiEntityParam, selectedEntityIds, normalizedLockedEntityIds, useEntityFilters, enforceEntityScope]);

    // Set sidebar content
    useEffect(() => {
        if (Object.keys(filterCounts).length > 0) {
            setSidebarContent(
                <FilterSidebar
                    filters={filters}
                    filterCounts={filterCounts}
                    onFilterChange={handleFilterChange}
                    onClearFilters={handleClearFilters}
                    isMobile
                />
            );
        } else {
            setSidebarContent(null);
        }

        return () => {
            setSidebarContent(null);
        };
    }, [filters, filterCounts, handleFilterChange, handleClearFilters, setSidebarContent]);

    return (
        <div className="flex-1 flex flex-col">
            <div className="flex-1 overflow-y-auto">
                <div className="w-full px-4">
                    <InteractionsExploreTab
                        filters={filters}
                        onFilterChange={handleFilterChange}
                        onFilterCountsUpdate={handleFilterCountsUpdate}
                    />
                </div>
            </div>
        </div>
    );
}
