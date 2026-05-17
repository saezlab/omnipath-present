export function entityTypeNameSql(schema: string, alias: string): string {
  return `(SELECT et.name FROM ${schema}.vocab_entity_type et WHERE et.entity_type_id = ${alias}.entity_type_id)`;
}

export function canonicalIdentifierTypeNameSql(schema: string, alias: string): string {
  return `(SELECT it.name FROM ${schema}.vocab_identifier_type it WHERE it.identifier_type_id = ${alias}.canonical_identifier_type_id)`;
}

export function relationPredicateNameSql(schema: string, alias: string): string {
  return `(SELECT rp.name FROM ${schema}.vocab_relation_predicate rp WHERE rp.relation_predicate_id = ${alias}.predicate_id)`;
}

export function relationCategoryNameSql(schema: string, alias: string): string {
  return `(SELECT rc.name FROM ${schema}.vocab_relation_category rc WHERE rc.relation_category_id = ${alias}.relation_category_id)`;
}

export function relationCategoryEqualsSql(schema: string, alias: string, value: string): string {
  return `${relationCategoryNameSql(schema, alias)} = '${value}'`;
}

export function relationCategoryAnySql(schema: string, alias: string, placeholder: string): string {
  return `${relationCategoryNameSql(schema, alias)} = ANY(${placeholder})`;
}

