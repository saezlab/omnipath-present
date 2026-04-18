"use client"

import { useQuery } from "@tanstack/react-query"
import { useEntityDataSource } from "@/contexts/entity-data-source-context"
import type { EntityLike } from "@/lib/entities/display"
import { getEntityRowByPublicId } from "@/lib/queries"

interface UseEntityResult {
  data: EntityLike | null
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

      return await getEntityRowByPublicId(normalizedId)
    },
    enabled: !!entityId,
  })

  return {
    data: data ?? null,
    loading: isLoading,
    error: error as Error | null
  }
}
