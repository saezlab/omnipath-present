import type {
  Entity,
  Interaction,
  InteractionAnnotation as DbInteractionAnnotation,
  InteractionEvidence as DbInteractionEvidence,
} from "@next-omnipath/drizzle";

export type InteractionAnnotation = {
  term: string;
  value?: string | null;
  unit?: string | null;
};

export type InteractionEvidence = {
  evidence_serial: number;
  source: string;
  direction?: "a-b" | "b-a" | "undirected" | null;
  sign?: -1 | 0 | 1 | null;
  interaction_annotations: InteractionAnnotation[];
  member_a_annotations: InteractionAnnotation[];
  member_b_annotations: InteractionAnnotation[];
};

export type InteractionDirection = {
  direction: "a-b" | "b-a" | "undirected";
  sign: -1 | 0 | 1;
};

export type InteractionListRow = {
  interaction: Interaction;
  entityA: Entity;
  entityB: Entity;
};

export type InteractionDetailsData = {
  interaction: Interaction;
  entityA: Entity;
  entityB: Entity;
  evidence: InteractionEvidence[];
  interactionAnnotations: DbInteractionAnnotation[];
  rawEvidence: DbInteractionEvidence[];
};
