# Ontology Filter Fixes

## Ontology Prefix Counts (MI/OM showing 0)

**Problem:** The ontology filter sidebar only showed counts for prefixes with annotation bitmaps (GO, CHEBI, HP). MI and OM terms had no entity annotation bitmaps because most MI terms annotate *relations* (not entities) and OM terms are used for *entity typing*, not annotations.

**Fix:**
1. **Inserted missing ontology terms into `entity` table:**
   - 43,009 terms were missing from `entity` (only 46,729 existed; 89,738 total in `ontology_term`).
   - Inserted as `entity_type = 'OM:0012:Cv Term'` with `canonical_identifier_type = 'OM:0204:Cv Term Accession'`.
   - Updated `sources` array to include the ontology prefix.

2. **Fixed bitmap rebuild procedures:**
   - `rebuild_annotation_term_bitmaps()` was referencing the non-existent `entity_annotation` table.
   - Updated to use `entity_relation` with `relation_category = 'annotation'`.
   - Updated `rebuild_annotation_term_relation_bitmaps()` to use `relation_annotation_term` joined with `entity`.

3. **Rebuilt all bitmaps** via `CALL rebuild_all_bitmaps()`.

4. **Updated `getScopedOntologyPrefixCounts`:**
   - **No scope** (explore page): returns total term counts per prefix from `ontology_term` table.
   - **With scope** (selection annotation tab): returns scoped annotation counts as before.

**Result:** MI (1,653) and OM (321) now appear in the explore page filter sidebar with correct counts.

**Files changed:**
- `omnipath-svelte/src/lib/server/queries/ontology-term.ts`

---

## Next Step

Review `omnipath_build` build process to align ontology term handling — ensure all ontology terms are inserted into `entity` during build, and that the `sources` field is populated with the ontology prefix.

We should also connect make connect sources as a foreign key to the resources table, maybe we could use the resource name here as a key? and then in the resources we should have a special kind for ontology resources? so we give ontology sources a different icon/emoji in the ui. i guess we also need input modules for ontologies then, but these can be quite minimalistic since we only need to download and parse obo files, which are very standardized. 