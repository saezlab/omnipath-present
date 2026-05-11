import { pgTable, bigint, integer, index, text, jsonb, bigserial, timestamp, primaryKey, pgMaterializedView, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


const roaringBitmap = customType<{ data: unknown }>({
	dataType() {
		return "roaringbitmap";
	},
});

export const annotationTermEntityBitmap = pgTable("annotation_term_entity_bitmap", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityPk: bigint("term_entity_id", { mode: "number" }).primaryKey().notNull(),
	// TODO: failed to parse database type 'roaringbitmap'
	entityBitmap: roaringBitmap("entity_bitmap").notNull(),
	globalCount: integer("global_count").notNull(),
});

export const annotationTermRelationBitmap = pgTable("annotation_term_relation_bitmap", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityPk: bigint("term_entity_id", { mode: "number" }).primaryKey().notNull(),
	// TODO: failed to parse database type 'roaringbitmap'
	relationBitmap: roaringBitmap("relation_bitmap").notNull(),
	globalCount: integer("global_count").notNull(),
});

export const entityRelationEvidence = pgTable("entity_relation_evidence", {
	source: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationEvidencePk: bigint("relation_evidence_id", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationPk: bigint("relation_id", { mode: "number" }).notNull(),
	recordAttributes: jsonb("record_attributes"),
	subjectAttributes: jsonb("subject_attributes"),
	objectAttributes: jsonb("object_attributes"),
	evidence: jsonb(),
}, (table) => [
	index("entity_relation_evidence_relation_idx").using("btree", table.relationPk.asc().nullsLast().op("int8_ops")),
]);

export const entityRelation = pgTable("entity_relation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationPk: bigint("relation_id", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	subjectEntityPk: bigint("subject_entity_id", { mode: "number" }).notNull(),
	predicate: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	objectEntityPk: bigint("object_entity_id", { mode: "number" }).notNull(),
	relationCategory: text("relation_category").notNull(),
	participantTypes: jsonb("participant_types").$type<string[]>().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	evidenceCount: bigint("evidence_count", { mode: "number" }).notNull(),
	sources: jsonb().$type<string[]>().notNull(),
}, (table) => [
	index("entity_relation_annotation_subject_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("int8_ops"), table.objectEntityPk.asc().nullsLast().op("int8_ops")).where(sql`(relation_category = 'association'::text)`),
	index("entity_relation_category_predicate_idx").using("btree", table.relationCategory.asc().nullsLast().op("text_ops"), table.predicate.asc().nullsLast().op("text_ops")),
	index("entity_relation_object_category_idx").using("btree", table.objectEntityPk.asc().nullsLast().op("text_ops"), table.relationCategory.asc().nullsLast().op("int8_ops")),
	index("entity_relation_object_idx").using("btree", table.objectEntityPk.asc().nullsLast().op("int8_ops")),
	index("entity_relation_subject_category_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("int8_ops"), table.relationCategory.asc().nullsLast().op("text_ops")),
	index("entity_relation_subject_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("int8_ops")),
	index("entity_relation_subject_predicate_idx").using("btree", table.subjectEntityPk.asc().nullsLast().op("text_ops"), table.predicate.asc().nullsLast().op("text_ops")),
]);

export const entityIdentifier = pgTable("entity_identifier", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_id", { mode: "number" }).notNull(),
	identifier: text().notNull(),
	identifierType: text("identifier_type").notNull(),
}, (table) => [
	index("entity_identifier_entity_pk_idx").using("btree", table.entityPk.asc().nullsLast().op("int8_ops")),
	index("entity_identifier_identifier_lower_hash_idx").using("hash", sql`lower(identifier)`),
	index("entity_identifier_value_hash_idx").using("hash", table.identifier.asc().nullsLast().op("text_ops")),
]);

export const entity = pgTable("entity", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_id", { mode: "number" }).primaryKey().notNull(),
	canonicalIdentifier: text("canonical_identifier").notNull(),
	canonicalIdentifierType: text("canonical_identifier_type").notNull(),
	entityType: text("entity_type"),
	taxonomyId: text("taxonomy_id"),
	entityAttributes: jsonb("entity_attributes"),
	sources: jsonb().$type<string[]>().notNull(),
}, (table) => [
	index("entity_cv_term_idx").using("btree", table.canonicalIdentifier.asc().nullsLast().op("text_ops")).where(sql`((entity_type = 'OM:0012:Cv Term'::text) AND (canonical_identifier_type = 'OM:0204:Cv Term Accession'::text))`),
	index("entity_taxonomy_idx").using("btree", table.taxonomyId.asc().nullsLast().op("text_ops")),
]);

export const resources = pgTable("resources", {
	resourceId: text("resource_id").primaryKey().notNull(),
	resourceName: text("resource_name"),
	description: text(),
	homepageUrl: text("homepage_url"),
	license: text(),
	pubmedId: text("pubmed_id"),
	resourceKind: text("resource_kind"),
	categories: jsonb().$type<string[]>().notNull(),
	annotationOntologies: jsonb("annotation_ontologies").$type<string[]>().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityCount: bigint("entity_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	interactionCount: bigint("interaction_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	associationCount: bigint("association_count", { mode: "number" }).default(0).notNull(),
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

export const facetEntityBitmap = pgTable("facet_entity_bitmap", {
	facetName: text("facet_name").notNull(),
	facetValue: text("facet_value").notNull(),
	// TODO: failed to parse database type 'roaringbitmap'
	entityBitmap: roaringBitmap("entity_bitmap").notNull(),
	entityCount: integer("entity_count").notNull(),
}, (table) => [
	primaryKey({ columns: [table.facetValue, table.facetName], name: "facet_entity_bitmap_pkey"}),
]);

export const facetRelationBitmap = pgTable("facet_relation_bitmap", {
	facetName: text("facet_name").notNull(),
	facetValue: text("facet_value").notNull(),
	facetCategory: text("facet_category"),
	// TODO: failed to parse database type 'roaringbitmap'
	relationBitmap: roaringBitmap("relation_bitmap").notNull(),
	relationCount: integer("relation_count").notNull(),
}, (table) => [
	primaryKey({ columns: [table.facetValue, table.facetName], name: "facet_relation_bitmap_pkey"}),
]);

export const relationAnnotationTerm = pgTable("relation_annotation_term", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationPk: bigint("relation_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationEvidencePk: bigint("relation_evidence_id", { mode: "number" }).notNull(),
	source: text().notNull(),
	scope: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityPk: bigint("term_entity_id", { mode: "number" }).notNull(),
}, (table) => [
	index("relation_annotation_term_relation_idx").using("btree", table.relationPk.asc().nullsLast().op("int8_ops")),
	index("relation_annotation_term_scope_term_relation_idx").using("btree", table.scope.asc().nullsLast().op("text_ops"), table.termEntityPk.asc().nullsLast().op("int8_ops"), table.relationPk.asc().nullsLast().op("int8_ops")),
	primaryKey({ columns: [table.relationPk, table.source, table.scope, table.termEntityPk], name: "relation_annotation_term_pkey"}),
]);
export const entityRelationCounts = pgMaterializedView("entity_relation_counts", {	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityPk: bigint("entity_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationCount: bigint("relation_count", { mode: "number" }),
}).as(sql`SELECT entity_id, count(DISTINCT relation_id) AS relation_count FROM ( SELECT entity_relation.subject_entity_id AS entity_id, entity_relation.relation_id FROM entity_relation UNION ALL SELECT entity_relation.object_entity_id AS entity_id, entity_relation.relation_id FROM entity_relation) relation_endpoints GROUP BY entity_id`);

export const ontologyTerms = pgMaterializedView("ontology_terms", {	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityPk: bigint("term_entity_id", { mode: "number" }),
	termId: text("term_id"),
	ontologyPrefix: text("ontology_prefix"),
	label: text(),
	definition: text(),
	ontologyId: text("ontology_id"),
	synonyms: text().array(),
	synonymsText: text("synonyms_text"),
	sources: jsonb().$type<string[]>(),
}).as(sql`WITH term_entities AS ( SELECT e.entity_id, e.canonical_identifier, e.sources, CASE WHEN jsonb_typeof(COALESCE(e.entity_attributes, '[]'::jsonb)) = 'array'::text THEN COALESCE(e.entity_attributes, '[]'::jsonb) ELSE '[]'::jsonb END AS attributes FROM entity e WHERE e.entity_type = 'OM:0012:Cv Term'::text AND e.canonical_identifier_type = 'OM:0204:Cv Term Accession'::text ), identifier_values AS ( SELECT te.entity_id, (array_agg(ei.identifier ORDER BY ei.id) FILTER (WHERE ei.identifier_type = 'OM:0202:Name'::text AND COALESCE(ei.identifier, ''::text) <> ''::text))[1] AS name, array_agg(DISTINCT ei.identifier ORDER BY ei.identifier) FILTER (WHERE ei.identifier_type = 'OM:0203:Synonym'::text AND COALESCE(ei.identifier, ''::text) <> ''::text) AS synonyms FROM term_entities te LEFT JOIN entity_identifier ei ON ei.entity_id = te.entity_id GROUP BY te.entity_id ), attribute_values AS ( SELECT te.entity_id, (array_agg(attr.item ->> 'value'::text ORDER BY attr.ordinality) FILTER (WHERE (attr.item ->> 'term'::text) = 'OM:0202:Name'::text AND COALESCE(attr.item ->> 'value'::text, ''::text) <> ''::text))[1] AS name, (array_agg(attr.item ->> 'value'::text ORDER BY attr.ordinality) FILTER (WHERE (attr.item ->> 'term'::text) = 'OM:0801:Definition'::text AND COALESCE(attr.item ->> 'value'::text, ''::text) <> ''::text))[1] AS definition, (array_agg(attr.item ->> 'value'::text ORDER BY attr.ordinality) FILTER (WHERE ((attr.item ->> 'term'::text) = ANY (ARRAY['OM:0803'::text, 'OM:0803:Ontology Id'::text])) AND COALESCE(attr.item ->> 'value'::text, ''::text) <> ''::text))[1] AS ontology_id, array_agg(DISTINCT attr.item ->> 'value'::text ORDER BY (attr.item ->> 'value'::text)) FILTER (WHERE (attr.item ->> 'term'::text) = 'OM:0203:Synonym'::text AND COALESCE(attr.item ->> 'value'::text, ''::text) <> ''::text) AS synonyms FROM term_entities te LEFT JOIN LATERAL jsonb_array_elements(te.attributes) WITH ORDINALITY attr(item, ordinality) ON true GROUP BY te.entity_id ) SELECT term_entity_id, term_id, ontology_prefix, label, definition, ontology_id, synonyms, array_to_string(synonyms, ' '::text) AS synonyms_text, sources FROM ( SELECT te.entity_id AS term_entity_id, te.canonical_identifier AS term_id, CASE WHEN te.canonical_identifier ~* '^KW-[0-9]+$'::text THEN 'kw'::text ELSE lower(split_part(te.canonical_identifier, ':'::text, 1)) END AS ontology_prefix, COALESCE(iv.name, av.name, te.canonical_identifier) AS label, av.definition, av.ontology_id, COALESCE(ARRAY( SELECT DISTINCT synonym.value FROM unnest(COALESCE(iv.synonyms, '{}'::text[]) || COALESCE(av.synonyms, '{}'::text[])) synonym(value) WHERE COALESCE(synonym.value, ''::text) <> ''::text ORDER BY synonym.value), '{}'::text[]) AS synonyms, te.sources FROM term_entities te LEFT JOIN identifier_values iv ON iv.entity_id = te.entity_id LEFT JOIN attribute_values av ON av.entity_id = te.entity_id) terms`);
