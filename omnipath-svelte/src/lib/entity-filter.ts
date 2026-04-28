/**
 * Entity type labels whose records are organism-scoped in the browser.
 *
 * The Explore page has a global species picker. Some entity types, such as CV
 * terms, foods, lipids, and small molecules, are universal/non-organism-specific
 * and often have NULL taxonomy_id. Applying the species filter to those types
 * makes their entity-type filter appear broken. Keep the species filter strict
 * for organism-scoped biology types, but allow universal types through when the
 * user explicitly filters by entity type.
 */
export const taxonomyScopedEntityTypeLabels = [
  "complex",
  "interaction",
  "phenotype",
  "physical entity",
  "protein",
  "protein family",
  "rna",
  "stimulus",
] as const;

export function entityTypeLabelSqlExpression(column: string): string {
  return `LOWER(split_part(${column}, ':', 3))`;
}
