<script lang="ts">
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog/index.js';
  import InteractionDetails from './InteractionDetails.svelte';
  import { fetchRelationEvidence } from '$lib/api/client';
  import type { InteractionDetailsData, InteractionListRow } from '$lib/types/interactions';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    interaction: InteractionListRow | null;
  }

  let { open, onOpenChange, interaction }: Props = $props();

  let dialogOpen = $state(false);
  let evidence = $state<InteractionDetailsData['evidence']>([]);
  let evidenceLoading = $state(false);
  let evidenceError = $state<string | null>(null);

  const relationPk = $derived(interaction?.relation.relationPk);

  $effect(() => {
    dialogOpen = open;
  });

  $effect(() => {
    if (dialogOpen !== open) onOpenChange(dialogOpen);
  });

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

<Dialog bind:open={dialogOpen}>
  <DialogContent class="grid max-h-[88vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
    <DialogHeader class="border-b px-6 py-4 pr-14">
      <DialogTitle class="text-lg">Relation details</DialogTitle>
    </DialogHeader>

    <div class="min-h-0 overflow-y-auto overscroll-contain">
      {#if evidenceError}
        <div class="p-6 text-sm text-destructive">{evidenceError}</div>
      {:else}
        <InteractionDetails selectedInteraction={details} {evidenceLoading} />
      {/if}
    </div>
  </DialogContent>
</Dialog>
