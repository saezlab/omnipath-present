# Frontend migration remaining TODOs

## Completed in this session

- removed legacy `EntitySearchResult`
- introduced `EntitySearchRow` for entity search
- made entity search base-row oriented
- rewrote `getEntitiesByIds()` to use direct reads
- migrated interaction list UI to `InteractionListRow`
- removed embedded interaction detail aggregation from interaction search
- moved interaction detail hydration to direct reads
- migrated association search/list payloads to feature-local `AssociationListRow`
- added `getAssociationDetailsById()` for normalized association detail hydration
- removed legacy `InteractionSearchResult`
- removed legacy `AssociationSearchResult`
- removed leftover association compatibility assembly from postgres search

## Remaining TODOs

_No remaining migration TODOs from this checklist._

## Verification checklist

After each step, run:

- `pnpm exec tsc --noEmit`

Behavior checks:

- interaction explore table still renders participant labels correctly
- interaction details sheet still opens and shows evidence
- association list views still render parent/member labels correctly
- association detail/open states still show evidence and identifiers where expected
- filtering/facet behavior still matches expected results
