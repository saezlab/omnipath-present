<script lang="ts">
  import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '$lib/components/ui/sheet/index.js';
  import InteractionDetails from './InteractionDetails.svelte';
  import { fetchRelationEvidence } from '$lib/api/client';
  import type { InteractionDetailsData, InteractionListRow } from '$lib/types/interactions';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    interaction: InteractionListRow | null;
  }

  let { open, onOpenChange, interaction }: Props = $props();

  let evidence = $state<InteractionDetailsData['evidence']>([]);
  let evidenceLoading = $state(false);
  let evidenceError = $state<string | null>(null);

  const relationPk = $derived(interaction?.relation.relationPk);

  $effect(() => {
    if (!open || !relationPk) return;
    evidenceLoading = true;
    evidenceError = null;
    fetchRelationEvidence(relationPk)
      .then((data) => {
        evidence = data.evidence;
      })
      .catch((err) => {
        evidenceError = err instanceof Error ? err.message : 'Failed to load evidence';
      })
      .finally(() => {
        evidenceLoading = false;
      });
  });

  const details = $derived<InteractionDetailsData | InteractionListRow | null>(
    interaction ? { ...interaction, evidence } : null
  );
</script>

<Sheet {open} onOpenChange={onOpenChange}>
  <SheetContent class="w-full overflow-y-auto pb-8 sm:max-w-2xl">
    <SheetHeader>
      <SheetTitle>Relation Details</SheetTitle>
      <SheetDescription>View relation metadata and evidence for this record</SheetDescription>
    </SheetHeader>

    <div class="mb-6 mt-6">
      {#if evidenceError}
        <div class="p-4 text-sm text-destructive">{evidenceError}</div>
      {:else}
        <InteractionDetails selectedInteraction={details} {evidenceLoading} />
      {/if}
    </div>
  </SheetContent>
</Sheet>
