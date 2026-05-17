import { pgTable, index, text, unique, bigserial, bigint, timestamp, foreignKey, uniqueIndex, check, integer, boolean, primaryKey, customType, jsonb, smallint, uuid } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


const roaringbitmap = customType<{ data: unknown; driverData: unknown }>({
	dataType() {
		return "roaringbitmap";
	},
});


export const resolverProteinIdentifierLookupInMinimal = pgTable("resolver_protein_identifier_lookup", {
	source: text().notNull(),
	keyType: text("key_type").notNull(),
	keyValue: text("key_value").notNull(),
	taxonomyId: text("taxonomy_id"),
	primaryUniprot: text("primary_uniprot").notNull(),
	mappingType: text("mapping_type").notNull(),
}, (table) => [
	index("resolver_protein_lookup_key_idx").using("btree", table.keyType.asc().nullsLast().op("text_ops"), table.keyValue.asc().nullsLast().op("text_ops")),
	index("resolver_protein_lookup_key_tax_idx").using("btree", table.keyType.asc().nullsLast().op("text_ops"), table.keyValue.asc().nullsLast().op("text_ops"), table.taxonomyId.asc().nullsLast().op("text_ops")),
	index("resolver_protein_lookup_mapping_type_idx").using("btree", table.mappingType.asc().nullsLast().op("text_ops")),
	index("resolver_protein_lookup_primary_idx").using("btree", table.primaryUniprot.asc().nullsLast().op("text_ops")),
]);

export const resolverChemicalIdentifierLookupInMinimal = pgTable("resolver_chemical_identifier_lookup", {
	source: text().notNull(),
	keyType: text("key_type").notNull(),
	keyValue: text("key_value").notNull(),
	standardInchiKey: text("standard_inchi_key").notNull(),
	standardInchi: text("standard_inchi").notNull(),
}, (table) => [
	index("resolver_chemical_lookup_inchi_idx").using("hash", table.standardInchi.asc().nullsLast().op("text_ops")),
	index("resolver_chemical_lookup_inchi_key_idx").using("btree", table.standardInchiKey.asc().nullsLast().op("text_ops")),
	index("resolver_chemical_lookup_key_idx").using("btree", table.keyType.asc().nullsLast().op("text_ops"), table.keyValue.asc().nullsLast().op("text_ops")),
]);

export const sourceRowInMinimal = pgTable("source_row", {
	sourceRowId: bigserial("source_row_id", { mode: "bigint" }).primaryKey().notNull(),
	source: text().notNull(),
	dataset: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowId: bigint("row_id", { mode: "number" }).notNull(),
	snapshotId: text("snapshot_id"),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("source_row_source_dataset_row_id_key").on(table.dataset, table.rowId, table.source),
]);

