"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { InteractionDetails } from "@/features/interactions-search/components/interaction-details"
import { MeilisearchInteraction, InteractionEvidence } from "@/types/meilisearch"

interface InteractionDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  interaction: MeilisearchInteraction | null
}

interface InteractionEvidenceResponse {
  id: number
  key: string
  evidence: InteractionEvidence[]
}

export function InteractionDetailsSheet({ open, onOpenChange, interaction }: InteractionDetailsSheetProps) {
  const [resolvedInteraction, setResolvedInteraction] = useState<MeilisearchInteraction | null>(interaction)

  useEffect(() => {
    setResolvedInteraction(interaction)
  }, [interaction])

  const interactionId = interaction?.interaction_id

  const { data: evidence, isLoading } = useQuery({
    queryKey: ["interaction-evidence", interactionId],
    enabled: open && !!interactionId && !interaction?.evidence,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch(`/api/interactions/${interactionId}/evidence`)
      if (!response.ok) {
        throw new Error(`Failed to load interaction evidence (${response.status})`)
      }
      const data = await response.json() as InteractionEvidenceResponse
      return data.evidence || []
    },
  })

  const displayInteraction = useMemo(() => {
    if (!interaction) return null
    if (interaction.evidence) return interaction
    if (!evidence) return resolvedInteraction
    return {
      ...interaction,
      evidence,
    }
  }, [evidence, interaction, resolvedInteraction])

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
          {isLoading && !displayInteraction?.evidence ? (
            <div className="p-4 text-sm text-muted-foreground">Loading evidence…</div>
          ) : (
            <InteractionDetails selectedInteraction={displayInteraction} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
