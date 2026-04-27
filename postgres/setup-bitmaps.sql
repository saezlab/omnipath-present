-- Run this after starting the Postgres container (or mount into /docker-entrypoint-initdb.d/ for fresh databases).

CREATE EXTENSION IF NOT EXISTS roaringbitmap;

-- Bitmap index: per annotation term, the set of annotated entity PKs as a compressed bitmap.
-- If entity_pk exceeds the 32-bit signed-integer range, build an ordinal mapping first
-- and store ordinals instead of raw entity_pk values.
CREATE TABLE IF NOT EXISTS annotation_term_entity_bitmap (
  term_entity_pk bigint PRIMARY KEY,
  entity_bitmap roaringbitmap NOT NULL,
  global_count integer NOT NULL
);

-- Bitmap index: per annotation term, the set of relation PKs where either endpoint
-- is annotated with that term. Enables instant scoped relation facet counts.
CREATE TABLE IF NOT EXISTS annotation_term_relation_bitmap (
  term_entity_pk bigint PRIMARY KEY,
  relation_bitmap roaringbitmap NOT NULL,
  global_count integer NOT NULL
);

-- Generic facet bitmaps for entity-level facets (entity_type, source, taxonomy_id).
CREATE TABLE IF NOT EXISTS facet_entity_bitmap (
  facet_name text NOT NULL,
  facet_value text NOT NULL,
  entity_bitmap roaringbitmap NOT NULL,
  entity_count integer NOT NULL,
  PRIMARY KEY (facet_name, facet_value)
);

-- Generic facet bitmaps for relation-level facets (predicate, participant_type, source).
CREATE TABLE IF NOT EXISTS facet_relation_bitmap (
  facet_name text NOT NULL,
  facet_value text NOT NULL,
  facet_category text,
  relation_bitmap roaringbitmap NOT NULL,
  relation_count integer NOT NULL,
  PRIMARY KEY (facet_name, facet_value)
);

-- Rebuild annotation-term → entity bitmaps from the entity_annotation snapshot.
CREATE OR REPLACE PROCEDURE rebuild_annotation_term_bitmaps()
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE annotation_term_entity_bitmap;

  INSERT INTO annotation_term_entity_bitmap (term_entity_pk, entity_bitmap, global_count)
  SELECT
    term_entity_pk,
    rb_build_agg(entity_pk::integer),
    COUNT(*)::integer
  FROM entity_annotation
  GROUP BY term_entity_pk;

  COMMIT;
END;
$$;

-- Rebuild annotation-term → relation bitmaps.
-- For each term, finds all relations where either subject or object entity
-- is annotated with that term.
CREATE OR REPLACE PROCEDURE rebuild_annotation_term_relation_bitmaps()
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE annotation_term_relation_bitmap;

  INSERT INTO annotation_term_relation_bitmap (term_entity_pk, relation_bitmap, global_count)
  SELECT
    ea.term_entity_pk,
    rb_build_agg(DISTINCT er.relation_pk::integer),
    COUNT(DISTINCT er.relation_pk)::integer
  FROM entity_annotation ea
  JOIN entity_relation er ON er.subject_entity_pk = ea.entity_pk OR er.object_entity_pk = ea.entity_pk
  GROUP BY ea.term_entity_pk;

  COMMIT;
END;
$$;

-- Rebuild entity facet bitmaps from the entity table.
CREATE OR REPLACE PROCEDURE rebuild_entity_facet_bitmaps()
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE facet_entity_bitmap;

  -- entity_type
  INSERT INTO facet_entity_bitmap (facet_name, facet_value, entity_bitmap, entity_count)
  SELECT 'entity_type', entity_type, rb_build_agg(entity_pk::integer), COUNT(*)::integer
  FROM entity
  WHERE entity_type IS NOT NULL
  GROUP BY entity_type;

  -- sources (unnest array)
  INSERT INTO facet_entity_bitmap (facet_name, facet_value, entity_bitmap, entity_count)
  SELECT 'source', source.value, rb_build_agg(entity_pk::integer), COUNT(*)::integer
  FROM entity e
  CROSS JOIN LATERAL unnest(e.sources) AS source(value)
  WHERE source.value <> ''
  GROUP BY source.value;

  COMMIT;
END;
$$;

-- Rebuild relation facet bitmaps from the entity_relation table.
CREATE OR REPLACE PROCEDURE rebuild_relation_facet_bitmaps()
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE facet_relation_bitmap;

  -- predicate (with category)
  INSERT INTO facet_relation_bitmap (facet_name, facet_value, facet_category, relation_bitmap, relation_count)
  SELECT 'predicate', predicate, relation_category, rb_build_agg(relation_pk::integer), COUNT(*)::integer
  FROM entity_relation
  GROUP BY predicate, relation_category;

  -- participant_types (unnest array)
  INSERT INTO facet_relation_bitmap (facet_name, facet_value, relation_bitmap, relation_count)
  SELECT 'participant_type', pt.value, rb_build_agg(relation_pk::integer), COUNT(*)::integer
  FROM entity_relation r
  CROSS JOIN LATERAL unnest(r.participant_types) AS pt(value)
  WHERE pt.value <> ''
  GROUP BY pt.value;

  -- sources (unnest array)
  INSERT INTO facet_relation_bitmap (facet_name, facet_value, relation_bitmap, relation_count)
  SELECT 'source', source.value, rb_build_agg(relation_pk::integer), COUNT(*)::integer
  FROM entity_relation r
  CROSS JOIN LATERAL unnest(r.sources) AS source(value)
  WHERE source.value <> ''
  GROUP BY source.value;

  COMMIT;
END;
$$;

-- Convenience: rebuild all bitmap tables at once.
CREATE OR REPLACE PROCEDURE rebuild_all_bitmaps()
LANGUAGE plpgsql
AS $$
BEGIN
  CALL rebuild_annotation_term_bitmaps();
  CALL rebuild_annotation_term_relation_bitmaps();
  CALL rebuild_entity_facet_bitmaps();
  CALL rebuild_relation_facet_bitmaps();
END;
$$;
