import { pgTable, index, foreignKey, bigint, text, jsonb, primaryKey, pgMaterializedView } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const association = pgTable("association", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	associationPk: bigint("association_pk", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	parentEntityPk: bigint("parent_entity_pk", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	memberEntityPk: bigint("member_entity_pk", { mode: "number" }).notNull(),
	roleTermId: text("role_term_id"),
	stoichiometry: text(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("association_sources_gin_idx").using("gin", table.sources.asc().nullsLast().op("array_ops")),
	foreignKey({
			columns: [table.parentEntityPk],
			foreignColumns: [entity.entityPk],
			name: "association_parent_entity_pk_fkey"
		}),
	foreignKey({
			columns: [table.memberEntityPk],
			foreignColumns: [entity.entityPk],
			name: "association_member_entity_pk_fkey"
		}),
]);

export const interaction = pgTable("interaction", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	interactionPk: bigint("interaction_pk", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityAPk: bigint("entity_a_pk", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityBPk: bigint("entity_b_pk", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	direction: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sign: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	evidenceCount: bigint("evidence_count", { mode: "number" }).notNull(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("interaction_sources_gin_idx").using("gin", table.sources.asc().nullsLast().op("array_ops")),
	foreignKey({
			columns: [table.entityAPk],
			foreignColumns: [entity.entityPk],
			name: "interaction_entity_a_pk_fkey"
		}),
	foreignKey({
			columns: [table.entityBPk],
			foreignColumns: [entity.entityPk],
			name: "interaction_entity_b_pk_fkey"
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
	identifiers: jsonb().default([]).notNull(),
}, (table) => [
	index("entity_sources_gin_idx").using("gin", table.sources.asc().nullsLast().op("array_ops")),
	index("entity_taxonomy_idx").using("btree", table.taxonomyId.asc().nullsLast().op("text_ops")),
]);

export const entityIdentifier = pgTable("entity_identifier", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_pk", { mode: "number" }).notNull(),
	identifier: text().notNull(),
	identifierType: text("identifier_type").notNull(),
}, (table) => [
	index("entity_identifier_type_idx").using("btree", table.identifierType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.entityPk],
			foreignColumns: [entity.entityPk],
			name: "entity_identifier_entity_pk_fkey"
		}),
	primaryKey({ columns: [table.entityPk, table.identifier, table.identifierType], name: "entity_identifier_pkey"}),
]);

export const interactionAnnotation = pgTable("interaction_annotation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	interactionPk: bigint("interaction_pk", { mode: "number" }).notNull(),
	cvTerm: text("cv_term").notNull(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("interaction_annotation_cv_term_idx").using("btree", table.cvTerm.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.interactionPk],
			foreignColumns: [interaction.interactionPk],
			name: "interaction_annotation_interaction_pk_fkey"
		}),
	primaryKey({ columns: [table.cvTerm, table.interactionPk], name: "interaction_annotation_pkey"}),
]);

export const entityAnnotation = pgTable("entity_annotation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_pk", { mode: "number" }).notNull(),
	cvTerm: text("cv_term").notNull(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("entity_annotation_cv_term_idx").using("btree", table.cvTerm.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.entityPk],
			foreignColumns: [entity.entityPk],
			name: "entity_annotation_entity_pk_fkey"
		}),
	primaryKey({ columns: [table.cvTerm, table.entityPk], name: "entity_annotation_pkey"}),
]);

