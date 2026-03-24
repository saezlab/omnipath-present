"use client"

import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { InteractionDetails } from "@/features/interactions-search/components/interaction-details"
import { MeilisearchInteraction, InteractionEvidence } from "@/types/meilisearch"

interface InteractionDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  interaction: MeilisearchInteraction | null
}

interface InteractionEvidenceResponse {
  id: number;
  key: string;
  evidence: InteractionEvidence[];
}

export function InteractionDetailsSheet({ open, onOpenChange, interaction }: InteractionDetailsSheetProps) {
  const [resolvedInteraction, setResolvedInteraction] = useState<MeilisearchInteraction | null>(interaction)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setResolvedInteraction(interaction)
  }, [interaction])

  useEffect(() => {
    if (!open || !interaction?.interaction_id) return
    if (interaction.evidence) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const response = await fetch(`/api/interactions/${interaction.interaction_id}/evidence`, { cache: "no-store" })
        if (!response.ok) return
        const data = await response.json() as InteractionEvidenceResponse
        if (cancelled) return
        setResolvedInteraction({
          ...interaction,
          evidence: data.evidence || [],
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [interaction, open])

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
          {loading && !resolvedInteraction?.evidence ? (
            <div className="p-4 text-sm text-muted-foreground">Loading evidence…</div>
          ) : (
            <InteractionDetails selectedInteraction={resolvedInteraction} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
