-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "association" (
	"association_pk" bigint PRIMARY KEY NOT NULL,
	"parent_entity_pk" bigint NOT NULL,
	"member_entity_pk" bigint NOT NULL,
	"role_term_id" text,
	"stoichiometry" text,
	"sources" text[] DEFAULT '{""}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction" (
	"interaction_pk" bigint PRIMARY KEY NOT NULL,
	"entity_a_pk" bigint NOT NULL,
	"entity_b_pk" bigint NOT NULL,
	"direction" bigint,
	"sign" bigint,
	"evidence_count" bigint NOT NULL,
	"sources" text[] DEFAULT '{""}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"entity_pk" bigint PRIMARY KEY NOT NULL,
	"canonical_identifier" text NOT NULL,
	"canonical_identifier_type" text NOT NULL,
	"entity_type" text,
	"taxonomy_id" text,
	"entity_attributes" jsonb,
	"sources" text[] DEFAULT '{""}' NOT NULL,
	"identifiers" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_identifier" (
	"entity_pk" bigint NOT NULL,
	"identifier" text NOT NULL,
	"identifier_type" text NOT NULL,
	CONSTRAINT "entity_identifier_pkey" PRIMARY KEY("entity_pk","identifier","identifier_type")
);
--> statement-breakpoint
CREATE TABLE "interaction_annotation" (
	"interaction_pk" bigint NOT NULL,
	"cv_term" text NOT NULL,
	"sources" text[] DEFAULT '{""}' NOT NULL,
	CONSTRAINT "interaction_annotation_pkey" PRIMARY KEY("cv_term","interaction_pk")
);
--> statement-breakpoint
CREATE TABLE "entity_annotation" (
	"entity_pk" bigint NOT NULL,
	"cv_term" text NOT NULL,
	"sources" text[] DEFAULT '{""}' NOT NULL,
	CONSTRAINT "entity_annotation_pkey" PRIMARY KEY("cv_term","entity_pk")
);
--> statement-breakpoint
CREATE TABLE "interaction_evidence" (
	"source" text NOT NULL,
	"interaction_pk" bigint NOT NULL,
	"direction" bigint,
	"sign" bigint,
	"record_attributes" jsonb,
	"entity_a_attributes" jsonb,
	"entity_b_attributes" jsonb,
	"evidence" jsonb,
	CONSTRAINT "interaction_evidence_pkey" PRIMARY KEY("interaction_pk","source")
);
--> statement-breakpoint
CREATE TABLE "association_evidence" (
	"source" text NOT NULL,
	"association_pk" bigint NOT NULL,
	"role_term_id" text,
	"stoichiometry" text,
	"record_attributes" jsonb,
	"parent_attributes" jsonb,
	"member_attributes" jsonb,
	"evidence" jsonb,
	CONSTRAINT "association_evidence_pkey" PRIMARY KEY("association_pk","source")
);
--> statement-breakpoint
ALTER TABLE "association" ADD CONSTRAINT "association_parent_entity_pk_fkey" FOREIGN KEY ("parent_entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association" ADD CONSTRAINT "association_member_entity_pk_fkey" FOREIGN KEY ("member_entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_entity_a_pk_fkey" FOREIGN KEY ("entity_a_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_entity_b_pk_fkey" FOREIGN KEY ("entity_b_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifier" ADD CONSTRAINT "entity_identifier_entity_pk_fkey" FOREIGN KEY ("entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_annotation" ADD CONSTRAINT "interaction_annotation_interaction_pk_fkey" FOREIGN KEY ("interaction_pk") REFERENCES "public"."interaction"("interaction_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_annotation" ADD CONSTRAINT "entity_annotation_entity_pk_fkey" FOREIGN KEY ("entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "association_sources_gin_idx" ON "association" USING gin ("sources" array_ops);--> statement-breakpoint
CREATE INDEX "interaction_sources_gin_idx" ON "interaction" USING gin ("sources" array_ops);--> statement-breakpoint
CREATE INDEX "entity_sources_gin_idx" ON "entity" USING gin ("sources" array_ops);--> statement-breakpoint
CREATE INDEX "entity_taxonomy_idx" ON "entity" USING btree ("taxonomy_id" text_ops);--> statement-breakpoint
CREATE INDEX "entity_identifier_type_idx" ON "entity_identifier" USING btree ("identifier_type" text_ops);--> statement-breakpoint
CREATE INDEX "interaction_annotation_cv_term_idx" ON "interaction_annotation" USING btree ("cv_term" text_ops);--> statement-breakpoint
CREATE INDEX "entity_annotation_cv_term_idx" ON "entity_annotation" USING btree ("cv_term" text_ops);--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."entity_summary" AS (WITH interaction_counts AS ( SELECT endpoints.entity_pk, count(*) AS interaction_count FROM ( SELECT interaction.entity_a_pk AS entity_pk FROM interaction UNION ALL SELECT interaction.entity_b_pk AS entity_pk FROM interaction) endpoints GROUP BY endpoints.entity_pk ), identifier_counts AS ( SELECT entity_identifier.entity_pk, count(*) AS identifier_count FROM entity_identifier GROUP BY entity_identifier.entity_pk ), annotation_counts AS ( SELECT entity_annotation.entity_pk, count(*) AS annotation_count FROM entity_annotation GROUP BY entity_annotation.entity_pk ) SELECT e.entity_pk, e.canonical_identifier, e.canonical_identifier_type, e.entity_type, e.taxonomy_id, e.sources, COALESCE(ic.identifier_count, 0::bigint) AS identifier_count, COALESCE(xc.interaction_count, 0::bigint) AS interaction_count, COALESCE(ac.annotation_count, 0::bigint) AS annotation_count FROM entity e LEFT JOIN identifier_counts ic ON ic.entity_pk = e.entity_pk LEFT JOIN interaction_counts xc ON xc.entity_pk = e.entity_pk LEFT JOIN annotation_counts ac ON ac.entity_pk = e.entity_pk);--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."entity_filter_counts" AS (WITH normalized_entities AS ( SELECT e.entity_pk, CASE WHEN e.entity_type IS NULL OR btrim(e.entity_type) = ''::text THEN NULL::text ELSE (((lower(split_part(e.entity_type, ':'::text, 3)) || ':'::text) || split_part(e.entity_type, ':'::text, 1)) || ':'::text) || split_part(e.entity_type, ':'::text, 2) END AS entity_type, e.sources FROM entity e ), entity_type_counts AS ( SELECT 'entity_type'::text AS filter_key, normalized_entities.entity_type AS filter_value, count(*) AS doc_count FROM normalized_entities WHERE normalized_entities.entity_type IS NOT NULL GROUP BY normalized_entities.entity_type ), source_counts AS ( SELECT 'sources'::text AS filter_key, source.source AS filter_value, count(DISTINCT normalized_entities.entity_pk) AS doc_count FROM normalized_entities CROSS JOIN LATERAL unnest(normalized_entities.sources) source(source) WHERE source.source IS NOT NULL AND btrim(source.source) <> ''::text GROUP BY source.source ) SELECT entity_type_counts.filter_key, entity_type_counts.filter_value, entity_type_counts.doc_count FROM entity_type_counts UNION ALL SELECT source_counts.filter_key, source_counts.filter_value, source_counts.doc_count FROM source_counts);--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."interaction_filter_counts" AS (WITH normalized_interactions AS ( SELECT i.interaction_pk, CASE WHEN i.direction IS NOT NULL AND i.direction <> 0 THEN 'true'::text ELSE 'false'::text END AS is_directed, COALESCE(i.sign, 0::bigint)::text AS sign, CASE WHEN ea.entity_type IS NULL OR btrim(ea.entity_type) = ''::text THEN NULL::text ELSE (((lower(split_part(ea.entity_type, ':'::text, 3)) || ':'::text) || split_part(ea.entity_type, ':'::text, 1)) || ':'::text) || split_part(ea.entity_type, ':'::text, 2) END AS entity_a_type, CASE WHEN eb.entity_type IS NULL OR btrim(eb.entity_type) = ''::text THEN NULL::text ELSE (((lower(split_part(eb.entity_type, ':'::text, 3)) || ':'::text) || split_part(eb.entity_type, ':'::text, 1)) || ':'::text) || split_part(eb.entity_type, ':'::text, 2) END AS entity_b_type FROM interaction i JOIN entity ea ON ea.entity_pk = i.entity_a_pk JOIN entity eb ON eb.entity_pk = i.entity_b_pk ), direction_counts AS ( SELECT 'is_directed'::text AS filter_key, normalized_interactions.is_directed AS filter_value, count(*) AS doc_count FROM normalized_interactions GROUP BY normalized_interactions.is_directed ), sign_counts AS ( SELECT 'sign'::text AS filter_key, normalized_interactions.sign AS filter_value, count(*) AS doc_count FROM normalized_interactions GROUP BY normalized_interactions.sign ), interaction_type_counts AS ( SELECT 'interaction_type'::text AS filter_key, CASE WHEN normalized_interactions.entity_a_type IS NULL OR normalized_interactions.entity_b_type IS NULL THEN NULL::text WHEN normalized_interactions.entity_a_type <= normalized_interactions.entity_b_type THEN (normalized_interactions.entity_a_type || '|'::text) || normalized_interactions.entity_b_type ELSE (normalized_interactions.entity_b_type || '|'::text) || normalized_interactions.entity_a_type END AS filter_value, count(*) AS doc_count FROM normalized_interactions GROUP BY ( CASE WHEN normalized_interactions.entity_a_type IS NULL OR normalized_interactions.entity_b_type IS NULL THEN NULL::text WHEN normalized_interactions.entity_a_type <= normalized_interactions.entity_b_type THEN (normalized_interactions.entity_a_type || '|'::text) || normalized_interactions.entity_b_type ELSE (normalized_interactions.entity_b_type || '|'::text) || normalized_interactions.entity_a_type END) ) SELECT direction_counts.filter_key, direction_counts.filter_value, direction_counts.doc_count FROM direction_counts UNION ALL SELECT sign_counts.filter_key, sign_counts.filter_value, sign_counts.doc_count FROM sign_counts UNION ALL SELECT interaction_type_counts.filter_key, interaction_type_counts.filter_value, interaction_type_counts.doc_count FROM interaction_type_counts WHERE interaction_type_counts.filter_value IS NOT NULL);
*/