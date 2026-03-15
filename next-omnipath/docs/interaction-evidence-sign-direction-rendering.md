# Interaction evidence sign/direction rendering

## Current UI solution

The interaction details view currently aggregates evidence in the frontend by inferred `sign + direction` combinations instead of rendering each evidence item separately.

Implementation location:
- `next-omnipath/src/features/interactions-search/components/interaction-details.tsx`

Current behavior:
- Evidence is grouped by inferred `direction` (`a-b`, `b-a`, or fallback) and `sign` (`activation`, `inhibition`, `mixed` when both are present for the same inferred direction).
- PubMed annotations such as `pubmed: 10949026` are extracted out of normal annotation chips and rendered in a dedicated PubMed section.
- Source, interaction, and target annotations are deduplicated within each aggregated group.

## Why inference is needed in the frontend

The Meilisearch interaction documents currently contain two separate representations:

1. `evidence[]`
   - includes:
     - `evidence_serial`
     - `source`
     - `interaction_annotations`
     - `member_a_annotations`
     - `member_b_annotations`
   - does **not** include evidence-level `direction` or `sign`

2. `directions[]`
   - contains pair-level aggregated summaries like:
     - `{ direction: "a-b", sign: 1 }`
     - `{ direction: "a-b", sign: 0 }`
   - this is computed in the build pipeline, not attached to individual evidence rows

Because evidence records are unlabeled with respect to sign/direction, the frontend has to infer grouping from the available annotations.

## Backend logic we mirrored

The relevant pipeline is:
- `../omnipath_build/omnipath_build/search_builder/build_search_interactions.py`

Important parts of the backend logic:
- Member annotations can imply:
  - source role
  - target role
  - positive sign
  - negative sign
- Interaction parameter annotations can imply:
  - direction for small molecule → protein interactions
  - positive/negative sign from parameter type
- Direction/sign are then collapsed at the pair level:
  - positive only → `1`
  - negative only → `-1`
  - both positive and negative for the same direction → `0` (`mixed`)

The frontend now mirrors this logic approximately using the same accession sets.

## Frontend inference rules

The current frontend implementation:
- uses accession sets copied from the build pipeline for:
  - positive sign accessions
  - negative sign accessions
  - source-role accessions
  - target-role accessions
  - activatory parameter accessions
  - inhibitory parameter accessions
- parses annotation accessions from `term` values like `label:MI:0840`
- infers:
  - `a-b` if member A has a source role or member B has a target role
  - `b-a` if member B has a source role or member A has a target role
- infers sign from matching positive/negative annotation accessions
- infers small molecule → protein direction for activatory/inhibitory parameter annotations
- falls back to the precomputed `selectedInteraction.directions` when individual evidence annotations do not allow inference

## Known limitations of the current approach

This is a pragmatic UI-side solution, but not the cleanest architecture.

### 1. Duplicated business logic
The sign/direction rules now exist in both:
- backend build pipeline
- frontend component code

This is fragile because the two can drift over time.

### 2. Inference happens after aggregation
The frontend only sees the already-built evidence payload, not the raw backend tables.
That means some edge cases may not be reconstructed exactly the same way as in the build pipeline.

### 3. Evidence rows still do not carry explicit sign/direction
Even with frontend inference, the UI is still deriving labels rather than reading authoritative evidence-level values.

### 4. Mixed sign semantics are pair/direction-level
In the backend, `mixed` is synthesized when both positive and negative support exist for the same direction.
It is not necessarily a raw evidence-level property.
This can make presentation ambiguous if users expect each evidence entry to have a direct sign label.

## Cleaner long-term solution

The preferred solution is to move this responsibility fully into the backend search document.

### Recommended change
When building `evidence[]` in `build_search_interactions.py`, attach inferred fields to each evidence entry:
- `direction`
- `sign`
- optionally `pubmed_ids`

Example target shape:

```ts
{
  evidence_serial: 1,
  source: "SIGNOR:OM:1152",
  direction: "a-b",
  sign: 1,
  pubmed_ids: ["10949026"],
  interaction_annotations: [...],
  member_a_annotations: [...],
  member_b_annotations: [...]
}
```

### Benefits
- frontend becomes simple and deterministic
- no duplication of sign/direction inference rules
- aggregation in the UI becomes a pure presentation concern
- PubMed extraction can also become cleaner and consistent
- easier debugging: users and developers can inspect exactly why an evidence item lands in a given bucket

## Alternative intermediate improvements

If changing the evidence schema immediately is too disruptive, we could instead:

### Option A: add a pre-aggregated evidence summary field
Have the backend emit a field like:
- `evidence_groups[]`

Where each group already contains:
- direction
- sign
- sources
- pubmed_ids
- aggregated source/interaction/target annotations

This makes the frontend trivial, but reduces flexibility.

### Option B: share inference metadata centrally
Move the accession sets and inference rules into a shared machine-readable artifact so both backend and frontend can consume the same definitions.

This is better than copy/paste, but still inferior to carrying explicit evidence-level sign/direction in the search document.

## Recommendation

Short term:
- keep the current frontend inference approach because it improves evidence rendering immediately

Medium term:
- update `build_search_interactions.py` to enrich each evidence item with explicit `direction`, `sign`, and ideally `pubmed_ids`

Long term:
- make the frontend render from authoritative evidence-level fields and remove the duplicated inference logic from the UI

## Related files

Frontend:
- `next-omnipath/src/features/interactions-search/components/interaction-details.tsx`

Build pipeline:
- `../omnipath_build/omnipath_build/search_builder/build_search_interactions.py`
- `../omnipath_build/omnipath_build/search_builder/schema.py`
