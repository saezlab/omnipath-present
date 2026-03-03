const schemas = {
  entities: [
    ["entity_id", "Int64"],
    ["entity_type", "String"],
    ["names", "List(String)"],
    ["synonyms", "List(String)"],
    ["gene_symbols", "List(String)"],
    ["descriptions", "List(String)"],
    ["references", "List(String)"],
    ["ncbi_tax_id", "String"],
    ["complexes", "List(Int64)"],
    ["pathways", "List(Int64)"],
    ["reactions", "List(Int64)"],
    ["num_interactions", "UInt32"],
    ["reactants", "List(Int64)"],
    ["products", "List(Int64)"],
    ["stoichiometry", "List(String)"],
    ["pathway_steps", "List(String)"],
    ["sources", "List(String)"],
    ["identifiers", "List(Struct{ key: String, value: String })"],
    ["cv_terms_go", "List(String)"],
    ["cv_terms_mi", "List(String)"],
    ["cv_terms_om", "List(String)"],
    ["cv_terms_hp", "List(String)"],
    ["cv_terms_kw", "List(String)"],
  ],
  interactions: [
    ["interaction_id", "Int64"],
    ["interaction_key", "String"],
    ["member_a_id", "Int64"],
    ["member_b_id", "Int64"],
    ["member_types", "List(String)"],
    ["interaction_type", "String"],
    ["evidence", "List(Struct{ evidence_serial, source, interaction_annotations, member_a_annotations, member_b_annotations })"],
    ["directions", "List(Struct{ direction: String, sign: Int8 })"],
    ["sources", "List(String)"],
    ["interaction_annotation_terms", "List(String)"],
    ["has_direction", "Boolean"],
    ["has_positive_sign", "Boolean"],
    ["has_negative_sign", "Boolean"],
  ],
  associations: [
    ["association_id", "Int64"],
    ["association_key", "String"],
    ["parent_entity_id", "Int64"],
    ["parent_entity_type", "String"],
    ["member_entity_id", "Int64"],
    ["member_entity_type", "String"],
    ["sources", "List(String)"],
    ["evidence", "List(Struct{ evidence_serial, source, annotations })"],
    ["association_annotation_terms", "List(String)"],
  ],
}

