import type { MeilisearchFilters } from "@/types/meilisearch";

export function buildEntityFilterString(filters: MeilisearchFilters): string {
  const filterParts: string[] = [];

  if (filters.entity_ids?.length) {
    const ids = filters.entity_ids.map((id) => `"${id}"`).join(", ");
    filterParts.push(`entity_id IN [${ids}]`);
  }

  if (filters.entity_types?.length) {
    const entityTypeFilters = filters.entity_types.map(type => `entity_type = "${type}"`).join(" OR ");
    filterParts.push(`(${entityTypeFilters})`);
  }

  if (filters.sources?.length) {
    const sourceFilters = filters.sources.map(source => `sources = "${source}"`).join(" OR ");
    filterParts.push(`(${sourceFilters})`);
  }

  if (filters.ncbi_tax_id?.length) {
    const taxIdFilters = filters.ncbi_tax_id.map(taxId => `ncbi_tax_id = "${taxId}"`).join(" OR ");
    filterParts.push(`(${taxIdFilters} OR ncbi_tax_id IS NULL)`);
  }

  if (filters.cv_terms_go?.length) {
    const cvTermFilters = filters.cv_terms_go.map(term => `cv_terms_go = "${term}"`).join(" OR ");
    filterParts.push(`(${cvTermFilters})`);
  }
  if (filters.cv_terms_mi?.length) {
    const cvTermFilters = filters.cv_terms_mi.map(term => `cv_terms_mi = "${term}"`).join(" OR ");
    filterParts.push(`(${cvTermFilters})`);
  }
  if (filters.cv_terms_om?.length) {
    const cvTermFilters = filters.cv_terms_om.map(term => `cv_terms_om = "${term}"`).join(" OR ");
    filterParts.push(`(${cvTermFilters})`);
  }
  if (filters.cv_terms_hp?.length) {
    const cvTermFilters = filters.cv_terms_hp.map(term => `cv_terms_hp = "${term}"`).join(" OR ");
    filterParts.push(`(${cvTermFilters})`);
  }
  if (filters.cv_terms_kw?.length) {
    const cvTermFilters = filters.cv_terms_kw.map(term => `cv_terms_kw = "${term}"`).join(" OR ");
    filterParts.push(`(${cvTermFilters})`);
  }

  return filterParts.join(" AND ");
}

export function buildInteractionFilterString(filters: MeilisearchFilters): string {
  const filterParts: string[] = [];

  if (filters.entity_ids?.length) {
    const entityFilters = filters.entity_ids
      .map((id) => `(member_a_id = "${id}" OR member_b_id = "${id}")`)
      .join(" OR ");
    filterParts.push(`(${entityFilters})`);
  }

  if (filters.member_a_id !== undefined) {
    filterParts.push(`(member_a_id = "${filters.member_a_id}" OR member_b_id = "${filters.member_a_id}")`);
  }

  if (filters.member_b_id !== undefined) {
    filterParts.push(`(member_a_id = "${filters.member_b_id}" OR member_b_id = "${filters.member_b_id}")`);
  }

  if (filters.interaction_types?.length) {
    const typeFilters = filters.interaction_types.map((type) => `interaction_type = "${type}"`).join(" OR ");
    filterParts.push(`(${typeFilters})`);
  }

  if (filters.is_directed !== undefined && filters.is_directed !== null) {
    filterParts.push(`is_directed = ${filters.is_directed}`);
  }

  if (filters.signs?.length) {
    const signFilters = filters.signs.map((sign) => `sign = ${sign}`).join(" OR ");
    filterParts.push(`(${signFilters})`);
  }

  if (filters.interaction_annotation_terms?.length) {
    const termFilters = filters.interaction_annotation_terms
      .map((term) => `interaction_annotation_terms = "${term}"`)
      .join(" OR ");
    filterParts.push(`(${termFilters})`);
  }

  const participantFilterKeys: Array<keyof MeilisearchFilters> = [
    "participant_annotation_terms_go",
    "participant_annotation_terms_mi",
    "participant_annotation_terms_om",
    "participant_annotation_terms_hp",
    "participant_annotation_terms_kw",
  ];

  participantFilterKeys.forEach((key) => {
    const values = filters[key] as string[] | undefined;
    if (!values?.length) return;
    const termFilters = values.map((term) => `${key} = "${term}"`).join(" OR ");
    filterParts.push(`(${termFilters})`);
  });

  if (filters.sources?.length) {
    const sourceFilters = filters.sources.map((source) => `sources = "${source}"`).join(" OR ");
    filterParts.push(`(${sourceFilters})`);
  }

  return filterParts.join(" AND ");
}

export function buildSourceFilterString(filters: MeilisearchFilters): string {
  const filterParts: string[] = [];

  if (filters.sources?.length) {
    const sourceFilters = filters.sources.map((source) => `source = "${source}"`).join(" OR ");
    filterParts.push(`(${sourceFilters})`);
  }

  if (filters.license_cv?.length) {
    const licenseFilters = filters.license_cv.map((license) => `license_cv = "${license}"`).join(" OR ");
    filterParts.push(`(${licenseFilters})`);
  }

  if (filters.update_category_cv?.length) {
    const updateCategoryFilters = filters.update_category_cv
      .map((category) => `update_category_cv = "${category}"`)
      .join(" OR ");
    filterParts.push(`(${updateCategoryFilters})`);
  }

  if (filters.content_category_cv_terms?.length) {
    const contentCategoryFilters = filters.content_category_cv_terms
      .map((term) => `content_category_cv_terms = "${term}"`)
      .join(" OR ");
    filterParts.push(`(${contentCategoryFilters})`);
  }

  return filterParts.join(" AND ");
}
