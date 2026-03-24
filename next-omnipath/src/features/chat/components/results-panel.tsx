"use client"

import { Button } from "@/components/ui/button"
import { X, Search } from "lucide-react"
import { ToolResult } from "./dual-mode-interface"
import SearchPage from "@/features/search/page"
import { InteractionsExploreTab } from "@/features/explore/components/interactions-explore-tab"
import { useState, useCallback, useEffect } from "react"
import { MeilisearchFilters } from "@/types/meilisearch"

interface ResultsPanelProps {
  toolResult: ToolResult | null
  onClose: () => void
}

export function ResultsPanel({ toolResult, onClose }: ResultsPanelProps) {
  // State for interactions tab
  const [interactionsFilters, setInteractionsFilters] = useState<MeilisearchFilters>({})
  const [, setInteractionsFilterCounts] = useState<Record<string, Record<string, number>>>({})

  // Reset filters when toolResult changes
  useEffect(() => {
    if (toolResult?.toolName === "searchInteractions") {
      const query = toolResult.query
      let ids: string[] = []

      if (Array.isArray(query.entityIds)) {
        ids = query.entityIds.map(id => String(id).trim()).filter(id => id.length > 0)
      } else if (Array.isArray(query.entity_ids)) {
        ids = query.entity_ids.map(id => String(id).trim()).filter(id => id.length > 0)
      } else if (query.entity_id) {
        const id = String(query.entity_id).trim()
        if (id.length > 0) ids.push(id)
      }

      const toStringArray = (value: unknown): string[] | undefined =>
        Array.isArray(value)
          ? value.map(item => String(item).trim()).filter(item => item.length > 0)
          : undefined

      const nextFilters: MeilisearchFilters = {}

      if (ids.length > 0) nextFilters.entity_ids = ids

      const interactionTypes = toStringArray(query.interactionTypes) || toStringArray(query.interaction_types)
      if (interactionTypes?.length) nextFilters.interaction_types = interactionTypes

      const interactionAnnotationTerms = toStringArray(query.interactionAnnotationTerms) || toStringArray(query.interaction_annotation_terms)
      if (interactionAnnotationTerms?.length) nextFilters.interaction_annotation_terms = interactionAnnotationTerms

      const participantTerms = [
        ...(toStringArray(query.participantAnnotationTermsGo) || toStringArray(query.participant_annotation_terms_go) || []),
        ...(toStringArray(query.participantAnnotationTermsMi) || toStringArray(query.participant_annotation_terms_mi) || []),
        ...(toStringArray(query.participantAnnotationTermsOm) || toStringArray(query.participant_annotation_terms_om) || []),
        ...(toStringArray(query.participantAnnotationTermsHp) || toStringArray(query.participant_annotation_terms_hp) || []),
        ...(toStringArray(query.participantAnnotationTermsKw) || toStringArray(query.participant_annotation_terms_kw) || []),
      ]
      if (participantTerms.length) nextFilters.participant_annotation_terms = Array.from(new Set(participantTerms))

      if (typeof query.hasDirection === "boolean") nextFilters.is_directed = query.hasDirection
      if (typeof query.has_direction === "boolean") nextFilters.is_directed = query.has_direction

      if (typeof query.isPositive === "boolean" && query.isPositive) nextFilters.signs = [...(nextFilters.signs || []), 1]
      if (typeof query.has_positive_sign === "boolean" && query.has_positive_sign) nextFilters.signs = [...(nextFilters.signs || []), 1]

      if (typeof query.isNegative === "boolean" && query.isNegative) nextFilters.signs = [...(nextFilters.signs || []), -1]
      if (typeof query.has_negative_sign === "boolean" && query.has_negative_sign) nextFilters.signs = [...(nextFilters.signs || []), -1]

      const sources = toStringArray(query.sources)
      if (sources?.length) nextFilters.sources = sources

      setInteractionsFilters(nextFilters)
    }
  }, [toolResult])

  const handleInteractionsFilterChange = useCallback((newFilters: MeilisearchFilters) => {
    setInteractionsFilters(newFilters)
  }, [])

  const handleInteractionsFilterCountsUpdate = useCallback((counts: Record<string, Record<string, number>>) => {
    setInteractionsFilterCounts(counts)
  }, [])

  if (!toolResult) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Click on a search result to view details</p>
        </div>
      </div>
    )
  }

  const renderResultsContent = () => {
    switch (toolResult.toolName) {
      case "searchEntities": {
        const query = String(toolResult.query.query || "")

        return (
          <SearchPage
            key={toolResult.id}
            embedded={true}
            initialQuery={query}
            initialSearchType="search_entities"
          />
        )
      }

      case "resolveEntityIdentifiers": {
        const identifiers = Array.isArray(toolResult.query.identifiers)
          ? toolResult.query.identifiers.map((identifier) => String(identifier).trim()).filter((identifier) => identifier.length > 0)
          : []
        const initialSearchMode = identifiers.length > 1 ? "batch" : "identifier"

        return (
          <SearchPage
            key={toolResult.id}
            embedded={true}
            initialSearchType="search_entities"
            initialSearchMode={initialSearchMode}
            initialIdentifiers={identifiers}
          />
        )
      }

      case "searchInteractions": {
        return (
          <div className="h-full p-4">
            <InteractionsExploreTab
              filters={interactionsFilters}
              onFilterChange={handleInteractionsFilterChange}
              onFilterCountsUpdate={handleInteractionsFilterCountsUpdate}
            />
          </div>
        )
      }



      default:
        return (
          <div className="p-4">
            <pre className="text-sm">{JSON.stringify(toolResult.results, null, 2)}</pre>
          </div>
        )
    }
  }

  return (
    <div className="h-full flex flex-col bg-muted/20 relative">
      {/* Floating close button on the left */}
      <Button
        variant="secondary"
        size="icon"
        className="absolute top-0 left-2 z-10 shadow-md"
        onClick={onClose}
      >
        <X className="w-4 h-4" />
      </Button>

      <div className="h-full overflow-auto">
        {renderResultsContent()}
      </div>
    </div>
  )
}