export const entityEvidenceInMinimal = pgTable("entity_evidence", {
	entityEvidenceId: bigserial("entity_evidence_id", { mode: "bigint" }).primaryKey().notNull(),
	source: text().notNull(),
	dataset: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowId: bigint("row_id", { mode: "number" }).notNull(),
	snapshotId: text("snapshot_id"),
	occurrenceId: text("occurrence_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	parentEntityEvidenceId: bigint("parent_entity_evidence_id", { mode: "number" }),
	entityRole: text("entity_role").notNull(),
	entityType: text("entity_type"),
	taxonomyId: text("taxonomy_id"),
}, (table) => [
	foreignKey({
			columns: [table.parentEntityEvidenceId],
			foreignColumns: [table.entityEvidenceId],
			name: "entity_evidence_parent_entity_evidence_id_fkey"
		}),
	unique("entity_evidence_source_dataset_row_id_occurrence_id_key").on(table.dataset, table.occurrenceId, table.rowId, table.source),
]);

export const identifierTypeInMinimal = pgTable("identifier_type", {
	identifierTypeId: bigint("identifier_type_id", { mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
}, (table) => [
	unique("identifier_type_name_key").on(table.name),
]);

export const entityTypeInMinimal = pgTable("entity_type", {
	entityTypeId: bigserial("entity_type_id", { mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
}, (table) => [
	unique("entity_type_name_key").on(table.name),
]);

export const resolutionStatusInMinimal = pgTable("resolution_status", {
	resolutionStatusId: smallint("resolution_status_id").primaryKey().notNull(),
	name: text().notNull(),
}, (table) => [
	unique("resolution_status_name_key").on(table.name),
]);

export const resolutionReasonInMinimal = pgTable("resolution_reason", {
	resolutionReasonId: smallint("resolution_reason_id").primaryKey().notNull(),
	name: text().notNull(),
}, (table) => [
	unique("resolution_reason_name_key").on(table.name),
]);

export const identifierInMinimal = pgTable("identifier_evidence", {
	identifierId: bigserial("identifier_id", { mode: "bigint" }).primaryKey().notNull(),
	identifierTypeId: bigint("identifier_type_id", { mode: "number" }).notNull(),
	value: text().notNull(),
}, (table) => [
	uniqueIndex("identifier_evidence_type_value_idx").using("btree", table.identifierTypeId.asc().nullsLast().op("int8_ops"), table.value.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.identifierTypeId],
			foreignColumns: [identifierTypeInMinimal.identifierTypeId],
			name: "identifier_evidence_type_id_fkey"
		}),
]);

export const annotationInMinimal = pgTable("annotation", {
	annotationKey: uuid("annotation_key").primaryKey().notNull(),
	term: text().notNull(),
	value: text(),
	unit: text(),
}, (table) => [
	uniqueIndex("annotation_value_idx").using("btree", table.term.asc().nullsLast().op("text_ops"), table.value.asc().nullsLast().op("text_ops"), table.unit.asc().nullsLast().op("text_ops")),
]);

export const relationEvidenceInMinimal = pgTable("relation_evidence", {
	relationEvidenceId: bigserial("relation_evidence_id", { mode: "bigint" }).primaryKey().notNull(),
	source: text().notNull(),
	dataset: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowId: bigint("row_id", { mode: "number" }).notNull(),
	snapshotId: text("snapshot_id"),
	relationOccurrenceId: text("relation_occurrence_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	subjectEntityEvidenceId: bigint("subject_entity_evidence_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	subjectEntityId: bigint("subject_entity_id", { mode: "number" }),
	predicate: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	objectEntityEvidenceId: bigint("object_entity_evidence_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	objectEntityId: bigint("object_entity_id", { mode: "number" }),
	relationCategory: text("relation_category").notNull(),
}, (table) => [
	index("relation_object_entity_idx").using("btree", table.objectEntityId.asc().nullsLast().op("int8_ops")),
	index("relation_object_idx").using("btree", table.objectEntityEvidenceId.asc().nullsLast().op("int8_ops")),
	index("relation_source_dataset_idx").using("btree", table.source.asc().nullsLast().op("text_ops"), table.dataset.asc().nullsLast().op("text_ops")),
	index("relation_subject_entity_idx").using("btree", table.subjectEntityId.asc().nullsLast().op("int8_ops")),
	index("relation_subject_idx").using("btree", table.subjectEntityEvidenceId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.subjectEntityEvidenceId],
			foreignColumns: [entityEvidenceInMinimal.entityEvidenceId],
			name: "relation_evidence_subject_entity_evidence_id_fkey"
		}),
	foreignKey({
			columns: [table.objectEntityEvidenceId],
			foreignColumns: [entityEvidenceInMinimal.entityEvidenceId],
			name: "relation_evidence_object_entity_evidence_id_fkey"
		}),
	foreignKey({
			columns: [table.subjectEntityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "relation_evidence_subject_entity_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.objectEntityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "relation_evidence_object_entity_id_fkey"
		}).onDelete("cascade"),
	unique("relation_evidence_source_dataset_row_id_relation_occurrence_key").on(table.dataset, table.relationOccurrenceId, table.rowId, table.source),
	check("relation_evidence_check", sql`(((subject_entity_evidence_id IS NOT NULL))::integer + ((subject_entity_id IS NOT NULL))::integer) = 1`),
	check("relation_evidence_check1", sql`(((object_entity_evidence_id IS NOT NULL))::integer + ((object_entity_id IS NOT NULL))::integer) = 1`),
	check("relation_evidence_object_endpoint_check", sql`(((object_entity_evidence_id IS NOT NULL))::integer + ((object_entity_id IS NOT NULL))::integer) = 1`),
	check("relation_evidence_subject_endpoint_check", sql`(((subject_entity_evidence_id IS NOT NULL))::integer + ((subject_entity_id IS NOT NULL))::integer) = 1`),
]);

export const entityInMinimal = pgTable("entity", {
	entityId: bigserial("entity_id", { mode: "bigint" }).primaryKey().notNull(),
	entityTypeId: bigint("entity_type_id", { mode: "number" }).notNull(),
	taxonomyId: text("taxonomy_id"),
	canonicalIdentifierTypeId: bigint("canonical_identifier_type_id", { mode: "number" }),
	canonicalIdentifier: text("canonical_identifier").notNull(),
	identifiers: jsonb().notNull(),
	resolutionStatusId: smallint("resolution_status_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("entity_status_idx").using("btree", table.resolutionStatusId.asc().nullsLast().op("int2_ops")),
	uniqueIndex("entity_canonical_key_idx").using("btree", table.entityTypeId.asc().nullsLast().op("int8_ops"), table.taxonomyId.asc().nullsLast().op("text_ops"), table.canonicalIdentifierTypeId.asc().nullsLast().op("int8_ops"), table.canonicalIdentifier.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.entityTypeId],
			foreignColumns: [entityTypeInMinimal.entityTypeId],
			name: "entity_entity_type_id_fkey"
		}),
	foreignKey({
			columns: [table.canonicalIdentifierTypeId],
			foreignColumns: [identifierTypeInMinimal.identifierTypeId],
			name: "entity_canonical_identifier_type_id_fkey"
		}),
	foreignKey({
			columns: [table.resolutionStatusId],
			foreignColumns: [resolutionStatusInMinimal.resolutionStatusId],
			name: "entity_resolution_status_id_fkey"
		}),
]);

export const entityEvidenceResolutionInMinimal = pgTable("entity_evidence_resolution", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityEvidenceId: bigint("entity_evidence_id", { mode: "number" }).primaryKey().notNull(),
	statusId: smallint("status_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityId: bigint("entity_id", { mode: "number" }),
	reasonId: smallint("reason_id"),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("entity_evidence_resolution_entity_idx").using("btree", table.entityId.asc().nullsLast().op("int8_ops")),
	index("entity_resolution_reason_idx").using("btree", table.reasonId.asc().nullsLast().op("int2_ops")),
	index("entity_resolution_status_idx").using("btree", table.statusId.asc().nullsLast().op("int2_ops")),
	foreignKey({
			columns: [table.entityEvidenceId],
			foreignColumns: [entityEvidenceInMinimal.entityEvidenceId],
			name: "entity_evidence_resolution_entity_evidence_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.entityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "entity_evidence_resolution_entity_id_fkey"
		}),
	foreignKey({
			columns: [table.statusId],
			foreignColumns: [resolutionStatusInMinimal.resolutionStatusId],
			name: "entity_evidence_resolution_status_id_fkey"
		}),
	foreignKey({
			columns: [table.reasonId],
			foreignColumns: [resolutionReasonInMinimal.resolutionReasonId],
			name: "entity_evidence_resolution_reason_id_fkey"
		}),
	check("entity_evidence_resolution_entity_check", sql`((status_id = ANY (ARRAY[1, 2, 3])) AND (entity_id IS NOT NULL)) OR ((status_id = 4) AND (entity_id IS NULL))`),
]);

export const entityRelationCountsInMinimal = pgTable("entity_relation_counts", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityId: bigint("entity_id", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationCount: bigint("relation_count", { mode: "number" }).notNull(),
}, (table) => [
	index("entity_relation_counts_count_idx").using("btree", table.relationCount.desc().nullsFirst().op("int8_ops"), table.entityId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.entityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "entity_relation_counts_entity_id_fkey"
		}).onDelete("cascade"),
]);

export const relationInMinimal = pgTable("relation", {
	relationId: bigserial("relation_id", { mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	subjectEntityId: bigint("subject_entity_id", { mode: "number" }).notNull(),
	predicate: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	objectEntityId: bigint("object_entity_id", { mode: "number" }).notNull(),
	relationCategory: text("relation_category"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("relation_unique_idx").using("btree", table.subjectEntityId.asc().nullsLast().op("int8_ops"), table.predicate.asc().nullsLast().op("int8_ops"), table.objectEntityId.asc().nullsLast().op("int8_ops"), table.relationCategory.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.subjectEntityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "relation_subject_entity_id_fkey"
		}),
	foreignKey({
			columns: [table.objectEntityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "relation_object_entity_id_fkey"
		}),
]);

export const ontologyTermsInMinimal = pgTable("ontology_terms", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityId: bigint("term_entity_id", { mode: "number" }).primaryKey().notNull(),
	termId: text("term_id").notNull(),
	ontologyPrefix: text("ontology_prefix"),
	label: text().notNull(),
	definition: text(),
	ontologyId: text("ontology_id"),
	synonyms: text().array().default([""]).notNull(),
	synonymsText: text("synonyms_text").default("").notNull(),
	sources: text().array().default([""]).notNull(),
}, (table) => [
	index("ontology_terms_definition_trgm_idx").using("gin", table.definition.asc().nullsLast().op("gin_trgm_ops")),
	index("ontology_terms_label_trgm_idx").using("gin", table.label.asc().nullsLast().op("gin_trgm_ops")),
	index("ontology_terms_ontology_id_idx").using("btree", table.ontologyId.asc().nullsLast().op("text_ops")),
	index("ontology_terms_ontology_prefix_idx").using("btree", table.ontologyPrefix.asc().nullsLast().op("text_ops")),
	index("ontology_terms_sources_gin_idx").using("gin", table.sources.asc().nullsLast().op("array_ops")),
	index("ontology_terms_synonyms_text_trgm_idx").using("gin", table.synonymsText.asc().nullsLast().op("gin_trgm_ops")),
	index("ontology_terms_term_id_idx").using("btree", table.termId.asc().nullsLast().op("text_ops")),
	index("ontology_terms_term_id_trgm_idx").using("gin", table.termId.asc().nullsLast().op("gin_trgm_ops")),
	foreignKey({
			columns: [table.termEntityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "ontology_terms_term_entity_id_fkey"
		}).onDelete("cascade"),
]);

export const annotationTermEntityBitmapInMinimal = pgTable("annotation_term_entity_bitmap", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityId: bigint("term_entity_id", { mode: "number" }).primaryKey().notNull(),
	// TODO: failed to parse database type 'roaringbitmap'
	entityBitmap: roaringbitmap("entity_bitmap").notNull(),
	globalCount: integer("global_count").notNull(),
}, (table) => [
	index("annotation_term_entity_count_idx").using("btree", table.globalCount.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.termEntityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "annotation_term_entity_bitmap_term_entity_id_fkey"
		}).onDelete("cascade"),
]);

export const annotationTermRelationBitmapInMinimal = pgTable("annotation_term_relation_bitmap", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	termEntityId: bigint("term_entity_id", { mode: "number" }).primaryKey().notNull(),
	// TODO: failed to parse database type 'roaringbitmap'
	relationBitmap: roaringbitmap("relation_bitmap").notNull(),
	globalCount: integer("global_count").notNull(),
}, (table) => [
	index("annotation_term_relation_count_idx").using("btree", table.globalCount.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.termEntityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "annotation_term_relation_bitmap_term_entity_id_fkey"
		}).onDelete("cascade"),
]);

export const resolverMappingPolicyInMinimal = pgTable("resolver_mapping_policy", {
	entityFamily: text("entity_family").notNull(),
	resolverSource: text("resolver_source"),
	keyType: text("key_type").notNull(),
	mappingType: text("mapping_type"),
	action: text().notNull(),
	requiresTaxonomy: boolean("requires_taxonomy").default(false).notNull(),
}, (table) => [
	uniqueIndex("resolver_mapping_policy_unique_idx").using("btree", sql`entity_family`, sql`key_type`, sql`COALESCE(mapping_type, ''::text)`, sql`COALESCE(resolver_source, ''::text)`),
	check("resolver_mapping_policy_action_check", sql`action = ANY (ARRAY['accept'::text, 'candidate_only'::text, 'ignore'::text])`),
]);

export const entityEvidenceIdentifierInMinimal = pgTable("entity_evidence_identifier", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityEvidenceId: bigint("entity_evidence_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	identifierId: bigint("identifier_id", { mode: "number" }).notNull(),
}, (table) => [
	index("entity_evidence_identifier_entity_idx").using("btree", table.entityEvidenceId.asc().nullsLast().op("int8_ops"), table.identifierId.asc().nullsLast().op("int8_ops")),
	index("entity_evidence_identifier_identifier_idx").using("btree", table.identifierId.asc().nullsLast().op("int8_ops"), table.entityEvidenceId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.entityEvidenceId],
			foreignColumns: [entityEvidenceInMinimal.entityEvidenceId],
			name: "entity_evidence_identifier_entity_evidence_id_fkey"
		}),
	foreignKey({
			columns: [table.identifierId],
			foreignColumns: [identifierInMinimal.identifierId],
			name: "entity_evidence_identifier_identifier_id_fkey"
		}),
	primaryKey({ columns: [table.entityEvidenceId, table.identifierId], name: "entity_evidence_identifier_pkey"}),
]);

