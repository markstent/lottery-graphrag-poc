# UX and Visual Experience Specification

## 1. Purpose

Create a visually compelling, technically credible application that lets an audience **watch** conventional RAG and graph-enhanced retrieval work side by side.

The interface must make the value of relationships and ontology immediately understandable.

The experience should feel like a premium enterprise AI research product.

---

## 2. Primary Presentation Story

The core visual message is:

```text
CURRENT DATA APPROACH
versus
CURRENT DATA + GRAPH + ONTOLOGY
```

The interface should not frame Neo4j as replacing the data layer.

---

## 3. Primary Screen: Live Lab

### Header

Display:

- experiment name
- current dataset/profile
- market scope
- current model
- local/remote status
- experiment run ID
- presentation mode toggle

### Question composer

Large, prominent input.

Example:

> Why did digital conversion fall in Greece, and have we seen the same issue elsewhere?

Controls:

- Run
- clear
- saved demo questions
- market scope
- configuration selector

### Main comparison

Two equal-weight panes:

```text
CURRENT APPROACH       + GRAPH & ONTOLOGY
```

Do not call the baseline "bad" or graph "smart".

---

## 4. Conventional RAG Pane

Display actual events:

1. query received
2. embedding
3. candidate retrieval
4. similarity ranking
5. reranking
6. selected context
7. answer generation

Visual components:

- query vector indicator
- document/chunk cards
- similarity bars
- selected/discarded state
- context-token count
- source type badges

The pane should make vector retrieval intuitive without misleading metaphors.

---

## 5. GraphRAG Pane

This is a hero feature.

### Live traversal

Start with seed nodes only.

Example:

```text
[Greece]
    |
 [Game]
```

As actual retrieval events arrive:

- active node highlights
- edge draws
- target node enters
- candidate branches appear muted
- selected evidence becomes prominent
- rejected candidates fade
- ontology concepts use a distinct visual treatment

### Required node states

```text
seed
active
candidate
traversed
selected
discarded
ontology
source_record
```

### Required edge states

```text
candidate
active
traversed
evidence_path
```

---

## 6. Graph Layout

The graph must optimise comprehension.

Preferred approaches:

- guided layered layout during live retrieval
- local force layout only where stable
- fixed positions for already-rendered evidence where practical
- prevent constant reorganisation while presenting

Avoid:

- full-database hairballs
- uncontrolled physics
- tiny labels
- decorative 3D complexity

A 3D graph exploration mode may exist later, but it is not the primary evidence view.

---

## 7. Evidence Path View

Provide a simplified view after execution.

Example:

```text
Game
  -> Platform
  -> Version
  -> Incident
  -> Austria
```

Clicking a node or edge opens provenance.

This is the easiest presentation view for explaining why GraphRAG found something.

---

## 8. Execution Timeline

Below the comparison:

```text
00.00 Query submitted
00.16 Semantic candidates found
00.31 Seed entity resolved
00.48 Platform traversed
00.70 Incident discovered
00.94 Austrian market connection found
01.11 Evidence ranked
01.35 Context assembled
02.10 Answer generated
```

The timeline must be generated from actual telemetry.

Selecting an event rewinds the visual state.

---

## 9. Answers

Both sides show:

- generated answer
- citations/evidence links
- confidence/calibration where meaningful
- latency
- context tokens

Do not visually prejudice the audience before scoring completes.

---

## 10. Question Score Strip

After both complete, show:

```text
Correctness
Evidence recall
Grounding
Latency
Tokens
```

Optional expanded metrics:

- relationship discovery
- cross-market discovery
- ontology contribution

---

## 11. Experiment Home

Purpose:

Configure an experiment.

Controls:

- dataset profile
- world seed
- scenario seed
- markets
- scenario selection
- model
- inference provider
- embedding model
- top-k
- graph depth
- context budget
- benchmark suite

Must support saving named experiment configurations.

---

## 12. Scenario Lab

Each scenario card shows:

- scenario name
- explanation
- affected markets
- signal strength
- noise level
- target dates
- target segments

Important:

The UI may reveal scenario configuration to the user when intentionally using Scenario Lab.

During blind benchmark mode, hidden truth details must not be displayed.

---

## 13. Evidence Explorer

Three tabs:

### Sources

- structured records
- documents
- metrics
- incidents

### Graph

- nodes
- edges
- traversal path
- ontology mappings

### Provenance

- source system
- source record ID
- validity dates
- extraction/derivation method
- confidence

