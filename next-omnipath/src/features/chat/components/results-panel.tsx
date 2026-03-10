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
      } else if (query.entity_id) {
        const id = String(query.entity_id).trim()
        if (id.length > 0) ids.push(id)
      }

      if (ids.length > 0) {
        setInteractionsFilters({ entity_ids: ids })
      } else {
        setInteractionsFilters({})
      }
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
