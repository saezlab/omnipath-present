import { relations } from "drizzle-orm/relations";
import { entity, entityIdentifier, entityRelation, entityRelationEvidence, relationAnnotationTerm, ontologyTerm } from "./schema";

export const entityIdentifierRelations = relations(entityIdentifier, ({one}) => ({
	entity: one(entity, {
		fields: [entityIdentifier.entityPk],
		references: [entity.entityPk]
	}),
}));

export const entityRelations = relations(entity, ({many}) => ({
	entityIdentifiers: many(entityIdentifier),
	entityRelations_subjectEntityPk: many(entityRelation, {
		relationName: "entityRelation_subjectEntityPk_entity_entityPk"
	}),
	entityRelations_objectEntityPk: many(entityRelation, {
		relationName: "entityRelation_objectEntityPk_entity_entityPk"
	}),
}));

export const entityRelationEvidenceRelations = relations(entityRelationEvidence, ({one, many}) => ({
	entityRelation: one(entityRelation, {
		fields: [entityRelationEvidence.relationPk],
		references: [entityRelation.relationPk]
	}),
	relationAnnotationTerms: many(relationAnnotationTerm),
}));

export const entityRelationRelations = relations(entityRelation, ({one, many}) => ({
	entityRelationEvidences: many(entityRelationEvidence),
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
	ontologyTerm: one(ontologyTerm, {
		fields: [relationAnnotationTerm.termId],
		references: [ontologyTerm.termId]
	}),
}));

export const ontologyTermRelations = relations(ontologyTerm, ({many}) => ({
	relationAnnotationTerms: many(relationAnnotationTerm),
}));