import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { INDEXES, meilisearchClient } from "@/lib/meilisearch/client"
import { ExportTryNow, JsonTryNow } from "./try-now"

export const dynamic = "force-dynamic"

type Row = [string, string, string]

type FilterRow = [string, string, string]

const schemas: Record<string, Row[]> = {
  entities: [
    ["entity_id", "String", "P:UNIPROT:P04637"],
    ["entity_type", "String", "protein:MI:0326"],
    ["descriptions", "List(String)", "[\"Cellular tumor antigen p53\"]"],
    ["ncbi_tax_id", "String", "9606"],
    ["sources", "List(String)", "[\"Reactome:OM:1151\"]"],
    ["identifiers", "List(Struct{ key: String, value: String })", "[{ key: \"uniprot\", value: \"P04637\" }]"],
    ["num_interactions", "UInt32", "1758"],
    ["cv_terms_go", "List(String)", "[\"GO:0003677\"]"],
    ["cv_terms_mi", "List(String)", "[\"MI:0326\"]"],
    ["cv_terms_om", "List(String)", "[\"OM:0016\"]"],
    ["cv_terms_hp", "List(String)", "[\"HP:0001250\"]"],
    ["cv_terms_kw", "List(String)", "[\"KW-0464\"]"],
  ],
  interactions: [
    ["interaction_id", "Int64", "2847361"],
    ["interaction_key", "String", "P:UNIPROT:P04637|P:UNIPROT:P31749"],
    ["member_a_id", "String", "P:UNIPROT:P04637"],
    ["member_b_id", "String", "P:UNIPROT:P31749"],
    ["member_types", "List(String)", "[\"protein:MI:0326\", \"protein:MI:0326\"]"],
    ["interaction_type", "String", "protein:MI:0326|protein:MI:0326"],
    ["evidence", "List(Struct{ evidence_serial, source, interaction_annotations, member_a_annotations, member_b_annotations })", "[{ evidence_serial: 1, source: \"SIGNOR:OM:1152\", ... }]"],
    ["directions", "List(Struct{ direction: String, sign: Int8 })", "[{ direction: \"a-b\", sign: 1 }]"],
    ["sources", "List(String)", "[\"SIGNOR:OM:1152\"]"],
    ["interaction_annotation_terms", "List(String)", "[\"MI:0217\"]"],
    ["has_direction", "Boolean", "true"],
    ["has_positive_sign", "Boolean", "true"],
    ["has_negative_sign", "Boolean", "false"],
  ],
  associations: [
    ["association_id", "Int64", "948211"],
    ["association_key", "String", "complex:CPX-123|P:UNIPROT:P04637"],
    ["parent_entity_id", "String", "complex:CPX-123"],
    ["parent_entity_type", "String", "complex:MI:0314"],
    ["member_entity_id", "String", "P:UNIPROT:P04637"],
    ["member_entity_type", "String", "protein:MI:0326"],
    ["sources", "List(String)", "[\"Reactome:OM:1151\"]"],
    ["evidence", "List(Struct{ evidence_serial, source, annotations })", "[{ evidence_serial: 1, source: \"Reactome:OM:1151\", ... }]"],
    ["association_annotation_terms", "List(String)", "[\"OM:0310\"]"],
  ],
}

