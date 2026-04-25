import { browser } from "$app/environment";

export interface DerivedSelectionScope {
  selectedEntityIds: string[];
  selectedAnnotationIds: string[];
  annotationMatchedEntityIds: string[];
  scopedEntityIds: string[];
}

function normalizeIds(ids?: Array<string | number>) {
  return Array.from(new Set((ids || []).map((id) => String(id).trim()).filter(Boolean)));
}

export function deriveSelectionScope(input: {
  selectedEntityIds?: Array<string | number>;
  selectedAnnotationIds?: Array<string | number>;
  annotationMatchedEntityIds?: Array<string | number>;
}): DerivedSelectionScope {
  const selectedEntityIds = normalizeIds(input.selectedEntityIds);
  const selectedAnnotationIds = normalizeIds(input.selectedAnnotationIds);
  const annotationMatchedEntityIds = normalizeIds(input.annotationMatchedEntityIds);

  return {
    selectedEntityIds,
    selectedAnnotationIds,
    annotationMatchedEntityIds,
    scopedEntityIds: Array.from(new Set([...selectedEntityIds, ...annotationMatchedEntityIds])),
  };
}

export function getSelectionScope(
  selectedEntityIds: string[],
  selectedAnnotationIds: string[],
  options?: { resolveAnnotationEntities?: boolean }
) {
  const resolveAnnotationEntities = options?.resolveAnnotationEntities ?? true;

  let annotationMatchedEntityIds = $state<string[]>([]);
  let isLoading = $state(false);

  async function resolve() {
    if (!resolveAnnotationEntities || selectedAnnotationIds.length === 0 || !browser) {
      annotationMatchedEntityIds = [];
      return;
    }
    isLoading = true;
    try {
      const res = await fetch("/app-api/ontology/entity-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termIds: selectedAnnotationIds }),
      });
      if (!res.ok) throw new Error("Failed to resolve annotation entities");
      const data = (await res.json()) as { entityIds: string[] };
      annotationMatchedEntityIds = data.entityIds || [];
    } catch (e) {
      console.error(e);
      annotationMatchedEntityIds = [];
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    void resolve();
  });

  const scope = $derived(
    deriveSelectionScope({
      selectedEntityIds,
      selectedAnnotationIds,
      annotationMatchedEntityIds: resolveAnnotationEntities ? annotationMatchedEntityIds : [],
    })
  );

  return {
    get selectedEntityIds() { return scope.selectedEntityIds; },
    get selectedAnnotationIds() { return scope.selectedAnnotationIds; },
    get annotationMatchedEntityIds() { return scope.annotationMatchedEntityIds; },
    get scopedEntityIds() { return scope.scopedEntityIds; },
    get isLoading() { return isLoading; },
  };
}