export const relationEvidenceRelationInMinimal = pgTable("relation_evidence_relation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationId: bigint("relation_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationEvidenceId: bigint("relation_evidence_id", { mode: "number" }).notNull(),
}, (table) => [
	index("relation_evidence_relation_relation_idx").using("btree", table.relationEvidenceId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.relationId],
			foreignColumns: [relationInMinimal.relationId],
			name: "relation_evidence_relation_relation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.relationEvidenceId],
			foreignColumns: [relationEvidenceInMinimal.relationEvidenceId],
			name: "relation_evidence_relation_relation_evidence_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.relationEvidenceId, table.relationId], name: "relation_evidence_relation_pkey"}),
	unique("relation_evidence_relation_relation_evidence_id_key").on(table.relationEvidenceId),
]);

export const relationEvidenceAnnotationInMinimal = pgTable("relation_evidence_annotation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationEvidenceId: bigint("relation_evidence_id", { mode: "number" }).notNull(),
	annotationKey: uuid("annotation_key").notNull(),
	scope: text().notNull(),
}, (table) => [
	index("relation_evidence_annotation_annotation_key_idx").using("btree", table.annotationKey.asc().nullsLast().op("uuid_ops")),
	index("relation_evidence_annotation_relation_evidence_idx").using("btree", table.relationEvidenceId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.relationEvidenceId],
			foreignColumns: [relationEvidenceInMinimal.relationEvidenceId],
			name: "relation_evidence_annotation_relation_evidence_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.annotationKey],
			foreignColumns: [annotationInMinimal.annotationKey],
			name: "relation_evidence_annotation_annotation_key_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.relationEvidenceId, table.annotationKey, table.scope], name: "relation_evidence_annotation_pkey"}),
]);

