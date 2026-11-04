/**
 * Plain-language phrase for each graph relationship type, read from the
 * source node to the target node ("Incident AFFECTS Game" reads "affects").
 * The keys are the relationship types the graph is built with.
 */
export const RELATIONSHIP_PHRASES: Record<string, string> = {
  AFFECTS: 'affects',
  AFFECTS_MARKET: 'affects market',
  AVAILABLE_IN: 'is available in',
  AVAILABLE_VIA: 'is available via',
  BELONGS_TO: 'belongs to',
  CATEGORISED_AS: 'is categorised as',
  CONCERNS: 'concerns',
  DEPLOYED_TO: 'is deployed to',
  EXPOSED_TO: 'is exposed to',
  FROM_MARKET: 'is from market',
  HAS_CHUNK: 'contains passage',
  HAS_DRAW: 'has draw',
  HAS_MECHANIC: 'has mechanic',
  INSTANCE_OF: 'is an instance of',
  IS_A: 'is a kind of',
  MAPS_TO: 'is an instance of concept',
  OF_TYPE: 'is of type',
  PLAYS: 'plays',
  PROMOTES: 'promotes',
  PROVIDED_BY: 'is provided by',
  REFERENCES: 'refers to',
  RELATED_TO: 'is related to',
  RELATED_TO_APP_VERSION: 'is related to app version',
  RELATED_TO_VERSION: 'is related to version',
  RUNS_ON: 'runs on',
  SIMILAR_TO: 'is similar to',
  TARGETS: 'targets',
  USES: 'uses',
  USES_PAYMENT: 'uses payment method',
  VERSION_OF: 'is a version of',
}

/** The phrase for `type`; a type with no entry reads as its lower-cased name. */
export const relationshipPhrase = (type: string): string =>
  RELATIONSHIP_PHRASES[type] ?? type.toLowerCase().replaceAll('_', ' ')

/**
 * Where each kind of link is made from when the graph is loaded, in plain
 * words (D-113). It follows `backend/app/graph/relationship_rows.py`: most
 * links copy a column, some are counted from bulk rows, and a few are worked
 * out by a rule from a game's sales flags or from the ontology.
 */
export const RELATIONSHIP_SOURCES: Record<string, string> = {
  AFFECTS:
    'Copied from the incident and game table: one row for each game an incident hit, with how hard.',
  AFFECTS_MARKET: "Copied from the incident's market column.",
  AVAILABLE_IN: "Copied from the game's market column.",
  AVAILABLE_VIA:
    "Worked out from the game's sales flags: sold online means app and web, sold in shops means retail.",
  BELONGS_TO:
    "Copied from the game's family column, and from the player's two segment columns, value and engagement.",
  CATEGORISED_AS: "Copied from the support case's category column.",
  CONCERNS: "Copied from the support case's game column, when it names one.",
  DEPLOYED_TO: "Copied from the app version's market column.",
  EXPOSED_TO:
    'Counted from the campaign exposures table: one link for each player and campaign, with how often it was shown.',
  FROM_MARKET: 'Copied from the market column of the support case or document.',
  HAS_CHUNK: 'Each document is split into passages for text search.',
  HAS_DRAW: "Copied from the draws table's game column.",
  HAS_MECHANIC: 'Copied from the game and mechanic table.',
  INSTANCE_OF: "Copied from the game's category column.",
  IS_A: 'From the ontology file: the broader idea each idea sits under.',
  MAPS_TO:
    "From the ontology file: each country's own code, listed under the shared idea it stands for.",
  OF_TYPE: "Copied from the incident's type column.",
  PLAYS:
    'Counted from the tickets table: one link for each player and game, with the number of tickets.',
  PROMOTES: 'Copied from the campaign and game table.',
  PROVIDED_BY: "Copied from the payment method's provider column.",
  REFERENCES:
    "Record codes written in the document's title or text, up to five.",
  RELATED_TO:
    "Copied from the incident's platform column, and from the support case's incident column.",
  RELATED_TO_APP_VERSION:
    "Copied from the incident's app version column, when set.",
  RELATED_TO_VERSION:
    "Copied from the incident's platform version column, when set.",
  RUNS_ON:
    "Worked out from the game's sales flags: online games run on the app, web, payment, sign-in and draw platforms, shop games on the retail and draw platforms.",
  SIMILAR_TO:
    'Worked out from the ontology: the games in other countries most alike in family, category and mechanics. Each game keeps its three closest.',
  TARGETS:
    'For a campaign, counted from its exposures: the segment that engaged with it most. For an experiment, copied from its target segment column.',
  USES: 'Copied from the player and device table.',
  USES_PAYMENT: 'Copied from the player and payment method table.',
  VERSION_OF: "Copied from the platform version's platform column.",
}
