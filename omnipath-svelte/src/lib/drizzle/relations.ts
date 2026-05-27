import { relations } from "drizzle-orm/relations";
import { entityEvidenceInMinimal, annotationInMinimal, relationEvidenceInMinimal, entityInMinimal, entityEvidenceResolutionInMinimal, entityRelationCountsInMinimal, relationInMinimal, ontologyTermsInMinimal, annotationTermEntityBitmapInMinimal, annotationTermDirectRelationBitmapInMinimal, entityRelationBitmapInMinimal, entityEvidenceIdentifierInMinimal, identifierInMinimal, relationEvidenceRelationInMinimal, relationEvidenceAnnotationInMinimal, entityEvidenceAnnotationInMinimal, entityAnnotationInMinimal, relationAnnotationInMinimal } from "./schema";

export const entityEvidenceInMinimalRelations = relations(entityEvidenceInMinimal, ({one, many}) => ({
	entityEvidenceInMinimal: one(entityEvidenceInMinimal, {
		fields: [entityEvidenceInMinimal.parentEntityEvidenceId],
		references: [entityEvidenceInMinimal.entityEvidenceId],
		relationName: "entityEvidenceInMinimal_parentEntityEvidenceId_entityEvidenceInMinimal_entityEvidenceId"
	}),
	entityEvidenceInMinimals: many(entityEvidenceInMinimal, {
		relationName: "entityEvidenceInMinimal_parentEntityEvidenceId_entityEvidenceInMinimal_entityEvidenceId"
	}),
	entityEvidenceAnnotationInMinimals: many(entityEvidenceAnnotationInMinimal),
	relationEvidenceInMinimals_subjectEntityEvidenceId: many(relationEvidenceInMinimal, {
		relationName: "relationEvidenceInMinimal_subjectEntityEvidenceId_entityEvidenceInMinimal_entityEvidenceId"
	}),
	relationEvidenceInMinimals_objectEntityEvidenceId: many(relationEvidenceInMinimal, {
		relationName: "relationEvidenceInMinimal_objectEntityEvidenceId_entityEvidenceInMinimal_entityEvidenceId"
	}),
	entityEvidenceResolutionInMinimals: many(entityEvidenceResolutionInMinimal),
	entityEvidenceIdentifierInMinimals: many(entityEvidenceIdentifierInMinimal),
}));

export const annotationInMinimalRelations = relations(annotationInMinimal, ({many}) => ({
	relationEvidenceAnnotationInMinimals: many(relationEvidenceAnnotationInMinimal),
	entityEvidenceAnnotationInMinimals: many(entityEvidenceAnnotationInMinimal),
	entityAnnotationInMinimals: many(entityAnnotationInMinimal),
	relationAnnotationInMinimals: many(relationAnnotationInMinimal),
}));

export const relationEvidenceInMinimalRelations = relations(relationEvidenceInMinimal, ({one, many}) => ({
	entityEvidenceInMinimal_subjectEntityEvidenceId: one(entityEvidenceInMinimal, {
		fields: [relationEvidenceInMinimal.subjectEntityEvidenceId],
		references: [entityEvidenceInMinimal.entityEvidenceId],
		relationName: "relationEvidenceInMinimal_subjectEntityEvidenceId_entityEvidenceInMinimal_entityEvidenceId"
	}),
	entityEvidenceInMinimal_objectEntityEvidenceId: one(entityEvidenceInMinimal, {
		fields: [relationEvidenceInMinimal.objectEntityEvidenceId],
		references: [entityEvidenceInMinimal.entityEvidenceId],
		relationName: "relationEvidenceInMinimal_objectEntityEvidenceId_entityEvidenceInMinimal_entityEvidenceId"
	}),
	entityInMinimal_subjectEntityId: one(entityInMinimal, {
		fields: [relationEvidenceInMinimal.subjectEntityId],
		references: [entityInMinimal.entityId],
		relationName: "relationEvidenceInMinimal_subjectEntityId_entityInMinimal_entityId"
	}),
	entityInMinimal_objectEntityId: one(entityInMinimal, {
		fields: [relationEvidenceInMinimal.objectEntityId],
		references: [entityInMinimal.entityId],
		relationName: "relationEvidenceInMinimal_objectEntityId_entityInMinimal_entityId"
	}),
	relationEvidenceRelationInMinimals: many(relationEvidenceRelationInMinimal),
	relationEvidenceAnnotationInMinimals: many(relationEvidenceAnnotationInMinimal),
}));

