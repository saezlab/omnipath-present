import { relations } from "drizzle-orm/relations";
import { entityRelation, entityRelationEvidence, entity, entityIdentifier } from "./schema";

export const entityRelationEvidenceRelations = relations(entityRelationEvidence, ({one}) => ({
	entityRelation: one(entityRelation, {
		fields: [entityRelationEvidence.relationPk],
		references: [entityRelation.relationPk]
	}),
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
}));

export const entityRelations = relations(entity, ({many}) => ({
	entityRelations_subjectEntityPk: many(entityRelation, {
		relationName: "entityRelation_subjectEntityPk_entity_entityPk"
	}),
	entityRelations_objectEntityPk: many(entityRelation, {
		relationName: "entityRelation_objectEntityPk_entity_entityPk"
	}),
	entityIdentifiers: many(entityIdentifier),
}));

export const entityIdentifierRelations = relations(entityIdentifier, ({one}) => ({
	entity: one(entity, {
		fields: [entityIdentifier.entityPk],
		references: [entity.entityPk]
	}),
}));