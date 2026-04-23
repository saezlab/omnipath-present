# Research task: should we simplify or remove the silver layer?

## Context

We currently have three relevant pieces in play:

1. **`inputs_v2/` in `omnipath_build`**
   - resource-specific parsers and builders
   - currently emit the internal silver-layer schema

2. **the silver loader / silver transformation step**
   - applies additional transformation and canonicalization on top of the `inputs_v2` output

3. **the target graph schema**
   - documented in `next-omnipath/docs/target-graph-schema.md`
   - centers on:
     - `entity`
     - `ontology_term`
     - `entity_relation`
     - `entity_relation_evidence`
     - `entity_identifier`

We are questioning whether the internal silver schema is still the right abstraction boundary, or whether it is introducing an unnecessary intermediate form.

---

## Main question

Please evaluate whether the current system should keep the silver layer as-is, simplify it, or bypass it and map more directly from `inputs_v2` into the target graph schema.

This is a research / design task, not an implementation task.

---

## Files and areas to inspect

### In `omnipath_build`
- `pypath/pypath/internals/silver_schema.py`
- the silver loader / silver transformation code
- `pypath/pypath/inputs_v2/`
- a few representative `inputs_v2` resources, especially more complex ones such as:
  - `reactome.py`
  - `corum.py`
  - `intact.py`
  - `signor.py`
  - `wikipathways.py`
  - any parser/helper modules they rely on

### In `next-omnipath`
- `next-omnipath/docs/target-graph-schema.md`

---

## What to analyze

### 1. What value does the silver schema currently provide?
Please assess whether the current silver schema gives us clear benefits such as:
- simplifying parser code in `inputs_v2`
- preserving source fidelity in a useful way
- providing a stable intermediate contract across resources
- making debugging or exports easier
- supporting multiple downstream projections from one intermediate format

Please be concrete.

### 2. What transformation work is already happening in the silver loader?
Please inspect the silver loader and identify:
- what semantic decisions are already made there
- what logic is effectively converting silver objects into a more graph-like model
- whether the silver loader is doing the “real” canonicalization work already

We want to understand whether the silver schema is truly canonical, or whether it mostly serves as a temporary container before the real transformation happens.

### 3. How well does the silver schema map to the target graph schema?
Please assess where the mapping is:
- straightforward
- awkward
- lossy
- dependent on conventions or special cases

In particular, look at how the silver schema handles:
- entities
- interactions represented as entities
- memberships / nested memberships
- annotations
- ontology-like concepts / cv terms

and how these would need to map into:
- `entity`
- `ontology_term`
- `entity_relation`
- `entity_relation_evidence`
- `entity_identifier`

### 4. Is the silver schema the right abstraction boundary?
Please form an opinion on whether the current architecture splits responsibilities in the right place.

Useful framing questions:
- Is `inputs_v2 -> silver` a clean parsing boundary?
- Or is silver too far from the actual target schema to be useful?
- Is the silver loader doing so much restructuring that the intermediate schema is not really buying enough?
- Would a thinner staging layer or a more direct target-oriented mapping be simpler?

### 5. Could we simplify the system?
Please propose and compare a few options, for example:

#### Option A: keep the silver layer largely as-is
When would this still be the best choice?

#### Option B: keep a silver layer, but simplify or reshape it
For example, make it a thinner source-canonical layer instead of a semi-graph model.

#### Option C: map more directly from `inputs_v2` into the target graph schema
What helper abstractions would be needed to make this practical?
What would become simpler, and what would become harder?

---

## Desired output

Please produce a short design note markdown answering:

1. **Should we keep the silver layer, simplify it, or bypass it?**
2. **Why?**
3. **What are the main tradeoffs?**
4. **If simplifying, what concrete architecture would you recommend instead?**

Please include:
- a concise recommendation
- the reasoning behind it
- any major risks or migration costs

---

## Goal

The goal is to decide whether the current pipeline architecture is justified, or whether we can simplify it by moving closer to the target graph schema earlier in the ingestion process.