const filters: Record<"entities" | "interactions" | "associations", FilterRow[]> = {
  entities: [
    ["entity_ids", "string[]", "Exact IDs"],
    ["entity_types", "string[]", "Entity type terms"],
    ["sources", "string[]", "Datasource terms"],
    ["taxonomy_ids", "string[]", "NCBI taxonomy IDs"],
    ["cv_terms_go", "string[]", "GO terms"],
    ["cv_terms_mi", "string[]", "MI terms"],
    ["cv_terms_om", "string[]", "OM terms"],
    ["cv_terms_hp", "string[]", "HP terms"],
    ["cv_terms_kw", "string[]", "UniProt keyword terms"],
    ["ontology_terms", "string[]", "Auto-routed by prefix GO/MI/OM/HP/KW"],
  ],
  interactions: [
    ["entity_ids", "string[]", "Matches member_a_id OR member_b_id"],
    ["member_a_id", "string", "Either member in pair"],
    ["member_b_id", "string", "Either member in pair"],
    ["interaction_types", "string[]", "Interaction type terms"],
    ["direction", "'any' | 'directed' | 'undirected'", "Maps to has_direction"],
    ["sign", "'any' | 'positive' | 'negative' | 'mixed'", "Maps to has_positive_sign / has_negative_sign"],
    ["has_direction", "boolean", "Explicit direction flag"],
    ["has_positive_sign", "boolean", "Explicit sign helper"],
    ["has_negative_sign", "boolean", "Explicit sign helper"],
    ["interaction_annotation_terms", "string[]", "Ontology annotation terms"],
    ["participant_annotation_terms_go", "string[]", "Participant GO annotations"],
    ["participant_annotation_terms_mi", "string[]", "Participant MI annotations"],
    ["participant_annotation_terms_om", "string[]", "Participant OM annotations"],
    ["participant_annotation_terms_hp", "string[]", "Participant HP annotations"],
    ["participant_annotation_terms_kw", "string[]", "Participant KW annotations"],
    ["ontology_terms", "string[]", "Merged into interaction_annotation_terms"],
    ["sources", "string[]", "Datasource terms"],
  ],
  associations: [
    ["parent_entity_ids", "string[]", "Parent entity IDs"],
    ["member_entity_ids", "string[]", "Member entity IDs"],
    ["parent_entity_types", "string[]", "Parent type terms"],
    ["member_entity_types", "string[]", "Member type terms"],
    ["association_annotation_terms", "string[]", "Ontology annotation terms"],
    ["ontology_terms", "string[]", "Merged into association_annotation_terms"],
    ["sources", "string[]", "Datasource terms"],
  ],
}

type FacetOption = { value: string; count?: number }

