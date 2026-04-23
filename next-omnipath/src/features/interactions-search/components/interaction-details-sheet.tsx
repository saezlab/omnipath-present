"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InteractionDetails } from "@/features/interactions-search/components/interaction-details";
import type { InteractionDetailsData, InteractionListRow } from "@/features/interactions-search/types";

interface EvidenceResponse {
  evidence: InteractionDetailsData["evidence"];
}

interface InteractionDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interaction: InteractionListRow | null;
}

export function InteractionDetailsSheet({ open, onOpenChange, interaction }: InteractionDetailsSheetProps) {
  const relationPk = interaction?.relation.relationPk;

  const evidenceQuery = useQuery({
    queryKey: ["relation-evidence", relationPk],
    enabled: open && !!relationPk,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<EvidenceResponse | null> => {
      if (!relationPk) return null;
      const response = await fetch(`/api/relations/${relationPk}/evidence`);
      if (!response.ok) {
        throw new Error(`Failed to load evidence (${response.status})`);
      }
      return response.json();
    },
  });

  const details = useMemo<InteractionDetailsData | InteractionListRow | null>(() => {
    if (!interaction) return null;

    return {
      ...interaction,
      evidence: evidenceQuery.data?.evidence ?? [],
    };
  }, [evidenceQuery.data?.evidence, interaction]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto pb-8 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Relation Details</SheetTitle>
          <SheetDescription>View relation metadata and evidence for this record</SheetDescription>
        </SheetHeader>

        <div className="mb-6 mt-6">
          {evidenceQuery.error ? (
            <div className="p-4 text-sm text-destructive">{evidenceQuery.error.message}</div>
          ) : (
            <InteractionDetails selectedInteraction={details} evidenceLoading={evidenceQuery.isLoading} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