export const interactionEvidence = pgTable("interaction_evidence", {
	source: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	interactionPk: bigint("interaction_pk", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	direction: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sign: bigint({ mode: "number" }),
	recordAttributes: jsonb("record_attributes"),
	entityAAttributes: jsonb("entity_a_attributes"),
	entityBAttributes: jsonb("entity_b_attributes"),
	evidence: jsonb(),
}, (table) => [
	primaryKey({ columns: [table.interactionPk, table.source], name: "interaction_evidence_pkey"}),
]);

export const associationEvidence = pgTable("association_evidence", {
	source: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	associationPk: bigint("association_pk", { mode: "number" }).notNull(),
	roleTermId: text("role_term_id"),
	stoichiometry: text(),
	recordAttributes: jsonb("record_attributes"),
	parentAttributes: jsonb("parent_attributes"),
	memberAttributes: jsonb("member_attributes"),
	evidence: jsonb(),
}, (table) => [
	primaryKey({ columns: [table.associationPk, table.source], name: "association_evidence_pkey"}),
]);
export const entitySummary = pgMaterializedView("entity_summary", {	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_pk", { mode: "number" }),
	canonicalIdentifier: text("canonical_identifier"),
	canonicalIdentifierType: text("canonical_identifier_type"),
	entityType: text("entity_type"),
	taxonomyId: text("taxonomy_id"),
	sources: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	identifierCount: bigint("identifier_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	interactionCount: bigint("interaction_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	annotationCount: bigint("annotation_count", { mode: "number" }),
}).as(sql`WITH interaction_counts AS ( SELECT endpoints.entity_pk, count(*) AS interaction_count FROM ( SELECT interaction.entity_a_pk AS entity_pk FROM interaction UNION ALL SELECT interaction.entity_b_pk AS entity_pk FROM interaction) endpoints GROUP BY endpoints.entity_pk ), identifier_counts AS ( SELECT entity_identifier.entity_pk, count(*) AS identifier_count FROM entity_identifier GROUP BY entity_identifier.entity_pk ), annotation_counts AS ( SELECT entity_annotation.entity_pk, count(*) AS annotation_count FROM entity_annotation GROUP BY entity_annotation.entity_pk ) SELECT e.entity_pk, e.canonical_identifier, e.canonical_identifier_type, e.entity_type, e.taxonomy_id, e.sources, COALESCE(ic.identifier_count, 0::bigint) AS identifier_count, COALESCE(xc.interaction_count, 0::bigint) AS interaction_count, COALESCE(ac.annotation_count, 0::bigint) AS annotation_count FROM entity e LEFT JOIN identifier_counts ic ON ic.entity_pk = e.entity_pk LEFT JOIN interaction_counts xc ON xc.entity_pk = e.entity_pk LEFT JOIN annotation_counts ac ON ac.entity_pk = e.entity_pk`);

export const entityFilterCounts = pgMaterializedView("entity_filter_counts", {	filterKey: text("filter_key"),
	filterValue: text("filter_value"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	docCount: bigint("doc_count", { mode: "number" }),
}).as(sql`WITH normalized_entities AS ( SELECT e.entity_pk, CASE WHEN e.entity_type IS NULL OR btrim(e.entity_type) = ''::text THEN NULL::text ELSE (((lower(split_part(e.entity_type, ':'::text, 3)) || ':'::text) || split_part(e.entity_type, ':'::text, 1)) || ':'::text) || split_part(e.entity_type, ':'::text, 2) END AS entity_type, e.sources FROM entity e ), entity_type_counts AS ( SELECT 'entity_type'::text AS filter_key, normalized_entities.entity_type AS filter_value, count(*) AS doc_count FROM normalized_entities WHERE normalized_entities.entity_type IS NOT NULL GROUP BY normalized_entities.entity_type ), source_counts AS ( SELECT 'sources'::text AS filter_key, source.source AS filter_value, count(DISTINCT normalized_entities.entity_pk) AS doc_count FROM normalized_entities CROSS JOIN LATERAL unnest(normalized_entities.sources) source(source) WHERE source.source IS NOT NULL AND btrim(source.source) <> ''::text GROUP BY source.source ) SELECT entity_type_counts.filter_key, entity_type_counts.filter_value, entity_type_counts.doc_count FROM entity_type_counts UNION ALL SELECT source_counts.filter_key, source_counts.filter_value, source_counts.doc_count FROM source_counts`);

export const interactionFilterCounts = pgMaterializedView("interaction_filter_counts", {	filterKey: text("filter_key"),
	filterValue: text("filter_value"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	docCount: bigint("doc_count", { mode: "number" }),
}).as(sql`WITH normalized_interactions AS ( SELECT i.interaction_pk, CASE WHEN i.direction IS NOT NULL AND i.direction <> 0 THEN 'true'::text ELSE 'false'::text END AS is_directed, COALESCE(i.sign, 0::bigint)::text AS sign, CASE WHEN ea.entity_type IS NULL OR btrim(ea.entity_type) = ''::text THEN NULL::text ELSE (((lower(split_part(ea.entity_type, ':'::text, 3)) || ':'::text) || split_part(ea.entity_type, ':'::text, 1)) || ':'::text) || split_part(ea.entity_type, ':'::text, 2) END AS entity_a_type, CASE WHEN eb.entity_type IS NULL OR btrim(eb.entity_type) = ''::text THEN NULL::text ELSE (((lower(split_part(eb.entity_type, ':'::text, 3)) || ':'::text) || split_part(eb.entity_type, ':'::text, 1)) || ':'::text) || split_part(eb.entity_type, ':'::text, 2) END AS entity_b_type FROM interaction i JOIN entity ea ON ea.entity_pk = i.entity_a_pk JOIN entity eb ON eb.entity_pk = i.entity_b_pk ), direction_counts AS ( SELECT 'is_directed'::text AS filter_key, normalized_interactions.is_directed AS filter_value, count(*) AS doc_count FROM normalized_interactions GROUP BY normalized_interactions.is_directed ), sign_counts AS ( SELECT 'sign'::text AS filter_key, normalized_interactions.sign AS filter_value, count(*) AS doc_count FROM normalized_interactions GROUP BY normalized_interactions.sign ), interaction_type_counts AS ( SELECT 'interaction_type'::text AS filter_key, CASE WHEN normalized_interactions.entity_a_type IS NULL OR normalized_interactions.entity_b_type IS NULL THEN NULL::text WHEN normalized_interactions.entity_a_type <= normalized_interactions.entity_b_type THEN (normalized_interactions.entity_a_type || '|'::text) || normalized_interactions.entity_b_type ELSE (normalized_interactions.entity_b_type || '|'::text) || normalized_interactions.entity_a_type END AS filter_value, count(*) AS doc_count FROM normalized_interactions GROUP BY ( CASE WHEN normalized_interactions.entity_a_type IS NULL OR normalized_interactions.entity_b_type IS NULL THEN NULL::text WHEN normalized_interactions.entity_a_type <= normalized_interactions.entity_b_type THEN (normalized_interactions.entity_a_type || '|'::text) || normalized_interactions.entity_b_type ELSE (normalized_interactions.entity_b_type || '|'::text) || normalized_interactions.entity_a_type END) ) SELECT direction_counts.filter_key, direction_counts.filter_value, direction_counts.doc_count FROM direction_counts UNION ALL SELECT sign_counts.filter_key, sign_counts.filter_value, sign_counts.doc_count FROM sign_counts UNION ALL SELECT interaction_type_counts.filter_key, interaction_type_counts.filter_value, interaction_type_counts.doc_count FROM interaction_type_counts WHERE interaction_type_counts.filter_value IS NOT NULL`);