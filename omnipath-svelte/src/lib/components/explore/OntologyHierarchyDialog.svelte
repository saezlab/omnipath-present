<script lang="ts">
  import { AlertCircle, Check, Loader2, Network, Plus } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog/index.js';
  import { getSelectionStore } from '$lib/stores/selection.svelte';
  import OntologyHierarchyNode from './OntologyHierarchyNode.svelte';
  import type { ApiTermInfo, HierarchyNode } from './ontology-hierarchy-types';

  type OntologyCardTerm = {
    termId: string;
    ontologyPrefix: string | null;
    label: string | null;
    definition: string | null;
    synonyms?: string[];
    sources?: string[];
  };

  interface Props {
    open: boolean;
    term: OntologyCardTerm | null;
  }

  let { open = $bindable(false), term }: Props = $props();

  const selection = getSelectionStore();

  let root = $state<HierarchyNode | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let loadedTermId = $state<string | null>(null);
  let selectedNode = $state<HierarchyNode | null>(null);
  let selectedDetails = $state<ApiTermInfo | null>(null);
  let detailsLoading = $state(false);
  let detailsError = $state<string | null>(null);

  const selectedNodeInSelection = $derived(selectedNode ? selection.isAnnotationSelected(selectedNode.id) : false);

  let availableOntologyIdsCache: Promise<Set<string>> | null = null;

  function staticOntologyIdForTermId(termId: string): string | null {
    const normalized = termId.trim();
    const upper = normalized.toUpperCase();
    if (upper.startsWith('WP') && /^WP\d+/.test(upper)) return 'wikipathways';
    if (upper.startsWith('KW-')) return 'uniprot_keywords';
    if (upper.startsWith('R-')) return 'reactome_pathways';

    const prefix = normalized.split(':', 1)[0]?.toUpperCase();
    if (prefix === 'GO') return 'gene_ontology';
    if (prefix === 'HP') return 'hpo';
    if (prefix === 'KW') return 'uniprot_keywords';
    if (prefix === 'MI') return 'psi_mi';
    if (prefix === 'OM') return 'omnipath';
    if (prefix === 'CHEBI') return 'chebi';
    return null;
  }

  async function availableOntologyIds(): Promise<Set<string>> {
    availableOntologyIdsCache ||= fetchJson<{ ontologies: Array<{ id: string; loaded: boolean }> }>('/api/ontologies')
      .then((data) => new Set((data.ontologies || []).map((ontology) => ontology.id)));
    return availableOntologyIdsCache;
  }

  async function ontologyIdForTermId(termId: string): Promise<string | null> {
    const staticId = staticOntologyIdForTermId(termId);
    const ids = await availableOntologyIds().catch(() => null);
    if (staticId && (!ids || ids.has(staticId))) return staticId;

    const prefix = termId.includes(':') ? termId.split(':', 1)[0].toLowerCase() : null;
    if (prefix && ids?.has(prefix)) return prefix;
    return staticId;
  }

  function cloneNode(node: HierarchyNode, selectedTermId: string): HierarchyNode {
    return {
      id: node.id,
      name: node.name || node.id,
      distance: node.distance,
      children: (node.children || []).map((child) => cloneNode(child, selectedTermId)),
      // Open the initial /tree path so the seed term is visible immediately.
      open: node.id !== selectedTermId,
      childrenLoaded: false,
      childrenLoading: false,
      error: null,
    };
  }

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Request failed with status ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async function fetchTermTree(termId: string): Promise<HierarchyNode | null> {
    const data = await fetchJson<{ root: HierarchyNode | null }>('/api/tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term_ids: [termId] }),
    });
    return data.root;
  }

  async function fetchApiTerms(termIds: string[]): Promise<Record<string, ApiTermInfo | null>> {
    if (termIds.length === 0) return {};
    const data = await fetchJson<{ terms: Record<string, ApiTermInfo | null> }>('/api/terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term_ids: termIds }),
    });
    return data.terms || {};
  }

  function findNode(node: HierarchyNode | null, termId: string): HierarchyNode | null {
    if (!node) return null;
    if (node.id === termId) return node;
    for (const child of node.children || []) {
      const match = findNode(child, termId);
      if (match) return match;
    }
    return null;
  }

  function mergeChildren(existing: HierarchyNode[], fetched: HierarchyNode[]): HierarchyNode[] {
    const byId = new Map<string, HierarchyNode>();
    for (const child of existing) byId.set(child.id, child);
    for (const child of fetched) {
      const previous = byId.get(child.id);
      byId.set(child.id, previous ? { ...child, ...previous, name: previous.name || child.name } : child);
    }
    return Array.from(byId.values()).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }

  async function loadInitialTree(termId: string) {
    loading = true;
    error = null;
    root = null;
    try {
      const tree = await fetchTermTree(termId);
      root = tree ? cloneNode(tree, termId) : {
        id: termId,
        name: term?.label || termId,
        children: [],
        open: true,
        childrenLoaded: false,
      };
      loadedTermId = termId;
      const initialNode = findNode(root, termId) || root;
      await selectNode(initialNode);
      await expandNode(initialNode);
      initialNode.open = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load ontology hierarchy';
      root = {
        id: termId,
        name: term?.label || termId,
        children: [],
        open: true,
        childrenLoaded: false,
      };
      await selectNode(root);
      await expandNode(root);
      root.open = true;
    } finally {
      loading = false;
    }
  }

  async function selectNode(node: HierarchyNode) {
    selectedNode = node;
    selectedDetails = {
      id: node.id,
      name: node.name || node.id,
      definition: null,
      namespace: node.id.includes(':') ? node.id.split(':', 1)[0].toLowerCase() : null,
    };
    detailsLoading = true;
    detailsError = null;
    try {
      const terms = await fetchApiTerms([node.id]);
      const info = terms[node.id];
      if (selectedNode?.id === node.id && info) {
        selectedDetails = info;
      }
    } catch (err) {
      if (selectedNode?.id === node.id) {
        detailsError = err instanceof Error ? err.message : 'Failed to load term details';
      }
    } finally {
      if (selectedNode?.id === node.id) detailsLoading = false;
    }
  }

  async function expandNode(node: HierarchyNode) {
    if (node.childrenLoading || node.childrenLoaded) return;
    const ontologyId = await ontologyIdForTermId(node.id);
    if (!ontologyId) {
      node.error = `Cannot infer ontology for ${node.id}`;
      return;
    }

    node.childrenLoading = true;
    node.error = null;
    try {
      const encodedTermId = encodeURIComponent(node.id);
      const data = await fetchJson<{ term_id: string; children: string[] }>(`/api/${ontologyId}/term/${encodedTermId}/children`);
      const childIds = Array.from(new Set((data.children || []).map(String).filter(Boolean)));
      const terms = await fetchApiTerms(childIds);
      const fetchedChildren = childIds.map((id) => ({
        id,
        name: terms[id]?.name || id,
        children: [],
        open: false,
        childrenLoaded: false,
        childrenLoading: false,
        error: null,
      } satisfies HierarchyNode));
      node.children = mergeChildren(node.children || [], fetchedChildren);
      node.childrenLoaded = true;
    } catch (err) {
      node.error = err instanceof Error ? err.message : 'Failed to load children';
    } finally {
      node.childrenLoading = false;
    }
  }

  function addSelectedNode() {
    if (!selectedNode) return;
    selection.addAnnotation({
      id: selectedNode.id,
      label: selectedDetails?.name || selectedNode.name || selectedNode.id,
      namespace: selectedDetails?.namespace || (selectedNode.id.includes(':') ? selectedNode.id.split(':', 1)[0].toLowerCase() : undefined),
      definition: selectedDetails?.definition,
    });
  }

  $effect(() => {
    const termId = term?.termId || null;
    if (!open || !termId || loadedTermId === termId) return;
    void loadInitialTree(termId);
  });
