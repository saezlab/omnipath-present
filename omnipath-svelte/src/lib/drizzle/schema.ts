import { pgTable, index, foreignKey, bigint, text, bigserial, jsonb, integer, timestamp, primaryKey, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


const roaringBitmap = customType<{ data: unknown }>({
	dataType() {
		return "roaringbitmap";
	},
});

export const entityRelation = pgTable("entity_relation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationPk: bigint("relation_pk", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	subjectEntityPk: bigint("subject_entity_pk", { mode: "number" }).notNull(),
	predicate: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	objectEntityPk: bigint("object_entity_pk", { mode: "number" }).notNull(),
	relationCategory: text("relation_category").notNull(),
	participantTypes: text("participant_types").array().default([""]).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	evidenceCount: bigint("evidence_count", { mode: "number" }).notNull(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("entity_relation_category_predicate_idx").using("btree", table.relationCategory.asc().nullsLast().op("text_ops"), table.predicate.asc().nullsLast().op("text_ops")),
	index("entity_relation_object_category_idx").using("btree", table.objectEntityPk.asc().nullsLast().op("text_ops"), table.relationCategory.asc().nullsLast().op("text_ops")),
	index("entity_relation_object_idx").using("btree", table.objectEntityPk.asc().nullsLast().op("int8_ops")),
	index("entity_relation_subject_category_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("text_ops"), table.relationCategory.asc().nullsLast().op("int8_ops")),
	index("entity_relation_subject_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("int8_ops")),
	index("entity_relation_subject_predicate_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("int8_ops"), table.predicate.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.subjectEntityPk],
			foreignColumns: [entity.entityPk],
			name: "entity_relation_subject_entity_pk_fkey"
		}),
	foreignKey({
			columns: [table.objectEntityPk],
			foreignColumns: [entity.entityPk],
			name: "entity_relation_object_entity_pk_fkey"
		}),
]);

export const entityIdentifier = pgTable("entity_identifier", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_pk", { mode: "number" }).notNull(),
	identifier: text().notNull(),
	identifierType: text("identifier_type").notNull(),
}, (table) => [
	index("entity_identifier_entity_pk_idx").using("btree", table.entityPk.asc().nullsLast().op("int8_ops")),
	index("entity_identifier_identifier_lower_hash_idx").using("hash", sql`lower(identifier)`),
	index("entity_identifier_value_hash_idx").using("hash", table.identifier.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.entityPk],
			foreignColumns: [entity.entityPk],
			name: "entity_identifier_entity_pk_fkey"
		}),
]);

export const entity = pgTable("entity", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_pk", { mode: "number" }).primaryKey().notNull(),
	canonicalIdentifier: text("canonical_identifier").notNull(),
	canonicalIdentifierType: text("canonical_identifier_type").notNull(),
	entityType: text("entity_type"),
	taxonomyId: text("taxonomy_id"),
	entityAttributes: jsonb("entity_attributes"),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("entity_cv_term_idx").using("btree", table.canonicalIdentifier.asc().nullsLast().op("text_ops")).where(sql`((entity_type = 'OM:0012:Cv Term'::text) AND (canonical_identifier_type = 'OM:0204:Cv Term Accession'::text))`),
	index("entity_taxonomy_idx").using("btree", table.taxonomyId.asc().nullsLast().op("text_ops")),
]);

export const annotationTermEntityBitmap = pgTable("annotation_term_entity_bitmap", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityPk: bigint("term_entity_pk", { mode: "number" }).primaryKey().notNull(),
	entityBitmap: roaringBitmap("entity_bitmap").notNull(),
	globalCount: integer("global_count").notNull(),
});

