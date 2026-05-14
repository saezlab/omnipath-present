import { getPool } from "$lib/server/db/client";
import { getEntityByPublicId } from "$lib/server/queries/entity";

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "minimal";

type EntityAnnotationRow = {
  term: string;
  value: string | null;
  unit: string | null;
  scope: string;
  source: string | null;
};

export async function getEntityDetails(publicId: string) {
  const entity = await getEntityByPublicId(publicId);
  if (!entity) return null;

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const interactionCountResult = await client.query<{ count: string }>(
      `SELECT count(*) AS count
       FROM ${schema}.relation r
       WHERE r.relation_category = 'interaction'
         AND r.subject_entity_id = $1`,
      [entity.entityPk],
    );
    const annotationResult = await client.query<{ relation_pk: string | number; predicate: string }>(
      `SELECT r.relation_id AS relation_pk, r.predicate
       FROM ${schema}.relation r
       WHERE r.relation_category = 'association'
         AND r.subject_entity_id = $1
       ORDER BY r.relation_id
       LIMIT 100`,
      [entity.entityPk],
    );
    const attributeResult = await client.query<EntityAnnotationRow>(
      `SELECT DISTINCT a.term, a.value, a.unit, a.scope, ee.source
       FROM ${schema}.annotation a
       LEFT JOIN ${schema}.entity_evidence_resolution eer ON eer.entity_evidence_id = a.entity_evidence_id
       LEFT JOIN ${schema}.entity_evidence ee ON ee.entity_evidence_id = a.entity_evidence_id
       WHERE a.entity_id = $1 OR eer.entity_id = $1
       ORDER BY a.term, a.value NULLS LAST, ee.source NULLS LAST
       LIMIT 500`,
      [entity.entityPk],
    );
    const attributes = attributeResult.rows.map((row) => ({
      term: row.term,
      value: row.value,
      unit: row.unit,
      scope: row.scope,
      source: row.source,
    }));
    const taxonomyId = entity.taxonomyId
      || attributes.find((attribute) => attribute.term.toLowerCase().includes("ncbi tax id") && attribute.value)?.value
      || entity.taxonomyId;

    return {
      entity: {
        ...entity,
        taxonomyId,
        entityAttributes: attributes,
      },
      summary: {
        interactionCount: Number(interactionCountResult.rows[0]?.count || 0),
      },
      annotations: annotationResult.rows.map((row) => ({
        relationPk: Number(row.relation_pk),
        predicate: row.predicate,
      })),
    };
  } finally {
    client.release();
  }
}
