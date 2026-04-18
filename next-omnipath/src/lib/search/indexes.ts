export const INDEXES = {
  ENTITIES: "search_entities",
  INTERACTIONS: "search_interactions",
  ASSOCIATIONS: "search_associations",
} as const;

export type IndexName = typeof INDEXES[keyof typeof INDEXES];
