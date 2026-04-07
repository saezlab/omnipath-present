import type { ResourceRecord } from "@/lib/resources";

export function resourceSupportsInteractions(resource: ResourceRecord): boolean {
  return resource.categories.includes("interaction");
}

export function resourceSupportsAnnotations(resource: ResourceRecord): boolean {
  return resource.categories.includes("annotation");
}

export function resourceSupportsOntology(resource: ResourceRecord): boolean {
  return (resource.ontology_term_count || 0) > 0;
}
