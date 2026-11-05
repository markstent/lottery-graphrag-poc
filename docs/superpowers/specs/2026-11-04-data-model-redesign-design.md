# Data Model screen redesign

Status: draft for the project owner's approval.
Date: 2026-11-04.

## Why

The project owner finds the Data Model screen hard to use and messy.
The owner's words: "its just not a good looking ux/ui", "what i just dont like is the way its set out..it looks messy", and earlier "its not clear at all" that a reader can click through to more detail.

The owner's goal for the screen: a reader leaves it understanding the structure of the data sources, how they fit together, and with some examples that make it concrete.
Readers will mostly explore it on their own after a presentation, so the screen has to explain itself.

What is wrong today, as reviewed on 2026-11-04:

- The four tabs (Warehouse, Graph, Ontology, Scenarios) each use a different layout, so nothing carries over from one to the next.
- The Warehouse and Graph tabs lead with large, tangled maps of every table and every kind of record, which are hard to read and do not show how the layers relate.
- Long explanation panels, cue lines, steps strips and tables are stacked one above another, with many type sizes.
- Drilling into detail happens in different ways on each tab: a drawer on one, a new page on another, a side panel on a third.
- Nothing shows one real record at all three layers, which is the clearest way to see how they fit together.

## What the owner chose

The owner looked at three layouts in the visual companion and chose option B, "one explorer layout everywhere", then approved its tab-by-tab wireframe ("looks good").
The wireframe is in `.superpowers/brainstorm/66459-1793822917/content/b-explorer-tabs.html`.

Option B is:

- An Overview tab, where everyone lands, that shows the three layers side by side with one example and a small diagram of how they fit together.
- Every other tab (Tables, Graph, Concepts, Stories) uses the same three columns: choose on the left, look in the middle, details and "where next" on the right.
- The long explanations shrink to short notes on the Overview and an "About this" link on each tab.

## Goals

- A newcomer understands from the Overview alone what the three layers are, how big each is, and how one record moves through them.
- Every explorer tab looks and behaves the same way, so learning one teaches the rest.
- It is obvious what can be clicked and where it leads.
- The screen looks calm: one grid, one set of type sizes, generous white space, no tangled diagrams.
- Every figure and example is read live from the API for the active world, as today.

## Non-goals

- No change to the backend data, the graph, the ontology or any experimental behaviour; the read API grows only as listed under "Backend additions".
- No change to the other screens, except for links into Data Model that must keep working.
- No new charting or graph library.

## Anti-goals

These would make the redesign a failure even if it worked:

- A screen that looks tidier but loses the ability to reach any table row, graph record, concept or story that can be reached today.
- Example content written into the code that is wrong for another world, or is not real data.
- Showing truth-ledger content (answers, hidden truths) on this screen; that stays in Help only.
- A redesign that is only a restyle of the current four layouts.

## Constraints

- AGENTS.md applies in full: synthetic data only, no real employer name, no em dash, design tokens, keyboard access, visible focus, reduced motion, non-colour cues, and every state (loading, empty, error, disabled) handled.
- The banned-word list and the copy budget outside Help apply (`frontend/src/copy/`); the owner has raised the budget for Data Model copy before (D-101, D-113, D-114), and the builder may raise it again with a decision record if the new copy needs it, but should aim to use fewer words than today.
- The primary target is a 16:9 desktop at 1920 by 1080; the layout must also work at 1440 and at 1600 wide without the page scrolling sideways.
- Presentation mode raises type one step, as on every screen.
- The UX specification (`docs/ux.md`, Data Model section) must be rewritten to match, and a decision record added to `DECISIONS.md`.
- Visual baselines for the screen are replaced, and Playwright end-to-end tests cover each tab's main path.

## The design, as decided

### Tabs and addresses

- Five tabs: Overview, Tables, Graph, Concepts, Stories, in that order.
- Each tab and each chosen item is in the address, so every view can be linked and the back button works: `#/data-model?tab=tables&table=incidents&row=INC_037`, `#/data-model?tab=graph&node=INC_037`, `#/data-model?tab=concepts&concept=CONCEPT_NATIONAL_DRAW&market=MKT_GR`, `#/data-model?tab=stories&story=SCN-007`.
- The old tab ids keep working as aliases: `warehouse` opens Tables, `ontology` opens Concepts, `scenarios` opens Stories; `#/data-model` with no tab opens Overview.
- The links from other screens keep working: Help's links by tab, and every "Follow into the graph" link (`tab=graph&node=...`).

### Overview

- One line saying what the screen is: the data the three approaches search, in three layers, each built from the one before.
- Three equal cards in a row: Tables, Graph, Concepts.
  Each card has its layer number, a plain title ("The company's data", "The links between records", "One dictionary for four countries"), its live size (systems, tables and rows; kinds of record and kinds of link; concepts and country codes), the same example record shown at that layer, and an "Explore" button to its tab.
- Under the cards, "How they fit together": a small, clean diagram of the example moving through the layers.
  It shows the example's table row, the graph links made from its columns, and the shared concept its type is matched to, with one short caption each.
- Under that, short notes in plain words on how each layer is built, taken from the D-113 copy and shortened.
  They replace the long explanation panels and must keep these points: the graph is built by a program from the tables, most links are copied from columns, some are counted or worked out by a rule, and the ontology links only Graph + Ontology may follow.
- A small diagram of the core of the graph: the main kinds of record (incident, platform version, platform, game, market, support case, player, campaign) and the links between them, drawn cleanly, with a link to the Graph tab for all of them.
  The full map of all 29 kinds of record and the full map of all tables are removed.