const filters = {
  entities: [
    ["entity_ids", "number[]"],
    ["entity_types", "string[]"],
    ["sources", "string[]"],
    ["taxonomy_ids", "string[] (alias of ncbi_tax_id)"],
    ["ncbi_tax_id", "string[]"],
    ["cv_terms_go", "string[]"],
    ["cv_terms_mi", "string[]"],
    ["cv_terms_om", "string[]"],
    ["cv_terms_hp", "string[]"],
    ["cv_terms_kw", "string[]"],
    ["ontology_terms", "string[] (auto-routed by prefix GO/MI/OM/HP/KW)"],
  ],
  interactions: [
    ["entity_ids", "number[]"],
    ["member_a_id", "number"],
    ["member_b_id", "number"],
    ["interaction_types", "string[]"],
    ["direction", "'any' | 'directed' | 'undirected'"],
    ["sign", "'any' | 'positive' | 'negative' | 'mixed'"],
    ["has_direction", "boolean"],
    ["has_positive_sign", "boolean"],
    ["has_negative_sign", "boolean"],
    ["interaction_annotation_terms", "string[]"],
    ["participant_annotation_terms_go", "string[]"],
    ["participant_annotation_terms_mi", "string[]"],
    ["participant_annotation_terms_om", "string[]"],
    ["participant_annotation_terms_hp", "string[]"],
    ["participant_annotation_terms_kw", "string[]"],
    ["ontology_terms", "string[] (merged into interaction_annotation_terms)"],
    ["sources", "string[]"],
  ],
  associations: [
    ["parent_entity_ids", "number[]"],
    ["member_entity_ids", "number[]"],
    ["parent_entity_types", "string[]"],
    ["member_entity_types", "string[]"],
    ["association_annotation_terms", "string[]"],
    ["ontology_terms", "string[] (merged into association_annotation_terms)"],
    ["sources", "string[]"],
  ],
}

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
      <h1 className="text-3xl font-bold">Parquet Export Reference</h1>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Entities parquet</h2>
        <p className="text-sm text-muted-foreground font-mono">POST /api/exports/entities/parquet</p>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr><th className="px-4 py-2">Column</th><th className="px-4 py-2">Type</th></tr>
            </thead>
            <tbody>
              {schemas.entities.map(([c, t]) => (
                <tr key={c} className="border-t"><td className="px-4 py-2 font-mono text-xs">{c}</td><td className="px-4 py-2 font-mono text-xs">{t}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr><th className="px-4 py-2">Possible filters</th><th className="px-4 py-2">Type</th></tr>
            </thead>
            <tbody>
              {filters.entities.map(([f, t]) => (
                <tr key={f} className="border-t"><td className="px-4 py-2 font-mono text-xs">{f}</td><td className="px-4 py-2 text-xs">{t}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <pre className="rounded-lg border bg-muted/20 p-4 text-xs overflow-x-auto">{`curl -X POST http://localhost:8082/api/exports/entities/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "human_kinase_entities",
    "filters": {
      "taxonomy_ids": ["9606"],
      "entity_types": ["protein:MI:0326"],
      "ontology_terms": ["GO:0004672"],
      "sources": ["Reactome:OM:1151"]
    }
  }'`}</pre>

        <pre className="rounded-lg border bg-muted/20 p-4 text-xs overflow-x-auto">{`curl -X POST http://localhost:8082/api/exports/entities/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filters": { "entity_ids": [13721, 13191] }
  }'`}</pre>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Interactions parquet</h2>
        <p className="text-sm text-muted-foreground font-mono">POST /api/exports/interactions/parquet</p>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr><th className="px-4 py-2">Column</th><th className="px-4 py-2">Type</th></tr>
            </thead>
            <tbody>
              {schemas.interactions.map(([c, t]) => (
                <tr key={c} className="border-t"><td className="px-4 py-2 font-mono text-xs">{c}</td><td className="px-4 py-2 font-mono text-xs">{t}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr><th className="px-4 py-2">Possible filters</th><th className="px-4 py-2">Type</th></tr>
            </thead>
            <tbody>
              {filters.interactions.map(([f, t]) => (
                <tr key={f} className="border-t"><td className="px-4 py-2 font-mono text-xs">{f}</td><td className="px-4 py-2 text-xs">{t}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <pre className="rounded-lg border bg-muted/20 p-4 text-xs overflow-x-auto">{`curl -X POST http://localhost:8082/api/exports/interactions/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "signor_interactions",
    "filters": {
      "sources": ["SIGNOR:OM:1152"]
    }
  }'`}</pre>

        <pre className="rounded-lg border bg-muted/20 p-4 text-xs overflow-x-auto">{`curl -X POST http://localhost:8082/api/exports/interactions/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filters": {
      "entity_ids": [13721],
      "direction": "directed",
      "sign": "positive"
    }
  }'`}</pre>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Associations parquet</h2>
        <p className="text-sm text-muted-foreground font-mono">POST /api/exports/associations/parquet</p>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr><th className="px-4 py-2">Column</th><th className="px-4 py-2">Type</th></tr>
            </thead>
            <tbody>
              {schemas.associations.map(([c, t]) => (
                <tr key={c} className="border-t"><td className="px-4 py-2 font-mono text-xs">{c}</td><td className="px-4 py-2 font-mono text-xs">{t}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr><th className="px-4 py-2">Possible filters</th><th className="px-4 py-2">Type</th></tr>
            </thead>
            <tbody>
              {filters.associations.map(([f, t]) => (
                <tr key={f} className="border-t"><td className="px-4 py-2 font-mono text-xs">{f}</td><td className="px-4 py-2 text-xs">{t}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <pre className="rounded-lg border bg-muted/20 p-4 text-xs overflow-x-auto">{`curl -X POST http://localhost:8082/api/exports/associations/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filename": "complex_protein_assoc",
    "filters": {
      "parent_entity_types": ["complex:MI:0314"],
      "member_entity_types": ["protein:MI:0326"]
    }
  }'`}</pre>

        <pre className="rounded-lg border bg-muted/20 p-4 text-xs overflow-x-auto">{`curl -X POST http://localhost:8082/api/exports/associations/parquet \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "",
    "filters": {
      "parent_entity_ids": [10091],
      "sources": ["Reactome:OM:1151"]
    }
  }'`}</pre>
      </section>
    </div>
  )
}
