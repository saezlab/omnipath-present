import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { INDEXES, meilisearchClient } from "@/lib/meilisearch/client"

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
            <th className="px-4 py-2">Example values</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([f, t]) => {
            const ex = examples?.[f]
            return (
              <tr key={f} className="border-t align-top">
                <td className="px-4 py-2 font-mono text-xs">{f}</td>
                <td className="px-4 py-2 text-xs">{t}</td>
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">API reference</h1>
      <p className="text-sm text-muted-foreground">
        Export endpoints stream Parquet files. Filters support ontology-aware keys and aliases.
      </p>

      <Tabs defaultValue="entities-export" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="entities-export">Entities export</TabsTrigger>
          <TabsTrigger value="interactions-export">Interactions export</TabsTrigger>
          <TabsTrigger value="associations-export">Associations export</TabsTrigger>
          <TabsTrigger value="entity-lookup">Entity resolving</TabsTrigger>
        </TabsList>

        <TabsContent value="entities-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/entities/parquet</h2>
          <SchemaTable rows={schemas.entities} />
          <FiltersTable rows={filters.entities} examples={facetExamples.entities} />

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

          <div className="rounded-lg border p-4 text-sm">
            <div className="font-medium">Clickable download example (GET alias for docs/testing)</div>
            <a href={entityExampleUrl} className="mt-2 block font-mono text-xs underline underline-offset-2 break-all">
              {entityExampleUrl}
            </a>
          </div>
        </TabsContent>

        <TabsContent value="interactions-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/interactions/parquet</h2>
          <SchemaTable rows={schemas.interactions} />
          <FiltersTable rows={filters.interactions} examples={facetExamples.interactions} />

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

          <div className="rounded-lg border p-4 text-sm">
            <div className="font-medium">Clickable download example (GET alias for docs/testing)</div>
            <a href={interactionExampleUrl} className="mt-2 block font-mono text-xs underline underline-offset-2 break-all">
              {interactionExampleUrl}
            </a>
          </div>
        </TabsContent>

        <TabsContent value="associations-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/associations/parquet</h2>
          <SchemaTable rows={schemas.associations} />
          <FiltersTable rows={filters.associations} examples={facetExamples.associations} />

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

          <div className="rounded-lg border p-4 text-sm">
            <div className="font-medium">Clickable download example (GET alias for docs/testing)</div>
            <a href={associationExampleUrl} className="mt-2 block font-mono text-xs underline underline-offset-2 break-all">
              {associationExampleUrl}
            </a>
          </div>
        </TabsContent>

        <TabsContent value="entity-lookup" className="space-y-4">
          <h2 className="text-xl font-semibold">Entity resolving service</h2>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="font-medium">POST /api/entity-lookup</div>
              <p className="text-xs text-muted-foreground">Resolves raw identifiers to candidate entity IDs and returns matching entity documents.</p>
            </div>
            <Code>{`curl -X POST http://localhost:8082/api/entity-lookup \\
  -H "Content-Type: application/json" \\
  -d '{
    "identifiers": ["P04637", "TP53", "Q9Y6K9"]
  }'`}</Code>
            <Code>{`{
  "matches": [
    { "identifier": "P04637", "entityIds": ["P:UNIPROT:P04637"] }
  ],
  "entities": [
    {
      "entity_id": "P:UNIPROT:P04637",
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
            <Code>{`curl -X POST http://localhost:8082/api/entity-names \\
  -H "Content-Type: application/json" \\
  -d '{ "ids": ["P:UNIPROT:P04637", "P:UNIPROT:P31749"] }'`}</Code>
            <Code>{`{
  "P:UNIPROT:P04637": "TP53",
  "P:UNIPROT:P31749": "AKT1"
}`}</Code>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