- A fourth, quieter line links to Stories: "Eight stories are planted in this data for the test."

The example is chosen live from the active world by a fixed rule, so it is always real and fits the world shown.
The rule: the incident, lowest id first, whose platform version is shared with an incident in another market, where no part of the example's path was planted.
No part of the path, the incident, its platform version or its app version, may be one the truth ledger names, and the incident in the other market must pass the same test.
A planted path must not be the example, because the Overview would then point at a story's answer.
In the development world (dev-seed2026) the rule picks INC_003, an Austrian analytics incident whose version PLV_ANALYTICS_2 a Greek incident (INC_010) shares; the wireframe's INC_037 was only an illustration.
If no incident meets the rule, the first incident with no planted part is used; if there is none, the cards show sizes only and the diagram is left out with a short note.
The active world is whichever the API reports as active (dev-seed2026 under `make dev`, demo-seed2026 under `make dev-official`).

### The explorer layout (Tables, Graph, Concepts, Stories)

- Three columns: a narrow list on the left (about a quarter), the chosen item in the middle (the widest), details and "where next" on the right (a little more than a quarter).
- The column headings are numbered steps, so the layout explains itself, for example "1 Choose a table", "2 Its rows", "3 The record".
  This replaces the "How to explore" strip of D-114.
- The left list has a search box at the top that narrows it as the reader types.
- Something is always chosen when a tab opens (the example record's table, the example record, the first concept, the first story), so no column is ever empty on arrival.
- Whatever can be clicked looks clickable: rows and list items highlight under the pointer and on focus, and links that move the reader on are filled buttons with an arrow.
- An "About this" link at the top right of each tab opens a drawer with that layer's explanation.
- The columns stack on narrow screens, list first.

### Tables

- Left: every table, grouped by source system, with its row count; a search box finds a table by name.
- Middle: the chosen table's name, row and column counts, the tables it links to, a column-and-value filter and its rows, 50 to a page, as today.
  Values in a column that names a row of another table are links that open that row in its own table.
- Right: the chosen row's fields, which graph links it becomes (by kind and count, from the record API), and an "Open in the graph" button when it has a graph record.
  With no row chosen, the right column says to choose a row.

### Graph

- Left: a search box that opens a record by its id, then the kinds of record with their counts.
  Choosing a kind opens a sample record of that kind.
- Middle: the chosen record and its neighbours one step out, as in today's focused record view.
  Neighbours of one kind and link that are more than a few are grouped into one box with a count ("22 support cases"); choosing the box lists them in the right column.
- Right: where the record came from (table and row, with a "See its table row" link), its links by kind and count, and which approaches follow each kind of link.
- The "Kinds of link" table, with "Made from" (D-113) and the B, C and all-links filter, moves into the Graph tab's "About this" drawer.

### Concepts

- Left: the concept tree, as today, with a search box.
- Middle: the chosen concept: its definition, names in four languages, other names, the concept it sits under, and the concepts under it.
- Right: each country's terms for it, with the country filter, as today.

### Stories

- Left: the eight planted stories, each with its strength.
- Middle: the chosen story: what was planted, in plain words, its strength and noise level explained, and the rows it added by table.
- Right: where next: read the full story in Help and see its questions in Help.
- There is no link to the rows a story planted: only the truth ledger names them, and pointing at them would hand the reader the answer (builder check; settled by the writer, see "Calls made").
- No truth-ledger content is shown, as today.

## Backend additions (owner, 2026-11-05: "yes if it helps")

The read API may grow for this screen; the data, the graph, the ontology and every experimental behaviour stay as they are.

- `GET /api/v1/scenarios` returns each story's plain description from the catalogue, so Stories need not repeat it in the page copy.
- A read-only endpoint names the Overview example: the incident chosen by the rule above, with the planted check done on the backend.
  It may read which rows were planted, but it lives with the reference and Help endpoints, never in retrieval code, and the truth-ledger isolation tests must still pass and be extended to cover it.
  It returns only the example's id, never which rows were planted or why.
- The neighbours endpoint, or the node endpoint, returns how many links of each kind and direction meet a node, for every node including ontology concepts, so a group box can show its total.
- Each addition is a typed, versioned schema with tests, and the OpenAPI types in the frontend are regenerated (`make api-contract`).

## Calls made by the writer

- Stories has no link to planted rows (see Stories).
- A group of neighbours lists its first 100 in the right column, with the total when it is known; there is no paging.

## Left to the builder

- Component structure, file layout and naming, keeping to the lean rules in AGENTS.md; the existing diagram, rows grid, concept tree and drawer components should be reused where they fit.
- Exact widths, spacing and type sizes within the design tokens.
- How the Overview diagram and the core-of-the-graph diagram are drawn, as long as they are small, clean and readable.
- The threshold for grouping neighbours, and how a group lists its members.
- Exact wording, within the plain-language rules and the banned-word list.
- How the example's concept is found (for example through the incident type's binding in the ontology API).
- Whether the record API or the neighbours API supplies the link counts on the right of the Graph tab.

## Testing

- Vitest and React Testing Library for each tab's states: loading, ready, empty, error, and the example rule including its fallbacks.
- Playwright end-to-end paths: Overview to each tab by its Explore button; Tables to a row, to a linked row, to the graph; Graph search by id, a group box, back to the table row; Concepts with a country filter; Stories to Help.
- The old addresses and the inbound links from Help and Live Lab still land in the right place.
- New visual baselines for each tab, normal and presentation mode, at 1920 by 1080, and a check that nothing scrolls sideways at 1440.
- Keyboard-only walk through each tab, and the truth-ledger check that no answer content appears.
