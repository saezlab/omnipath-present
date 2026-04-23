import { pgTable, bigint, text, jsonb, index, foreignKey, bigserial } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const entity = pgTable("entity", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_pk", { mode: "number" }).primaryKey().notNull(),
	canonicalIdentifier: text("canonical_identifier").notNull(),
	canonicalIdentifierType: text("canonical_identifier_type").notNull(),
	entityType: text("entity_type"),
	taxonomyId: text("taxonomy_id"),
	entityAttributes: jsonb("entity_attributes"),
	sources: text().array().default([""]).notNull(),
});

export const ontologyTerm = pgTable("ontology_term", {
	termId: text("term_id").primaryKey().notNull(),
	ontologyPrefix: text("ontology_prefix"),
	label: text(),
	definition: text(),
	synonyms: text().array().default([""]).notNull(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("ontology_term_definition_trgm_idx").using("gin", table.definition.asc().nullsLast().op("gin_trgm_ops")),
	index("ontology_term_label_trgm_idx").using("gin", table.label.asc().nullsLast().op("gin_trgm_ops")),
]);

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

export const entityRelation = pgTable("entity_relation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationPk: bigint("relation_pk", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	subjectEntityPk: bigint("subject_entity_pk", { mode: "number" }).notNull(),
	predicate: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	objectEntityPk: bigint("object_entity_pk", { mode: "number" }).notNull(),
	relationCategory: text("relation_category").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	evidenceCount: bigint("evidence_count", { mode: "number" }).notNull(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("entity_relation_object_idx").using("btree", table.objectEntityPk.asc().nullsLast().op("int8_ops")),
	index("entity_relation_subject_category_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("int8_ops"), table.relationCategory.asc().nullsLast().op("text_ops")),
	index("entity_relation_subject_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("int8_ops")),
	index("entity_relation_subject_predicate_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("text_ops"), table.predicate.asc().nullsLast().op("int8_ops")),
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
	index("entity_identifier_value_hash_idx").using("hash", table.identifier.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.entityPk],
			foreignColumns: [entity.entityPk],
			name: "entity_identifier_entity_pk_fkey"
		}),
]);