---

## 14. Semantic Layer Screen

This is a key presentation screen.

Show:

```text
Structured data    Documents    Telemetry    Support
        \              |           |           /
                    Entity mapping
                          |
                       Ontology
                          |
                   Knowledge graph
                          |
                       AI agent
```

Interactive behaviour:

- selecting a source highlights mapped graph entities
- selecting an ontology concept highlights mapped local entities
- selecting a graph relationship shows source provenance

The message should be:

> The graph is an additional semantic layer above existing data.

---

## 15. Benchmark Runner

Show:

- question number
- category
- current status
- current configuration
- rolling metrics
- errors
- pause/cancel

Do not overwhelm with graph animation during fully automated benchmark runs.

Provide a "watch this question" action to open Live Lab detail.

---

## 16. Results Dashboard

Primary sections:

### Overview

A/B/C comparison.

### By complexity

Performance from factual to ontology/pattern questions.

### Evidence

Precision, recall, grounding.

### Efficiency

Latency, context tokens, tool calls, cost.

### Market

UK / Greece / Austria / Czech Republic.

### Failure analysis

Why systems failed.

---

## 17. Presentation Mode

Optimised for 1920×1080.

Changes:

- larger typography
- simplified secondary controls
- fewer visible configuration details
- controlled graph zoom
- fixed demo questions
- reset button
- full-screen friendly layout

Presentation mode must use real backend execution.

---

## 18. Visual Style

Use a restrained dark or neutral research-lab aesthetic.

Principles:

- premium
- calm
- high contrast
- data-first
- sparse accents
- subtle animation

Avoid:

- neon cyberpunk
- excessive glass blur
- glowing everything
- meaningless particle effects
- oversized gradients

Three.js may be used for subtle ambient visualisation or optional exploration, not as a substitute for clear graph communication.

---

## 19. Design Tokens

Define:

```text
background
surface
surface_raised
border
text_primary
text_secondary
text_muted
baseline_accent
graph_accent
ontology_accent
success
warning
error
market_uk
market_gr
market_at
market_cz
```

Also define:

- typography scale
- spacing scale
- radius
- elevation
- motion durations
- chart line weights
- graph node sizes
- edge thickness
- selected states

---

## 20. Motion

Use motion to communicate state.

Suggested timings:

```text
micro transition: 120-180ms
panel change: 180-240ms
graph node reveal: 180-300ms
edge traversal: 220-400ms
result reveal: 200-300ms
```

Respect reduced-motion mode.

Do not delay real information solely for cinematic effect.

---

## 21. Responsive Behaviour

Primary target:

- desktop
- laptop

At narrower widths:

- stack comparison panes vertically
- preserve question/answer clarity
- allow local graph panning
- do not hide evidence accessibility

---

## 22. Accessibility

- keyboard navigation
- visible focus
- semantic controls
- textual graph equivalent
- sufficient contrast
- no colour-only states
- reduced-motion mode
- screen-reader labels

---

## 23. Mock-up Requirements

Before final frontend implementation, produce high-fidelity mock-ups for:

- Experiment Home
- Live Lab idle
- Live Lab active retrieval
- Live Lab completed
- Graph evidence path
- Error state
- Scenario Lab
- Evidence Explorer
- Benchmark Runner
- Results Dashboard
- Semantic Layer view
- Presentation Mode

---

## 24. UX Acceptance Tests

Examples:

### UX-LIVE-001

Within one second of viewing the comparison screen, a user must be able to distinguish the two retrieval approaches.

### UX-LIVE-002

Every visible graph traversal must correspond to a real telemetry event.

### UX-LIVE-003

The final answer must not obscure access to evidence.

### UX-LIVE-004

A user must be able to replay the retrieval sequence.

### UX-GRAPH-001

The default graph view must not show the entire database.

### UX-EVIDENCE-001

Every citation must be inspectable.

### UX-PRESENT-001

Demo reset must restore a known configuration without manual cleanup.

---

## 25. User Research

Before final presentation, test with at least three uninvolved colleagues.

Ask:

- What is the experiment trying to prove?
- Which side found more context?
- Why did the graph-enhanced side find another market?
- Can you identify the evidence?
- Is the graph replacing the data layer?

If users answer the last question "yes", the architecture story is not clear enough.

---

## 26. HITL Gates

### HITL-06

Approve information architecture and user flows.

### HITL-07

Approve high-fidelity mock-ups before final frontend implementation.
