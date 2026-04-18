"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { InteractionDetails } from "@/features/interactions-search/components/interaction-details"
import type { InteractionDetailsData, InteractionListRow } from "@/features/interactions-search/types"

interface InteractionDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  interaction: InteractionListRow | null
}

export function InteractionDetailsSheet({ open, onOpenChange, interaction }: InteractionDetailsSheetProps) {
  const [resolvedInteraction, setResolvedInteraction] = useState<InteractionListRow | null>(interaction)

  useEffect(() => {
    setResolvedInteraction(interaction)
  }, [interaction])

  const interactionId = interaction?.interaction.interactionPk

  const { data: details, isLoading } = useQuery({
    queryKey: ["interaction-details", interactionId],
    enabled: open && !!interactionId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch(`/api/interactions/${interactionId}`)
      if (!response.ok) {
        throw new Error(`Failed to load interaction details (${response.status})`)
      }
      return await response.json() as InteractionDetailsData | null
    },
  })

  const displayInteraction = useMemo(() => {
    if (details) return details
    return resolvedInteraction
  }, [details, resolvedInteraction])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto pb-8">
        <SheetHeader>
          <SheetTitle>Interaction Details</SheetTitle>
          <SheetDescription>
            View detailed evidence for this interaction
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 mb-6">
          {isLoading && !details ? (
            <div className="p-4 text-sm text-muted-foreground">Loading evidence…</div>
          ) : (
            <InteractionDetails selectedInteraction={displayInteraction} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