</script>

<Dialog bind:open>
  <DialogContent class="grid h-[94vh] w-[96vw] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none">
    <DialogHeader class="border-b px-6 py-4 pr-14">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <DialogTitle class="flex items-center gap-2 text-lg">
            <Network class="h-5 w-5 text-primary" />
            Explore ontology hierarchy
          </DialogTitle>
          {#if term}
            <div class="flex min-w-0 flex-wrap items-center gap-2 pt-1">
              <span class="truncate font-medium">{term.label || term.termId}</span>
              <Badge variant="outline" class="font-mono text-xs">{term.termId}</Badge>
              {#if term.ontologyPrefix}
                <Badge variant="outline">{term.ontologyPrefix}</Badge>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </DialogHeader>

    <div class="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_420px]">
      <div class="min-h-0 overflow-auto bg-background p-4">
        {#if loading}
          <div class="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 class="h-4 w-4 animate-spin" />
            Loading hierarchy...
          </div>
        {:else if error}
          <div class="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div class="font-medium">Could not load initial tree</div>
              <div class="opacity-90">{error}</div>

            </div>
          </div>
        {/if}

        {#if root && term}
          <div class="inline-block min-w-full bg-background p-2">
            <OntologyHierarchyNode
              node={root}
              seedTermId={term.termId}
              selectedNodeId={selectedNode?.id || null}
              onExpand={expandNode}
              onSelect={selectNode}
            />
          </div>
        {:else if !loading}
          <div class="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            No hierarchy available.
          </div>
        {/if}
      </div>

      <aside class="min-h-0 overflow-y-auto bg-background p-5">
        {#if selectedNode}
          <div class="space-y-5">
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant="outline" class="font-mono">{selectedNode.id}</Badge>
                {#if selectedDetails?.namespace}
                  <Badge variant="outline">{selectedDetails.namespace}</Badge>
                {/if}
                {#if selectedNode.id === term?.termId}
                  <Badge>seed</Badge>
                {/if}
              </div>
              <h3 class="text-2xl font-semibold leading-tight">{selectedDetails?.name || selectedNode.name || selectedNode.id}</h3>
              {#if detailsLoading}
                <div class="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 class="h-4 w-4 animate-spin" />
                  Loading term details...
                </div>
              {/if}
              {#if detailsError}
                <div class="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">{detailsError}</div>
              {/if}
            </div>

            <div class="flex flex-wrap gap-2">
              <Button size="sm" variant={selectedNodeInSelection ? 'default' : 'outline'} onclick={addSelectedNode} disabled={selectedNodeInSelection}>
                {#if selectedNodeInSelection}
                  <Check class="mr-1 h-4 w-4" />
                  Added to selection
                {:else}
                  <Plus class="mr-1 h-4 w-4" />
                  Add this term
                {/if}
              </Button>
            </div>

            <section class="space-y-2">
              <h4 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Definition</h4>
              <p class="whitespace-pre-wrap rounded-lg bg-background p-3 text-sm leading-6 text-foreground/90">
                {selectedDetails?.definition || 'No definition available for this ontology term.'}
              </p>
            </section>
          </div>
        {/if}
      </aside>
    </div>
  </DialogContent>
</Dialog>
