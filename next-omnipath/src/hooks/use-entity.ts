"use client"


import { useQuery } from "@tanstack/react-query"
import { fetchSearchDocuments } from "@/features/search/api/queries"
import { INDEXES } from "@/lib/search/indexes"
import { useEntityDataSource } from "@/contexts/entity-data-source-context"
import type { SearchResult } from "@/features/search/components/result-card"

interface UseEntityResult {
  data: SearchResult | null
  loading: boolean
  error: Error | null
}

export function useEntity(entityId: string | undefined): UseEntityResult {
  const entityDataSource = useEntityDataSource()

  const { data, isLoading, error } = useQuery({
    queryKey: ["entity", entityId, entityDataSource ? "custom-source" : "postgres"],
    queryFn: async () => {
      if (!entityId) return null

      const normalizedId = entityId.trim()
      if (!normalizedId) return null

      if (entityDataSource) {
        return entityDataSource.getEntity(normalizedId)
      }

      const { documents } = await fetchSearchDocuments(
        INDEXES.ENTITIES,
        [normalizedId],
      )

      const hits = (documents as unknown as SearchResult[]) || []
      return hits.length > 0 ? hits[0] : null
    },
    enabled: !!entityId,
  })

  return {
    data: data ?? null,
    loading: isLoading,
    error: error as Error | null
  }
}