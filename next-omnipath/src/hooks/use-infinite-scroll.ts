import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef } from 'react'

interface InfiniteScrollPage<T, TPageParam> {
  results: T[]
  nextPageParam?: TPageParam
}

interface UseInfiniteScrollOptions<T, TPageParam = number> {
  fetchData: (pageParam: TPageParam, limit: number) => Promise<InfiniteScrollPage<T, TPageParam>>
  pageSize?: number
  rootMargin?: string
  threshold?: number
  dependencies?: unknown[]
  root?: HTMLElement | null
  queryKey?: readonly unknown[]
  initialPageParam?: TPageParam
  getNextPageParam?: (
    lastPage: InfiniteScrollPage<T, TPageParam>,
    allPages: Array<InfiniteScrollPage<T, TPageParam>>,
  ) => TPageParam | undefined
}

interface UseInfiniteScrollReturn<T> {
  data: T[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: Error | null
  totalResults: number
  sentinelRef: React.RefObject<HTMLElement | null>
  refetch: () => Promise<void>
  reset: () => void
}

export function useInfiniteScroll<T, TPageParam = number>({
  fetchData,
  pageSize = 50,
  rootMargin = '100px',
  threshold = 0,
  dependencies = [],
  root = null,
  queryKey,
  initialPageParam,
  getNextPageParam,
}: UseInfiniteScrollOptions<T, TPageParam>): UseInfiniteScrollReturn<T> {
  const instanceId = useId()
  const queryClient = useQueryClient()
  const sentinelRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const resolvedQueryKey = useMemo(
    () => queryKey ?? ['use-infinite-scroll', instanceId, ...dependencies],
    [dependencies, instanceId, queryKey],
  )

  const query = useInfiniteQuery({
    queryKey: resolvedQueryKey,
    queryFn: async ({ pageParam }) => fetchData(pageParam as TPageParam, pageSize),
    initialPageParam: (initialPageParam ?? 0) as TPageParam,
    getNextPageParam: (lastPage, allPages) => {
      if (getNextPageParam) {
        return getNextPageParam(lastPage, allPages)
      }

      const loadedCount = allPages.reduce((sum, page) => sum + page.results.length, 0)
      return lastPage.results.length === pageSize ? (loadedCount as TPageParam) : undefined
    },
  })

  const data = useMemo(
    () => query.data?.pages.flatMap((page) => page.results) ?? [],
    [query.data],
  )

  const totalResults = data.length
  const hasMore = query.hasNextPage ?? false
  const error = query.error instanceof Error ? query.error : query.error ? new Error('Failed to fetch data') : null

  const refetch = useCallback(async () => {
    await query.refetch()
  }, [query])

  const reset = useCallback(() => {
    void queryClient.removeQueries({ queryKey: resolvedQueryKey })
  }, [queryClient, resolvedQueryKey])

  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    if (!sentinelRef.current) {
      return
    }

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries

      if (entry?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage()
      }
    }

    observerRef.current = new IntersectionObserver(observerCallback, {
      root,
      rootMargin,
      threshold,
    })

    observerRef.current.observe(sentinelRef.current)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage, root, rootMargin, threshold])

  return {
    data,
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore,
    error,
    totalResults,
    sentinelRef,
    refetch,
    reset,
  }
}