export const entityInMinimalRelations = relations(entityInMinimal, ({many}) => ({
	entityAnnotationInMinimals: many(entityAnnotationInMinimal),
	relationEvidenceInMinimals_subjectEntityId: many(relationEvidenceInMinimal, {
		relationName: "relationEvidenceInMinimal_subjectEntityId_entityInMinimal_entityId"
	}),
	relationEvidenceInMinimals_objectEntityId: many(relationEvidenceInMinimal, {
		relationName: "relationEvidenceInMinimal_objectEntityId_entityInMinimal_entityId"
	}),
	entityEvidenceResolutionInMinimals: many(entityEvidenceResolutionInMinimal),
	entityRelationCountsInMinimals: many(entityRelationCountsInMinimal),
	relationInMinimals_subjectEntityId: many(relationInMinimal, {
		relationName: "relationInMinimal_subjectEntityId_entityInMinimal_entityId"
	}),
	relationInMinimals_objectEntityId: many(relationInMinimal, {
		relationName: "relationInMinimal_objectEntityId_entityInMinimal_entityId"
	}),
	ontologyTermsInMinimals: many(ontologyTermsInMinimal),
	annotationTermEntityBitmapInMinimals: many(annotationTermEntityBitmapInMinimal),
	annotationTermDirectRelationBitmapInMinimals: many(annotationTermDirectRelationBitmapInMinimal),
	entityRelationBitmapInMinimals: many(entityRelationBitmapInMinimal),
}));

export const entityEvidenceResolutionInMinimalRelations = relations(entityEvidenceResolutionInMinimal, ({one}) => ({
	entityEvidenceInMinimal: one(entityEvidenceInMinimal, {
		fields: [entityEvidenceResolutionInMinimal.entityEvidenceId],
		references: [entityEvidenceInMinimal.entityEvidenceId]
	}),
	entityInMinimal: one(entityInMinimal, {
		fields: [entityEvidenceResolutionInMinimal.entityId],
		references: [entityInMinimal.entityId]
	}),
}));

export const entityRelationCountsInMinimalRelations = relations(entityRelationCountsInMinimal, ({one}) => ({
	entityInMinimal: one(entityInMinimal, {
		fields: [entityRelationCountsInMinimal.entityId],
		references: [entityInMinimal.entityId]
	}),
}));

export const relationInMinimalRelations = relations(relationInMinimal, ({one, many}) => ({
	entityInMinimal_subjectEntityId: one(entityInMinimal, {
		fields: [relationInMinimal.subjectEntityId],
		references: [entityInMinimal.entityId],
		relationName: "relationInMinimal_subjectEntityId_entityInMinimal_entityId"
	}),
	entityInMinimal_objectEntityId: one(entityInMinimal, {
		fields: [relationInMinimal.objectEntityId],
		references: [entityInMinimal.entityId],
		relationName: "relationInMinimal_objectEntityId_entityInMinimal_entityId"
	}),
	relationEvidenceRelationInMinimals: many(relationEvidenceRelationInMinimal),
	relationAnnotationInMinimals: many(relationAnnotationInMinimal),
}));

export const ontologyTermsInMinimalRelations = relations(ontologyTermsInMinimal, ({one}) => ({
	entityInMinimal: one(entityInMinimal, {
		fields: [ontologyTermsInMinimal.termEntityId],
		references: [entityInMinimal.entityId]
	}),
}));

export const annotationTermEntityBitmapInMinimalRelations = relations(annotationTermEntityBitmapInMinimal, ({one}) => ({
	entityInMinimal: one(entityInMinimal, {
		fields: [annotationTermEntityBitmapInMinimal.termEntityId],
		references: [entityInMinimal.entityId]
	}),
}));

