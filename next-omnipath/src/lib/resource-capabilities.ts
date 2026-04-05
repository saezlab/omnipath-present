import type { ResourceRecord } from "@/lib/resources";

export function resourceSupportsInteractions(resource: ResourceRecord): boolean {
  if (typeof resource.supports_interactions === "boolean") return resource.supports_interactions;
  return (resource.interaction_count || 0) > 0;
}

export function resourceSupportsAnnotations(resource: ResourceRecord): boolean {
  if (typeof resource.supports_annotations === "boolean") return resource.supports_annotations;
  return (resource.annotation_count || 0) > 0 || (resource.ontology_term_count || 0) > 0;
}

export function resourceSupportsOntology(resource: ResourceRecord): boolean {
  if (typeof resource.supports_ontology === "boolean") return resource.supports_ontology;
  return (resource.ontology_term_count || 0) > 0;
}