function mergeFacetOptions(limit: number, ...lists: FacetOption[][]): FacetOption[] {
  const merged = new Map<string, number>()
  for (const list of lists) {
    for (const item of list) {
      merged.set(item.value, (merged.get(item.value) || 0) + (item.count || 0))
    }
  }
  return Array.from(merged.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

type FacetExamples = {
  entities: Record<string, FacetOption[]>
  interactions: Record<string, FacetOption[]>
  associations: Record<string, FacetOption[]>
}

async function getFacetExamples(indexName: string, facetName: string, limit = 10): Promise<FacetOption[]> {
  try {
    const index = meilisearchClient.index(indexName)
    const result = await index.searchForFacetValues({
      facetName,
      facetQuery: "",
      limit,
    })

    return (result.facetHits || [])
      .map((hit) => ({
        value: hit.value,
        count: hit.count,
      }))
      .sort((a, b) => (b.count || 0) - (a.count || 0))
  } catch {
    return []
  }
}

async function getIndexCount(indexName: string, filter?: string): Promise<number> {
  try {
    const index = meilisearchClient.index(indexName)
    const result = await index.search("", {
      limit: 0,
      ...(filter ? { filter } : {}),
    })
    return result.estimatedTotalHits || 0
  } catch {
    return 0
  }
}

async function getAllFacetExamples(): Promise<FacetExamples> {
  const [
    entityTypes,
    entitySources,
    entityTaxonomy,
    entityCvGo,
    entityCvMi,
    entityCvOm,
    entityCvHp,
    entityCvKw,
    interactionTypes,
    interactionSources,
    interactionAnnotationTerms,
    interactionPartGo,
    interactionPartMi,
    interactionPartOm,
    interactionPartHp,
    interactionPartKw,
    interactionHasDirection,
    interactionHasPositiveSign,
    interactionHasNegativeSign,
    interactionAnyCount,
    interactionDirectedCount,
    interactionUndirectedCount,
    interactionPositiveCount,
    interactionNegativeCount,
    interactionMixedCount,
    associationParentTypes,
    associationMemberTypes,
    associationSources,
    associationAnnotationTerms,
  ] = await Promise.all([
    getFacetExamples(INDEXES.ENTITIES, "entity_type"),
    getFacetExamples(INDEXES.ENTITIES, "sources"),
    getFacetExamples(INDEXES.ENTITIES, "ncbi_tax_id"),
    getFacetExamples(INDEXES.ENTITIES, "cv_terms_go"),
    getFacetExamples(INDEXES.ENTITIES, "cv_terms_mi"),
    getFacetExamples(INDEXES.ENTITIES, "cv_terms_om"),
    getFacetExamples(INDEXES.ENTITIES, "cv_terms_hp"),
    getFacetExamples(INDEXES.ENTITIES, "cv_terms_kw"),
    getFacetExamples(INDEXES.INTERACTIONS, "interaction_type"),
    getFacetExamples(INDEXES.INTERACTIONS, "sources"),
    getFacetExamples(INDEXES.INTERACTIONS, "interaction_annotation_terms"),
    getFacetExamples(INDEXES.INTERACTIONS, "participant_annotation_terms_go"),
    getFacetExamples(INDEXES.INTERACTIONS, "participant_annotation_terms_mi"),
    getFacetExamples(INDEXES.INTERACTIONS, "participant_annotation_terms_om"),
    getFacetExamples(INDEXES.INTERACTIONS, "participant_annotation_terms_hp"),
    getFacetExamples(INDEXES.INTERACTIONS, "participant_annotation_terms_kw"),
    getFacetExamples(INDEXES.INTERACTIONS, "has_direction"),
    getFacetExamples(INDEXES.INTERACTIONS, "has_positive_sign"),
    getFacetExamples(INDEXES.INTERACTIONS, "has_negative_sign"),
    getIndexCount(INDEXES.INTERACTIONS),
    getIndexCount(INDEXES.INTERACTIONS, "has_direction = true"),
    getIndexCount(INDEXES.INTERACTIONS, "has_direction = false"),
    getIndexCount(INDEXES.INTERACTIONS, "has_positive_sign = true AND has_negative_sign = false"),
    getIndexCount(INDEXES.INTERACTIONS, "has_positive_sign = false AND has_negative_sign = true"),
    getIndexCount(INDEXES.INTERACTIONS, "has_positive_sign = true AND has_negative_sign = true"),
    getFacetExamples(INDEXES.ASSOCIATIONS, "parent_entity_type"),
    getFacetExamples(INDEXES.ASSOCIATIONS, "member_entity_type"),
    getFacetExamples(INDEXES.ASSOCIATIONS, "sources"),
    getFacetExamples(INDEXES.ASSOCIATIONS, "association_annotation_terms"),
  ])

  return {
    entities: {
      entity_types: entityTypes,
      sources: entitySources,
      taxonomy_ids: entityTaxonomy,
      cv_terms_go: entityCvGo,
      cv_terms_mi: entityCvMi,
      cv_terms_om: entityCvOm,
      cv_terms_hp: entityCvHp,
      cv_terms_kw: entityCvKw,
      ontology_terms: mergeFacetOptions(10, entityCvGo, entityCvMi, entityCvOm, entityCvHp, entityCvKw),
    },
    interactions: {
      interaction_types: interactionTypes,
      sources: interactionSources,
      interaction_annotation_terms: interactionAnnotationTerms,
      participant_annotation_terms_go: interactionPartGo,
      participant_annotation_terms_mi: interactionPartMi,
      participant_annotation_terms_om: interactionPartOm,
      participant_annotation_terms_hp: interactionPartHp,
      participant_annotation_terms_kw: interactionPartKw,
      has_direction: interactionHasDirection,
      has_positive_sign: interactionHasPositiveSign,
      has_negative_sign: interactionHasNegativeSign,
      direction: [
        { value: "any", count: interactionAnyCount },
        { value: "directed", count: interactionDirectedCount },
        { value: "undirected", count: interactionUndirectedCount },
      ].sort((a, b) => (b.count || 0) - (a.count || 0)),
      sign: [
        { value: "any", count: interactionAnyCount },
        { value: "positive", count: interactionPositiveCount },
        { value: "negative", count: interactionNegativeCount },
        { value: "mixed", count: interactionMixedCount },
      ].sort((a, b) => (b.count || 0) - (a.count || 0)),
      ontology_terms: interactionAnnotationTerms,
    },
    associations: {
      parent_entity_types: associationParentTypes,
      member_entity_types: associationMemberTypes,
      sources: associationSources,
      association_annotation_terms: associationAnnotationTerms,
      ontology_terms: associationAnnotationTerms,
    },
  }
}

function buildDownloadUrl(path: string, filters: Record<string, unknown>, filename: string, query = "") {
  const params = new URLSearchParams({
    query,
    filename,
    filters: JSON.stringify(filters),
  })
  return `${path}?${params.toString()}`
}

function SchemaTable({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-2">Column</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Example</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([c, t, e]) => (
            <tr key={c} className="border-t align-top">
              <td className="px-4 py-2 font-mono text-xs">{c}</td>
              <td className="px-4 py-2 font-mono text-xs">{t}</td>
              <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{e}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FiltersTable({ rows, examples }: { rows: FilterRow[]; examples?: Record<string, FacetOption[]> }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-2">Filter</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Meaning</th>
            <th className="px-4 py-2">Example values</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([f, t, d]) => {
            const ex = examples?.[f]
            return (
              <tr key={f} className="border-t align-top">
                <td className="px-4 py-2 font-mono text-xs">{f}</td>
                <td className="px-4 py-2 text-xs">{t}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{d}</td>
                <td className="px-4 py-2 text-xs">
                  {ex && ex.length > 0 ? (
                    <select className="h-8 w-full max-w-md rounded-md border bg-background px-2 text-[11px] font-mono" defaultValue="">
                      <option value="" disabled>Select a value…</option>
                      {ex.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.count !== undefined ? `${option.value} (${option.count})` : option.value}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return <pre className="rounded-lg border bg-muted/20 p-4 text-xs overflow-x-auto">{children}</pre>
}

export default async function ApiDocsPage() {
  const facetExamples = await getAllFacetExamples()

  const entityExampleUrl = buildDownloadUrl(
    "/api/exports/entities/parquet",
    { taxonomy_ids: ["9606"], entity_types: ["protein:MI:0326"] },
    "human_proteins_example"
  )
  const interactionExampleUrl = buildDownloadUrl(
    "/api/exports/interactions/parquet",
    { sources: [facetExamples.interactions.sources[0]?.value || "SIGNOR:OM:1152"], direction: "directed" },
    "directed_interactions_example"
  )
  const associationExampleUrl = buildDownloadUrl(
    "/api/exports/associations/parquet",
    { parent_entity_types: [facetExamples.associations.parent_entity_types[0]?.value || "complex:MI:0314"] },
    "parent_type_associations_example"
  )

  const tutorialEntitiesUrl = buildDownloadUrl(
    "/api/exports/entities/parquet",
    {
      taxonomy_ids: ["9606"],
      entity_types: ["protein:MI:0326"],
      ontology_terms: ["GO:0005634", "HP:0001250"],
    },
    "tutorial_human_nucleus_seizure_entities"
  )
  const tutorialInteractionsUrl = buildDownloadUrl(
    "/api/exports/interactions/parquet",
    {
      entity_ids: ["P:UP:P04637:UNK", "P:UP:AKT1_HUMAN:UNK"],
      direction: "directed",
      sign: "positive",
      ontology_terms: ["MI:0217"],
    },
    "tutorial_tp53_akt1_phospho_interactions"
  )
  const tutorialAssociationsUrl = buildDownloadUrl(
    "/api/exports/associations/parquet",
    {
      member_entity_ids: ["P:UP:P04637:UNK", "P:UP:AKT1_HUMAN:UNK"],
      parent_entity_types: ["reaction:OM:0015"],
      ontology_terms: ["OM:0310"],
    },
    "tutorial_tp53_akt1_reaction_associations"
  )

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <Tabs defaultValue="quickstart-tutorial" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="quickstart-tutorial">Quickstart tutorial</TabsTrigger>
          <TabsTrigger value="entity-lookup">Entity resolving</TabsTrigger>
          <TabsTrigger value="ontology-api">Ontology API</TabsTrigger>
          <TabsTrigger value="entities-export">Entities export</TabsTrigger>
          <TabsTrigger value="interactions-export">Interactions export</TabsTrigger>
          <TabsTrigger value="associations-export">Associations export</TabsTrigger>
        </TabsList>

        <TabsContent value="ontology-api" className="space-y-4">
          <h2 className="text-xl font-semibold">Ontology API</h2>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="font-medium">POST /api/ontology/terms</div>
              <p className="text-xs text-muted-foreground">Resolve ontology term IDs to metadata (name/definition/namespace).</p>
            </div>
            <div className="text-xs font-medium">Try this</div>
            <Code>{`curl -X POST http://localhost:8082/api/ontology/terms \\
  -H "Content-Type: application/json" \\
  -d '{ "termIds": ["GO:0006915", "MI:0624", "OM:0001"] }'`}</Code>
            <JsonTryNow endpoint="/api/ontology/terms" initialBody={{ termIds: ["GO:0006915", "MI:0624", "OM:0001"] }} />
            <Code>{`{
  "terms": {
    "GO:0006915": { "id": "GO:0006915", "name": "apoptotic process" },
    "MI:0624": { "id": "MI:0624", "name": "stimulation" },
    "OM:0001": { "id": "OM:0001", "name": "interaction" }
  }
}`}</Code>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="font-medium">POST /api/ontology/tree</div>
              <p className="text-xs text-muted-foreground">Build a merged hierarchy tree for selected terms to decide whether to broaden (ancestors) or narrow (descendants) filter choices.</p>
            </div>
            <div className="text-xs font-medium">Try this</div>
            <Code>{`curl -X POST http://localhost:8082/api/ontology/tree \\
  -H "Content-Type: application/json" \\
  -d '{ "termIds": ["GO:0006915", "GO:0008219"] }'`}</Code>
            <JsonTryNow endpoint="/api/ontology/tree" initialBody={{ termIds: ["GO:0006915", "GO:0008219"] }} />
          </div>

          <div className="rounded-lg border p-4 space-y-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">How to use this before export</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Start with candidate terms from domain knowledge.</li>
              <li>Resolve labels via <span className="font-mono">/api/ontology/terms</span>.</li>
              <li>Inspect hierarchy via <span className="font-mono">/api/ontology/tree</span> and pick broader or narrower terms.</li>
              <li>Use those IDs in export filters (<span className="font-mono">ontology_terms</span> / annotation-term fields).</li>
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="quickstart-tutorial" className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 1 — Resolve identifiers to canonical entity IDs</div>
            <p className="text-xs text-muted-foreground">Requires the entity-service backend to be reachable from the frontend API.</p>
            <Code>{`curl -X POST http://localhost:8082/api/entity-lookup \\
  -H "Content-Type: application/json" \\
  -d '{ "identifiers": ["TP53", "AKT1", "P31749"] }'`}</Code>
            <JsonTryNow endpoint="/api/entity-lookup" initialBody={{ identifiers: ["TP53", "AKT1", "P31749"] }} />
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 2 — Resolve ontology terms and inspect hierarchy</div>
            <Code>{`curl -X POST http://localhost:8082/api/ontology/terms \\
  -H "Content-Type: application/json" \\
  -d '{ "termIds": ["GO:0005634", "HP:0001250", "MI:0217", "OM:0310"] }'`}</Code>
            <JsonTryNow endpoint="/api/ontology/terms" initialBody={{ termIds: ["GO:0005634", "HP:0001250", "MI:0217", "OM:0310"] }} />
            <Code>{`curl -X POST http://localhost:8082/api/ontology/tree \\
  -H "Content-Type: application/json" \\
  -d '{ "termIds": ["GO:0005634", "HP:0001250"] }'`}</Code>
            <JsonTryNow endpoint="/api/ontology/tree" initialBody={{ termIds: ["GO:0005634", "HP:0001250"] }} />
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 3 — Export entity cohort (human proteins annotated with nucleus + seizure)</div>
            <Code>{`curl -X POST http://localhost:8082/api/exports/entities/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "tutorial_human_nucleus_seizure_entities",
    "filters": {
      "taxonomy_ids": ["9606"],
      "entity_types": ["protein:MI:0326"],
      "ontology_terms": ["GO:0005634", "HP:0001250"]
    }
  }'`}</Code>
            <ExportTryNow url={tutorialEntitiesUrl} />
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 4 — Export directed positive phosphorylation interactions for TP53/AKT1</div>
            <Code>{`curl -X POST http://localhost:8082/api/exports/interactions/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "tutorial_tp53_akt1_phospho_interactions",
    "filters": {
      "entity_ids": ["P:UP:P04637:UNK", "P:UP:AKT1_HUMAN:UNK"],
      "direction": "directed",
      "sign": "positive",
      "ontology_terms": ["MI:0217"]
    }
  }'`}</Code>
            <ExportTryNow url={tutorialInteractionsUrl} />
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 5 — Export reaction associations where TP53/AKT1 act as reactants</div>
            <Code>{`curl -X POST http://localhost:8082/api/exports/associations/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "tutorial_tp53_akt1_reaction_associations",
    "filters": {
      "member_entity_ids": ["P:UP:P04637:UNK", "P:UP:AKT1_HUMAN:UNK"],
      "parent_entity_types": ["reaction:OM:0015"],
      "ontology_terms": ["OM:0310"]
    }
  }'`}</Code>
            <ExportTryNow url={tutorialAssociationsUrl} />
          </div>

          <div className="rounded-lg border p-4 text-xs text-muted-foreground">
            Discuss results by comparing <span className="font-mono">X-Export-Row-Count</span> across runs. Broaden by switching to ancestor terms in the ontology tree; narrow by choosing descendants or adding source/type/sign filters.
          </div>
        </TabsContent>

        <TabsContent value="entities-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/entities/parquet</h2>
          <Tabs defaultValue="filters" className="space-y-3">
            <TabsList>
              <TabsTrigger value="filters">Filters</TabsTrigger>
              <TabsTrigger value="response-schema">Response schema</TabsTrigger>
            </TabsList>
            <TabsContent value="filters" className="space-y-2">
              <FiltersTable rows={filters.entities} examples={facetExamples.entities} />
            </TabsContent>
            <TabsContent value="response-schema" className="space-y-2">
              <SchemaTable rows={schemas.entities} />
            </TabsContent>
          </Tabs>

          <div className="text-xs font-medium">Try this (POST)</div>
          <Code>{`curl -X POST http://localhost:8082/api/exports/entities/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "human_kinase_entities",
    "filters": {
      "taxonomy_ids": ["9606"],
      "entity_types": ["protein:MI:0326"],
      "ontology_terms": ["GO:0004672"]
    }
  }'`}</Code>

          <div className="rounded-lg border p-4 text-sm space-y-3">
            <div className="font-medium">Try this in browser (GET alias for docs/testing)</div>
            <a href={entityExampleUrl} className="block font-mono text-xs underline underline-offset-2 break-all">
              {entityExampleUrl}
            </a>
            <ExportTryNow url={entityExampleUrl} />
          </div>
        </TabsContent>

        <TabsContent value="interactions-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/interactions/parquet</h2>
          <Tabs defaultValue="filters" className="space-y-3">
            <TabsList>
              <TabsTrigger value="filters">Filters</TabsTrigger>
              <TabsTrigger value="response-schema">Response schema</TabsTrigger>
            </TabsList>
            <TabsContent value="filters" className="space-y-2">
              <FiltersTable rows={filters.interactions} examples={facetExamples.interactions} />
            </TabsContent>
            <TabsContent value="response-schema" className="space-y-2">
              <SchemaTable rows={schemas.interactions} />
            </TabsContent>
          </Tabs>

          <div className="text-xs font-medium">Try this (POST)</div>
          <Code>{`curl -X POST http://localhost:8082/api/exports/interactions/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "directed_positive_interactions",
    "filters": {
      "direction": "directed",
      "sign": "positive"
    }
  }'`}</Code>

          <div className="rounded-lg border p-4 text-sm space-y-3">
            <div className="font-medium">Try this in browser (GET alias for docs/testing)</div>
            <a href={interactionExampleUrl} className="block font-mono text-xs underline underline-offset-2 break-all">
              {interactionExampleUrl}
            </a>
            <ExportTryNow url={interactionExampleUrl} />
          </div>
        </TabsContent>

        <TabsContent value="associations-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/associations/parquet</h2>
          <Tabs defaultValue="filters" className="space-y-3">
            <TabsList>
              <TabsTrigger value="filters">Filters</TabsTrigger>
              <TabsTrigger value="response-schema">Response schema</TabsTrigger>
            </TabsList>
            <TabsContent value="filters" className="space-y-2">
              <FiltersTable rows={filters.associations} examples={facetExamples.associations} />
            </TabsContent>
            <TabsContent value="response-schema" className="space-y-2">
              <SchemaTable rows={schemas.associations} />
            </TabsContent>
          </Tabs>

          <div className="text-xs font-medium">Try this (POST)</div>
          <Code>{`curl -X POST http://localhost:8082/api/exports/associations/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "complex_member_associations",
    "filters": {
      "parent_entity_types": ["complex:MI:0314"],
      "member_entity_types": ["protein:MI:0326"]
    }
  }'`}</Code>

          <div className="rounded-lg border p-4 text-sm space-y-3">
            <div className="font-medium">Try this in browser (GET alias for docs/testing)</div>
            <a href={associationExampleUrl} className="block font-mono text-xs underline underline-offset-2 break-all">
              {associationExampleUrl}
            </a>
            <ExportTryNow url={associationExampleUrl} />
          </div>
        </TabsContent>

        <TabsContent value="entity-lookup" className="space-y-4">
          <h2 className="text-xl font-semibold">Entity resolving service</h2>
          <p className="text-xs text-muted-foreground">This endpoint proxies to entity-service; if that service is down/unreachable you will see a fetch error.</p>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="font-medium">POST /api/entity-lookup</div>
              <p className="text-xs text-muted-foreground">Resolves raw identifiers to candidate entity IDs and returns matching entity documents.</p>
            </div>
            <div className="text-xs font-medium">Try this</div>
            <Code>{`curl -X POST http://localhost:8082/api/entity-lookup \\
  -H "Content-Type: application/json" \\
  -d '{
    "identifiers": ["P04637", "TP53", "Q9Y6K9"]
  }'`}</Code>
            <JsonTryNow endpoint="/api/entity-lookup" initialBody={{ identifiers: ["P04637", "TP53", "Q9Y6K9"] }} />
            <Code>{`{
  "matches": [
    { "identifier": "P04637", "entityIds": ["P:UP:P04637:UNK"] }
  ],
  "entities": [
    {
      "entity_id": "P:UP:P04637:UNK",
      "entity_type": "protein:MI:0326",
      "names": ["Cellular tumor antigen p53"],
      "gene_symbols": ["TP53"]
    }
  ]
}`}</Code>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="font-medium">POST /api/entity-names</div>
              <p className="text-xs text-muted-foreground">Helper endpoint: resolve entity IDs to display names.</p>
            </div>
            <div className="text-xs font-medium">Try this</div>
            <Code>{`curl -X POST http://localhost:8082/api/entity-names \\
  -H "Content-Type: application/json" \\
  -d '{ "ids": ["P:UP:P04637:UNK", "P:UP:AKT1_HUMAN:UNK"] }'`}</Code>
            <JsonTryNow endpoint="/api/entity-names" initialBody={{ ids: ["P:UP:P04637:UNK", "P:UP:AKT1_HUMAN:UNK"] }} />
            <Code>{`{
  "P:UP:P04637:UNK": "Cellular tumor antigen p53",
  "P:UP:AKT1_HUMAN:UNK": "3-phosphoinositide-dependent protein kinase 1"
}`}</Code>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
