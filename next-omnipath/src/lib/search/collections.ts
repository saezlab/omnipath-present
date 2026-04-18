export const SEARCH_TARGETS = {
  ENTITIES: "search_entities",
  INTERACTIONS: "search_interactions",
  ASSOCIATIONS: "search_associations",
} as const;

export type SearchTarget = typeof SEARCH_TARGETS[keyof typeof SEARCH_TARGETS];
