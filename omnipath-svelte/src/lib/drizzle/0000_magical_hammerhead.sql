-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "entity_relation" (
	"relation_pk" bigint PRIMARY KEY NOT NULL,
	"subject_entity_pk" bigint NOT NULL,
	"predicate" text NOT NULL,
	"object_entity_pk" bigint NOT NULL,
	"relation_category" text NOT NULL,
	"participant_types" text[] DEFAULT '{""}' NOT NULL,
	"evidence_count" bigint NOT NULL,
	"sources" text[] DEFAULT '{""}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_identifier" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_pk" bigint NOT NULL,
	"identifier" text NOT NULL,
	"identifier_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"entity_pk" bigint PRIMARY KEY NOT NULL,
	"canonical_identifier" text NOT NULL,
	"canonical_identifier_type" text NOT NULL,
	"entity_type" text,
	"taxonomy_id" text,
	"entity_attributes" jsonb,
	"sources" text[] DEFAULT '{""}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotation_term_entity_bitmap" (
	"term_entity_pk" bigint PRIMARY KEY NOT NULL,
	"entity_bitmap" "roaringbitmap" NOT NULL,
	"global_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"resource_name" text,
	"description" text,
	"homepage_url" text,
	"license" text,
	"pubmed_id" text,
	"resource_kind" text,
	"categories" text[] DEFAULT '{""}' NOT NULL,
	"annotation_ontologies" text[] DEFAULT '{""}' NOT NULL,
	"entity_count" bigint DEFAULT 0 NOT NULL,
	"interaction_count" bigint DEFAULT 0 NOT NULL,
	"association_count" bigint DEFAULT 0 NOT NULL,
	"identifier_count" bigint DEFAULT 0 NOT NULL,
	"ontology_term_count" bigint DEFAULT 0 NOT NULL,
	"total_size_bytes" bigint DEFAULT 0 NOT NULL,
	"last_downloaded_at" timestamp with time zone,
	"last_built_at" timestamp with time zone,
	"build_status" text
);
--> statement-breakpoint
CREATE TABLE "annotation_term_relation_bitmap" (
	"term_entity_pk" bigint PRIMARY KEY NOT NULL,
	"relation_bitmap" "roaringbitmap" NOT NULL,
	"global_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_relation_evidence" (
	"source" text NOT NULL,
	"relation_evidence_pk" bigint PRIMARY KEY NOT NULL,
	"relation_pk" bigint NOT NULL,
	"record_attributes" jsonb,
	"subject_attributes" jsonb,
	"object_attributes" jsonb,
	"evidence" jsonb
);
--> statement-breakpoint
CREATE TABLE "facet_entity_bitmap" (
	"facet_name" text NOT NULL,
	"facet_value" text NOT NULL,
	"entity_bitmap" "roaringbitmap" NOT NULL,
	"entity_count" integer NOT NULL,
	CONSTRAINT "facet_entity_bitmap_pkey" PRIMARY KEY("facet_value","facet_name")
);
--> statement-breakpoint
CREATE TABLE "facet_relation_bitmap" (
	"facet_name" text NOT NULL,
	"facet_value" text NOT NULL,
	"relation_bitmap" "roaringbitmap" NOT NULL,
	"relation_count" integer NOT NULL,
	"facet_category" text,
	CONSTRAINT "facet_relation_bitmap_pkey" PRIMARY KEY("facet_value","facet_name")
);
--> statement-breakpoint
CREATE TABLE "relation_annotation_term" (
	"relation_pk" bigint NOT NULL,
	"relation_evidence_pk" bigint NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"term_entity_pk" bigint NOT NULL,
	CONSTRAINT "relation_annotation_term_pkey" PRIMARY KEY("term_entity_pk","scope","relation_evidence_pk")
);
--> statement-breakpoint
ALTER TABLE "entity_relation" ADD CONSTRAINT "entity_relation_subject_entity_pk_fkey" FOREIGN KEY ("subject_entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relation" ADD CONSTRAINT "entity_relation_object_entity_pk_fkey" FOREIGN KEY ("object_entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifier" ADD CONSTRAINT "entity_identifier_entity_pk_fkey" FOREIGN KEY ("entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relation_evidence" ADD CONSTRAINT "entity_relation_evidence_relation_pk_fkey" FOREIGN KEY ("relation_pk") REFERENCES "public"."entity_relation"("relation_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_annotation_term" ADD CONSTRAINT "relation_annotation_term_relation_pk_fkey" FOREIGN KEY ("relation_pk") REFERENCES "public"."entity_relation"("relation_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_annotation_term" ADD CONSTRAINT "relation_annotation_term_relation_evidence_pk_fkey" FOREIGN KEY ("relation_evidence_pk") REFERENCES "public"."entity_relation_evidence"("relation_evidence_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_annotation_term" ADD CONSTRAINT "relation_annotation_term_term_entity_pk_fkey" FOREIGN KEY ("term_entity_pk") REFERENCES "public"."entity"("entity_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_relation_category_predicate_idx" ON "entity_relation" USING btree ("relation_category" text_ops,"predicate" text_ops);--> statement-breakpoint
CREATE INDEX "entity_relation_object_category_idx" ON "entity_relation" USING btree ("object_entity_pk" text_ops,"relation_category" text_ops);--> statement-breakpoint
CREATE INDEX "entity_relation_object_idx" ON "entity_relation" USING btree ("object_entity_pk" int8_ops);--> statement-breakpoint
CREATE INDEX "entity_relation_subject_category_idx" ON "entity_relation" USING btree ("subject_entity_pk" text_ops,"relation_category" int8_ops);--> statement-breakpoint
CREATE INDEX "entity_relation_subject_idx" ON "entity_relation" USING btree ("subject_entity_pk" int8_ops);--> statement-breakpoint
CREATE INDEX "entity_relation_subject_predicate_idx" ON "entity_relation" USING btree ("subject_entity_pk" int8_ops,"predicate" int8_ops);--> statement-breakpoint
CREATE INDEX "entity_identifier_entity_pk_idx" ON "entity_identifier" USING btree ("entity_pk" int8_ops);--> statement-breakpoint
CREATE INDEX "entity_identifier_identifier_lower_hash_idx" ON "entity_identifier" USING hash (lower(identifier) text_ops);--> statement-breakpoint
CREATE INDEX "entity_identifier_value_hash_idx" ON "entity_identifier" USING hash ("identifier" text_ops);--> statement-breakpoint
CREATE INDEX "entity_cv_term_idx" ON "entity" USING btree ("canonical_identifier" text_ops) WHERE ((entity_type = 'OM:0012:Cv Term'::text) AND (canonical_identifier_type = 'OM:0204:Cv Term Accession'::text));--> statement-breakpoint
CREATE INDEX "entity_taxonomy_idx" ON "entity" USING btree ("taxonomy_id" text_ops);--> statement-breakpoint
CREATE INDEX "resources_build_status_idx" ON "resources" USING btree ("build_status" text_ops);--> statement-breakpoint
CREATE INDEX "resources_resource_name_trgm_idx" ON "resources" USING gin ("resource_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "entity_relation_evidence_relation_idx" ON "entity_relation_evidence" USING btree ("relation_pk" int8_ops);--> statement-breakpoint
CREATE INDEX "relation_annotation_term_relation_idx" ON "relation_annotation_term" USING btree ("relation_pk" int8_ops);--> statement-breakpoint
CREATE INDEX "relation_annotation_term_scope_term_relation_idx" ON "relation_annotation_term" USING btree ("scope" text_ops,"term_entity_pk" int8_ops,"relation_pk" int8_ops);--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."ontology_term_annotation_counts" AS (WITH entity_counts AS ( SELECT term_entity_1.entity_pk AS term_entity_pk, count(DISTINCT er.subject_entity_pk) AS annotated_entity_count FROM entity_relation er JOIN entity term_entity_1 ON term_entity_1.entity_pk = er.object_entity_pk WHERE er.relation_category = 'association'::text AND term_entity_1.entity_type = 'OM:0012:Cv Term'::text AND term_entity_1.canonical_identifier_type = 'OM:0204:Cv Term Accession'::text GROUP BY term_entity_1.entity_pk ), relation_counts AS ( SELECT relation_annotation_term.term_entity_pk, count(DISTINCT relation_annotation_term.relation_pk) AS annotated_relation_count FROM relation_annotation_term GROUP BY relation_annotation_term.term_entity_pk ) SELECT term_entity.entity_pk AS term_entity_pk, term_entity.canonical_identifier AS term_id, COALESCE(ec.annotated_entity_count, 0::bigint) AS annotated_entity_count, COALESCE(rc.annotated_relation_count, 0::bigint) AS annotated_relation_count, COALESCE(ec.annotated_entity_count, 0::bigint) + COALESCE(rc.annotated_relation_count, 0::bigint) AS annotated_item_count FROM entity term_entity LEFT JOIN entity_counts ec ON ec.term_entity_pk = term_entity.entity_pk LEFT JOIN relation_counts rc ON rc.term_entity_pk = term_entity.entity_pk WHERE term_entity.entity_type = 'OM:0012:Cv Term'::text AND term_entity.canonical_identifier_type = 'OM:0204:Cv Term Accession'::text);
*/