export const resources = pgTable("resources", {
	resourceId: text("resource_id").primaryKey().notNull(),
	resourceName: text("resource_name"),
	description: text(),
	homepageUrl: text("homepage_url"),
	license: text(),
	pubmedId: text("pubmed_id"),
	resourceKind: text("resource_kind"),
	categories: text().array().default([""]).notNull(),
	annotationOntologies: text("annotation_ontologies").array().default([""]).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityCount: bigint("entity_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	interactionCount: bigint("interaction_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	membershipCount: bigint("membership_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	annotationCount: bigint("annotation_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	identifierCount: bigint("identifier_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	ontologyTermCount: bigint("ontology_term_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalSizeBytes: bigint("total_size_bytes", { mode: "number" }).default(0).notNull(),
	lastDownloadedAt: timestamp("last_downloaded_at", { withTimezone: true, mode: 'string' }),
	lastBuiltAt: timestamp("last_built_at", { withTimezone: true, mode: 'string' }),
	buildStatus: text("build_status"),
}, (table) => [
	index("resources_build_status_idx").using("btree", table.buildStatus.asc().nullsLast().op("text_ops")),
	index("resources_resource_name_trgm_idx").using("gin", table.resourceName.asc().nullsLast().op("gin_trgm_ops")),
]);

export const annotationTermRelationBitmap = pgTable("annotation_term_relation_bitmap", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityPk: bigint("term_entity_pk", { mode: "number" }).primaryKey().notNull(),
	relationBitmap: roaringBitmap("relation_bitmap").notNull(),
	globalCount: integer("global_count").notNull(),
});

export const entityRelationEvidence = pgTable("entity_relation_evidence", {
	source: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationEvidencePk: bigint("relation_evidence_pk", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationPk: bigint("relation_pk", { mode: "number" }).notNull(),
	recordAttributes: jsonb("record_attributes"),
	subjectAttributes: jsonb("subject_attributes"),
	objectAttributes: jsonb("object_attributes"),
	evidence: jsonb(),
}, (table) => [
	index("entity_relation_evidence_relation_idx").using("btree", table.relationPk.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.relationPk],
			foreignColumns: [entityRelation.relationPk],
			name: "entity_relation_evidence_relation_pk_fkey"
		}),
]);

export const facetEntityBitmap = pgTable("facet_entity_bitmap", {
	facetName: text("facet_name").notNull(),
	facetValue: text("facet_value").notNull(),
	entityBitmap: roaringBitmap("entity_bitmap").notNull(),
	entityCount: integer("entity_count").notNull(),
}, (table) => [
	primaryKey({ columns: [table.facetValue, table.facetName], name: "facet_entity_bitmap_pkey"}),
]);

export const facetRelationBitmap = pgTable("facet_relation_bitmap", {
	facetName: text("facet_name").notNull(),
	facetValue: text("facet_value").notNull(),
	relationBitmap: roaringBitmap("relation_bitmap").notNull(),
	relationCount: integer("relation_count").notNull(),
	facetCategory: text("facet_category"),
}, (table) => [
	primaryKey({ columns: [table.facetValue, table.facetName], name: "facet_relation_bitmap_pkey"}),
]);

export const relationAnnotationTerm = pgTable("relation_annotation_term", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationPk: bigint("relation_pk", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationEvidencePk: bigint("relation_evidence_pk", { mode: "number" }).notNull(),
	source: text().notNull(),
	scope: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityPk: bigint("term_entity_pk", { mode: "number" }).notNull(),
}, (table) => [
	index("relation_annotation_term_relation_idx").using("btree", table.relationPk.asc().nullsLast().op("int8_ops")),
	index("relation_annotation_term_scope_term_relation_idx").using("btree", table.scope.asc().nullsLast().op("text_ops"), table.termEntityPk.asc().nullsLast().op("int8_ops"), table.relationPk.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.relationPk],
			foreignColumns: [entityRelation.relationPk],
			name: "relation_annotation_term_relation_pk_fkey"
		}),
	foreignKey({
			columns: [table.relationEvidencePk],
			foreignColumns: [entityRelationEvidence.relationEvidencePk],
			name: "relation_annotation_term_relation_evidence_pk_fkey"
		}),
	foreignKey({
			columns: [table.termEntityPk],
			foreignColumns: [entity.entityPk],
			name: "relation_annotation_term_term_entity_pk_fkey"
		}),
	primaryKey({ columns: [table.termEntityPk, table.scope, table.relationEvidencePk], name: "relation_annotation_term_pkey"}),
]);