export const entityEvidenceAnnotationInMinimal = pgTable("entity_evidence_annotation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityEvidenceId: bigint("entity_evidence_id", { mode: "number" }).notNull(),
	annotationKey: uuid("annotation_key").notNull(),
	scope: text().notNull(),
}, (table) => [
	index("entity_evidence_annotation_annotation_key_idx").using("btree", table.annotationKey.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.entityEvidenceId],
			foreignColumns: [entityEvidenceInMinimal.entityEvidenceId],
			name: "entity_evidence_annotation_entity_evidence_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.annotationKey],
			foreignColumns: [annotationInMinimal.annotationKey],
			name: "entity_evidence_annotation_annotation_key_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.entityEvidenceId, table.annotationKey, table.scope], name: "entity_evidence_annotation_pkey"}),
]);

export const entityAnnotationInMinimal = pgTable("entity_annotation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entityId: bigint("entity_id", { mode: "number" }).notNull(),
	annotationKey: uuid("annotation_key").notNull(),
	scope: text().notNull(),
}, (table) => [
	index("entity_annotation_annotation_key_idx").using("btree", table.annotationKey.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.entityId],
			foreignColumns: [entityInMinimal.entityId],
			name: "entity_annotation_entity_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.annotationKey],
			foreignColumns: [annotationInMinimal.annotationKey],
			name: "entity_annotation_annotation_key_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.entityId, table.annotationKey, table.scope], name: "entity_annotation_pkey"}),
]);

