import { relations } from "drizzle-orm/relations";
import { entity, association, interaction, entityIdentifier, interactionAnnotation, entityAnnotation } from "./schema";

export const associationRelations = relations(association, ({one}) => ({
	entity_parentEntityPk: one(entity, {
		fields: [association.parentEntityPk],
		references: [entity.entityPk],
		relationName: "association_parentEntityPk_entity_entityPk"
	}),
	entity_memberEntityPk: one(entity, {
		fields: [association.memberEntityPk],
		references: [entity.entityPk],
		relationName: "association_memberEntityPk_entity_entityPk"
	}),
}));

export const entityRelations = relations(entity, ({many}) => ({
	associations_parentEntityPk: many(association, {
		relationName: "association_parentEntityPk_entity_entityPk"
	}),
	associations_memberEntityPk: many(association, {
		relationName: "association_memberEntityPk_entity_entityPk"
	}),
	interactions_entityAPk: many(interaction, {
		relationName: "interaction_entityAPk_entity_entityPk"
	}),
	interactions_entityBPk: many(interaction, {
		relationName: "interaction_entityBPk_entity_entityPk"
	}),
	entityIdentifiers: many(entityIdentifier),
	entityAnnotations: many(entityAnnotation),
}));

export const interactionRelations = relations(interaction, ({one, many}) => ({
	entity_entityAPk: one(entity, {
		fields: [interaction.entityAPk],
		references: [entity.entityPk],
		relationName: "interaction_entityAPk_entity_entityPk"
	}),
	entity_entityBPk: one(entity, {
		fields: [interaction.entityBPk],
		references: [entity.entityPk],
		relationName: "interaction_entityBPk_entity_entityPk"
	}),
	interactionAnnotations: many(interactionAnnotation),
}));

export const entityIdentifierRelations = relations(entityIdentifier, ({one}) => ({
	entity: one(entity, {
		fields: [entityIdentifier.entityPk],
		references: [entity.entityPk]
	}),
}));

export const interactionAnnotationRelations = relations(interactionAnnotation, ({one}) => ({
	interaction: one(interaction, {
		fields: [interactionAnnotation.interactionPk],
		references: [interaction.interactionPk]
	}),
}));

export const entityAnnotationRelations = relations(entityAnnotation, ({one}) => ({
	entity: one(entity, {
		fields: [entityAnnotation.entityPk],
		references: [entity.entityPk]
	}),
}));