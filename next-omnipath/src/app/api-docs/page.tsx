import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getSiteUrl } from "@/lib/api/config"
import { headers } from "next/headers"
import { ExportTryNow, JsonTryNow } from "./try-now"
import { loadFacetDistributionFromMaterializedView } from "@/lib/postgres-search/search"

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
    ["ontology_terms", "List(String)", "[\"GO:0003677\", \"HP:0001250\", \"CHEBI:15377\"]"],
  ],
  interactions: [
    ["interaction_id", "Int64", "2847361"],
    ["interaction_key", "String", "P:UP:P04637:UNK-P:UP:P31749:UNK|d|1"],
    ["member_a_id", "String", "P:UP:P04637:UNK"],
    ["member_b_id", "String", "P:UP:P31749:UNK"],
    ["member_types", "List(String)", "[\"protein:MI:0326\", \"protein:MI:0326\"]"],
    ["interaction_type", "String", "protein:MI:0326|protein:MI:0326"],
    ["is_directed", "Boolean", "true"],
    ["sign", "Int8", "1"],
    ["evidence", "List(Struct{ evidence_serial, source, interaction_annotations, member_a_annotations, member_b_annotations })", "[{ evidence_serial: 1, source: \"SIGNOR:OM:1152\", ... }]"],
    ["evidence_count", "Int64", "3"],
    ["sources", "List(String)", "[\"SIGNOR:OM:1152\"]"],
    ["interaction_annotation_terms", "List(String)", "[\"MI:0217\"]"],
    ["participant_annotation_terms", "List(String)", "[\"GO:0004672\", \"MI:0326\", \"CHEBI:15377\"]"],
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
    ["ontology_terms", "string[]", "Canonical ontology IDs across all loaded ontologies (GO/MI/OM/HP/KW/CHEBI/...)"],
  ],
  interactions: [
    ["entity_ids", "string[]", "Matches member_a_id OR member_b_id"],
    ["member_a_id", "string", "Matches either member in pair"],
    ["member_b_id", "string", "Matches either member in pair"],
    ["interaction_types", "string[]", "Interaction type terms"],
    ["direction", '"any" | "directed" | "undirected"', "Directedness filter"],
    ["sign", '"any" | "positive" | "negative" | "mixed"', "Interaction sign filter"],
    ["interaction_annotation_terms", "string[]", "Ontology annotation terms on the interaction itself"],
    ["participant_annotation_terms", "string[]", "Ontology annotation terms aggregated from interaction participants"],
    ["ontology_terms", "string[]", "Alias merged into interaction_annotation_terms"],
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

type FacetExamples = {
  entities: Record<string, FacetOption[]>
  interactions: Record<string, FacetOption[]>
  associations: Record<string, FacetOption[]>
}

function facetMapToOptions(
  distribution: Record<string, Record<string, number>>,
  facetName: string,
  limit = 10,
): FacetOption[] {
  return Object.entries(distribution[facetName] || {})
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, limit)
}