export const relationAnnotationInMinimal = pgTable("relation_annotation", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	relationId: bigint("relation_id", { mode: "number" }).notNull(),
	annotationKey: uuid("annotation_key").notNull(),
	scope: text().notNull(),
}, (table) => [
	index("relation_annotation_annotation_key_idx").using("btree", table.annotationKey.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.relationId],
			foreignColumns: [relationInMinimal.relationId],
			name: "relation_annotation_relation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.annotationKey],
			foreignColumns: [annotationInMinimal.annotationKey],
			name: "relation_annotation_annotation_key_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.relationId, table.annotationKey, table.scope], name: "relation_annotation_pkey"}),
]);

export const facetEntityBitmapInMinimal = pgTable("facet_entity_bitmap", {
	facetName: text("facet_name").notNull(),
	facetValue: text("facet_value").notNull(),
	// TODO: failed to parse database type 'roaringbitmap'
	entityBitmap: roaringbitmap("entity_bitmap").notNull(),
	entityCount: integer("entity_count").notNull(),
}, (table) => [
	index("facet_entity_count_idx").using("btree", table.facetName.asc().nullsLast().op("int4_ops"), table.entityCount.desc().nullsFirst().op("int4_ops"), table.facetValue.asc().nullsLast().op("int4_ops")),
	primaryKey({ columns: [table.facetName, table.facetValue], name: "facet_entity_bitmap_pkey"}),
]);

export const facetRelationBitmapInMinimal = pgTable("facet_relation_bitmap", {
	facetName: text("facet_name").notNull(),
	facetValue: text("facet_value").notNull(),
	facetCategory: text("facet_category").default("").notNull(),
	// TODO: failed to parse database type 'roaringbitmap'
	relationBitmap: roaringbitmap("relation_bitmap").notNull(),
	relationCount: integer("relation_count").notNull(),
}, (table) => [
	index("facet_relation_count_idx").using("btree", table.facetName.asc().nullsLast().op("int4_ops"), table.relationCount.desc().nullsFirst().op("int4_ops"), table.facetValue.asc().nullsLast().op("int4_ops")),
	primaryKey({ columns: [table.facetCategory, table.facetName, table.facetValue], name: "facet_relation_bitmap_pkey"}),
]);
