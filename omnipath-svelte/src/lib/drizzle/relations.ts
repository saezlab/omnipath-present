import { relations } from "drizzle-orm/relations";
import { entity, entityRelation, entityIdentifier, entityRelationEvidence, relationAnnotationTerm } from "./schema";

export const entityRelationRelations = relations(entityRelation, ({one, many}) => ({
	entity_subjectEntityPk: one(entity, {
		fields: [entityRelation.subjectEntityPk],
		references: [entity.entityPk],
		relationName: "entityRelation_subjectEntityPk_entity_entityPk"
	}),
	entity_objectEntityPk: one(entity, {
		fields: [entityRelation.objectEntityPk],
		references: [entity.entityPk],
		relationName: "entityRelation_objectEntityPk_entity_entityPk"
	}),
	entityRelationEvidences: many(entityRelationEvidence),
	relationAnnotationTerms: many(relationAnnotationTerm),
}));

export const entityRelations = relations(entity, ({many}) => ({
	entityRelations_subjectEntityPk: many(entityRelation, {
		relationName: "entityRelation_subjectEntityPk_entity_entityPk"
	}),
	entityRelations_objectEntityPk: many(entityRelation, {
		relationName: "entityRelation_objectEntityPk_entity_entityPk"
	}),
	entityIdentifiers: many(entityIdentifier),
	relationAnnotationTerms: many(relationAnnotationTerm),
}));

export const entityIdentifierRelations = relations(entityIdentifier, ({one}) => ({
	entity: one(entity, {
		fields: [entityIdentifier.entityPk],
		references: [entity.entityPk]
	}),
}));

export const entityRelationEvidenceRelations = relations(entityRelationEvidence, ({one, many}) => ({
	entityRelation: one(entityRelation, {
		fields: [entityRelationEvidence.relationPk],
		references: [entityRelation.relationPk]
	}),
	relationAnnotationTerms: many(relationAnnotationTerm),
}));

export const relationAnnotationTermRelations = relations(relationAnnotationTerm, ({one}) => ({
	entityRelation: one(entityRelation, {
		fields: [relationAnnotationTerm.relationPk],
		references: [entityRelation.relationPk]
	}),
	entityRelationEvidence: one(entityRelationEvidence, {
		fields: [relationAnnotationTerm.relationEvidencePk],
		references: [entityRelationEvidence.relationEvidencePk]
	}),
	entity: one(entity, {
		fields: [relationAnnotationTerm.termEntityPk],
		references: [entity.entityPk]
	}),
}));