async function getAllFacetExamples(): Promise<FacetExamples> {
  const [entityFacets, interactionFacets] = await Promise.all([
    loadFacetDistributionFromMaterializedView("entity_filter_counts"),
    loadFacetDistributionFromMaterializedView("interaction_filter_counts"),
  ])

  const interactionTypes = facetMapToOptions(interactionFacets, "interaction_type")
  const interactionAnnotationTerms = facetMapToOptions(interactionFacets, "interaction_annotation_terms")

  return {
    entities: {
      entity_types: facetMapToOptions(entityFacets, "entity_type"),
      sources: facetMapToOptions(entityFacets, "sources"),
      taxonomy_ids: facetMapToOptions(entityFacets, "ncbi_tax_id"),
      ontology_terms: facetMapToOptions(entityFacets, "ontology_terms"),
    },
    interactions: {
      interaction_types: interactionTypes,
      sources: facetMapToOptions(interactionFacets, "sources"),
      interaction_annotation_terms: interactionAnnotationTerms,
      participant_annotation_terms: facetMapToOptions(interactionFacets, "participant_annotation_terms"),
      direction: [
        { value: "any" },
        { value: "directed" },
        { value: "undirected" },
      ],
      sign: [
        { value: "any" },
        { value: "positive" },
        { value: "negative" },
        { value: "mixed" },
      ],
      ontology_terms: interactionAnnotationTerms,
    },
    associations: {
      parent_entity_types: [],
      member_entity_types: [],
      sources: [],
      association_annotation_terms: [],
      ontology_terms: [],
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

  const requestHeaders = await headers()
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]
  const host = requestHeaders.get("host")
  const resolvedHost = forwardedHost || host
  const protocol = forwardedProto || (resolvedHost?.includes("localhost") ? "http" : "https")
  const baseUrl = resolvedHost ? `${protocol}://${resolvedHost}` : getSiteUrl()

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
              <div className="font-medium">POST /api/terms</div>
              <p className="text-xs text-muted-foreground">Resolve ontology term IDs to metadata (name/definition/namespace).</p>
            </div>
            <div className="text-xs font-medium">Try this</div>
            <Code>{`curl -X POST ${baseUrl}/api/terms \\
  -H "Content-Type: application/json" \\
  -d '{ "term_ids": ["GO:0006915", "MI:0624", "OM:0001"] }'`}</Code>
            <JsonTryNow endpoint="/api/terms" initialBody={{ term_ids: ["GO:0006915", "MI:0624", "OM:0001"] }} />
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
              <div className="font-medium">POST /api/tree</div>
              <p className="text-xs text-muted-foreground">Build a merged hierarchy tree for selected terms to decide whether to broaden (ancestors) or narrow (descendants) filter choices.</p>
            </div>
            <div className="text-xs font-medium">Try this</div>
            <Code>{`curl -X POST ${baseUrl}/api/tree \\
  -H "Content-Type: application/json" \\
  -d '{ "term_ids": ["GO:0006915", "GO:0008219"] }'`}</Code>
            <JsonTryNow endpoint="/api/tree" initialBody={{ term_ids: ["GO:0006915", "GO:0008219"] }} />
          </div>

          <div className="rounded-lg border p-4 space-y-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">How to use this before export</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Start with candidate terms from domain knowledge.</li>
              <li>Resolve labels via <span className="font-mono">/api/terms</span>.</li>
              <li>Inspect hierarchy via <span className="font-mono">/api/tree</span> and pick broader or narrower terms.</li>
              <li>Use those IDs in export filters (<span className="font-mono">ontology_terms</span> / annotation-term fields).</li>
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="quickstart-tutorial" className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 1 — Resolve identifiers to canonical entity IDs</div>
            <p className="text-xs text-muted-foreground">Uses the main FastAPI service so the endpoint is part of the public API and OpenAPI schema.</p>
            <Code>{`curl -X POST ${baseUrl}/api/entity-lookup \\
  -H "Content-Type: application/json" \\
  -d '{ "identifiers": ["TP53", "AKT1", "P31749"] }'`}</Code>
            <JsonTryNow endpoint="/api/entity-lookup" initialBody={{ identifiers: ["TP53", "AKT1", "P31749"] }} />
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 2 — Resolve ontology terms and inspect hierarchy</div>
            <Code>{`curl -X POST ${baseUrl}/api/terms \\
  -H "Content-Type: application/json" \\
  -d '{ "term_ids": ["GO:0005634", "HP:0001250", "MI:0217", "OM:0310"] }'`}</Code>
            <JsonTryNow endpoint="/api/terms" initialBody={{ term_ids: ["GO:0005634", "HP:0001250", "MI:0217", "OM:0310"] }} />
            <Code>{`curl -X POST ${baseUrl}/api/tree \\
  -H "Content-Type: application/json" \\
  -d '{ "term_ids": ["GO:0005634", "HP:0001250"] }'`}</Code>
            <JsonTryNow endpoint="/api/tree" initialBody={{ term_ids: ["GO:0005634", "HP:0001250"] }} />
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="font-medium">Step 3 — Export entity cohort (human proteins annotated with nucleus + seizure)</div>
            <Code>{`curl -X POST ${baseUrl}/api/exports/entities/parquet \\
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
            <Code>{`curl -X POST ${baseUrl}/api/exports/interactions/parquet \\
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
            <Code>{`curl -X POST ${baseUrl}/api/exports/associations/parquet \\
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
        </TabsContent>

        <TabsContent value="entities-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/entities/parquet</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Filters</div>
              <div className="max-h-[34rem] overflow-auto">
                <FiltersTable rows={filters.entities} examples={facetExamples.entities} />
              </div>
            </div>
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Response schema</div>
              <div className="max-h-[34rem] overflow-auto">
                <SchemaTable rows={schemas.entities} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-medium">Try this (POST)</div>
              <Code>{`curl -X POST ${baseUrl}/api/exports/entities/parquet \\
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
            </div>

            <div className="rounded-xl border bg-card/60 p-4 text-sm space-y-3">
              <div className="font-medium">Try this in browser (GET alias for docs/testing)</div>
              <a href={entityExampleUrl} className="block font-mono text-xs underline underline-offset-2 break-all">
                {entityExampleUrl}
              </a>
              <ExportTryNow url={entityExampleUrl} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="interactions-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/interactions/parquet</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Filters</div>
              <div className="max-h-[34rem] overflow-auto">
                <FiltersTable rows={filters.interactions} examples={facetExamples.interactions} />
              </div>
            </div>
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Response schema</div>
              <div className="max-h-[34rem] overflow-auto">
                <SchemaTable rows={schemas.interactions} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-medium">Try this (POST)</div>
              <Code>{`curl -X POST ${baseUrl}/api/exports/interactions/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "directed_positive_interactions",
    "filters": {
      "direction": "directed",
      "sign": "positive"
    }
  }'`}</Code>
            </div>

            <div className="rounded-xl border bg-card/60 p-4 text-sm space-y-3">
              <div className="font-medium">Try this in browser (GET alias for docs/testing)</div>
              <a href={interactionExampleUrl} className="block font-mono text-xs underline underline-offset-2 break-all">
                {interactionExampleUrl}
              </a>
              <ExportTryNow url={interactionExampleUrl} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="associations-export" className="space-y-4">
          <h2 className="text-xl font-semibold">POST /api/exports/associations/parquet</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Filters</div>
              <div className="max-h-[34rem] overflow-auto">
                <FiltersTable rows={filters.associations} examples={facetExamples.associations} />
              </div>
            </div>
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Response schema</div>
              <div className="max-h-[34rem] overflow-auto">
                <SchemaTable rows={schemas.associations} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="rounded-xl border bg-card/60 p-4 space-y-3">
              <div className="text-xs font-medium">Try this (POST)</div>
              <Code>{`curl -X POST ${baseUrl}/api/exports/associations/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "complex_member_associations",
    "filters": {
      "parent_entity_types": ["complex:MI:0314"],
      "member_entity_types": ["protein:MI:0326"]
    }
  }'`}</Code>
            </div>

            <div className="rounded-xl border bg-card/60 p-4 text-sm space-y-3">
              <div className="font-medium">Try this in browser (GET alias for docs/testing)</div>
              <a href={associationExampleUrl} className="block font-mono text-xs underline underline-offset-2 break-all">
                {associationExampleUrl}
              </a>
              <ExportTryNow url={associationExampleUrl} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="entity-lookup" className="space-y-4">
          <h2 className="text-xl font-semibold">Entity resolving service</h2>
          <p className="text-xs text-muted-foreground">This endpoint is served by the main FastAPI app and internally resolves identifiers via the entity resolver service.</p>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <div className="font-medium">POST /api/entity-lookup</div>
              <p className="text-xs text-muted-foreground">Resolves raw identifiers to candidate entity IDs and returns matching entity documents.</p>
            </div>
            <div className="text-xs font-medium">Try this</div>
            <Code>{`curl -X POST ${baseUrl}/api/entity-lookup \\
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

        </TabsContent>
      </Tabs>
    </div>
  )
}