export const annotationTermDirectRelationBitmapInMinimalRelations = relations(annotationTermDirectRelationBitmapInMinimal, ({one}) => ({
	entityInMinimal: one(entityInMinimal, {
		fields: [annotationTermDirectRelationBitmapInMinimal.termEntityId],
		references: [entityInMinimal.entityId]
	}),
}));

export const entityRelationBitmapInMinimalRelations = relations(entityRelationBitmapInMinimal, ({one}) => ({
	entityInMinimal: one(entityInMinimal, {
		fields: [entityRelationBitmapInMinimal.entityId],
		references: [entityInMinimal.entityId]
	}),
}));

export const entityEvidenceIdentifierInMinimalRelations = relations(entityEvidenceIdentifierInMinimal, ({one}) => ({
	entityEvidenceInMinimal: one(entityEvidenceInMinimal, {
		fields: [entityEvidenceIdentifierInMinimal.entityEvidenceId],
		references: [entityEvidenceInMinimal.entityEvidenceId]
	}),
	identifierInMinimal: one(identifierInMinimal, {
		fields: [entityEvidenceIdentifierInMinimal.identifierId],
		references: [identifierInMinimal.identifierId]
	}),
}));

export const identifierInMinimalRelations = relations(identifierInMinimal, ({many}) => ({
	entityEvidenceIdentifierInMinimals: many(entityEvidenceIdentifierInMinimal),
}));

export const relationEvidenceRelationInMinimalRelations = relations(relationEvidenceRelationInMinimal, ({one}) => ({
	relationInMinimal: one(relationInMinimal, {
		fields: [relationEvidenceRelationInMinimal.relationId],
		references: [relationInMinimal.relationId]
	}),
	relationEvidenceInMinimal: one(relationEvidenceInMinimal, {
		fields: [relationEvidenceRelationInMinimal.relationEvidenceId],
		references: [relationEvidenceInMinimal.relationEvidenceId]
	}),
}));

export const relationEvidenceAnnotationInMinimalRelations = relations(relationEvidenceAnnotationInMinimal, ({one}) => ({
	relationEvidenceInMinimal: one(relationEvidenceInMinimal, {
		fields: [relationEvidenceAnnotationInMinimal.relationEvidenceId],
		references: [relationEvidenceInMinimal.relationEvidenceId]
	}),
	annotationInMinimal: one(annotationInMinimal, {
		fields: [relationEvidenceAnnotationInMinimal.annotationKey],
		references: [annotationInMinimal.annotationKey]
	}),
}));

export const entityEvidenceAnnotationInMinimalRelations = relations(entityEvidenceAnnotationInMinimal, ({one}) => ({
	entityEvidenceInMinimal: one(entityEvidenceInMinimal, {
		fields: [entityEvidenceAnnotationInMinimal.entityEvidenceId],
		references: [entityEvidenceInMinimal.entityEvidenceId]
	}),
	annotationInMinimal: one(annotationInMinimal, {
		fields: [entityEvidenceAnnotationInMinimal.annotationKey],
		references: [annotationInMinimal.annotationKey]
	}),
}));

export const entityAnnotationInMinimalRelations = relations(entityAnnotationInMinimal, ({one}) => ({
	entityInMinimal: one(entityInMinimal, {
		fields: [entityAnnotationInMinimal.entityId],
		references: [entityInMinimal.entityId]
	}),
	annotationInMinimal: one(annotationInMinimal, {
		fields: [entityAnnotationInMinimal.annotationKey],
		references: [annotationInMinimal.annotationKey]
	}),
}));

export const relationAnnotationInMinimalRelations = relations(relationAnnotationInMinimal, ({one}) => ({
	relationInMinimal: one(relationInMinimal, {
		fields: [relationAnnotationInMinimal.relationId],
		references: [relationInMinimal.relationId]
	}),
	annotationInMinimal: one(annotationInMinimal, {
		fields: [relationAnnotationInMinimal.annotationKey],
		references: [annotationInMinimal.annotationKey]
	}),
}));
