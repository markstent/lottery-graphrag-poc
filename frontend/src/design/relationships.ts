/**
 * Plain-language phrase for each graph relationship type, read from the
 * source node to the target node ("Incident AFFECTS Game" reads "affects").
 * The keys are the relationship types the graph is built with.
 */

import { countedLabel } from './node-labels'
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
 * How a record's links read as sentences. `out` is what comes before the
 * count when the record is the source ("is available in 1 market"); `in` is
 * what comes after the other records when the record is the target, for one
 * and for several ("1 incident affects it", "2 players play it").
 */
interface LinkWords {
  out: string
  in: readonly [one: string, several: string]
}

const LINK_WORDS: Record<string, LinkWords> = {
  AFFECTS: { out: 'affects', in: ['affects it', 'affect it'] },
  AFFECTS_MARKET: { out: 'affects', in: ['affects it', 'affect it'] },
  AVAILABLE_IN: {
    out: 'is available in',
    in: ['is available in it', 'are available in it'],
  },
  AVAILABLE_VIA: {
    out: 'is available via',
    in: ['is available via it', 'are available via it'],
  },
  BELONGS_TO: { out: 'belongs to', in: ['belongs to it', 'belong to it'] },
  CATEGORISED_AS: {
    out: 'is categorised as',
    in: ['is categorised as it', 'are categorised as it'],
  },
  CONCERNS: { out: 'concerns', in: ['concerns it', 'concern it'] },
  DEPLOYED_TO: {
    out: 'is deployed to',
    in: ['is deployed to it', 'are deployed to it'],
  },
  EXPOSED_TO: {
    out: 'is exposed to',
    in: ['is exposed to it', 'are exposed to it'],
  },
  FROM_MARKET: { out: 'is from', in: ['is from it', 'are from it'] },
  HAS_CHUNK: { out: 'contains', in: ['is part of it', 'are part of it'] },
  HAS_DRAW: { out: 'has', in: ['belongs to it', 'belong to it'] },
  HAS_MECHANIC: { out: 'has', in: ['is used by it', 'are used by it'] },
  INSTANCE_OF: {
    out: 'is an instance of',
    in: ['is an instance of it', 'are instances of it'],
  },
  IS_A: { out: 'is a kind of', in: ['is a kind of it', 'are kinds of it'] },
  MAPS_TO: {
    out: 'is matched to',
    in: ['is matched to it', 'are matched to it'],
  },
  OF_TYPE: { out: 'is of type', in: ['has this type', 'have this type'] },
  PLAYS: { out: 'plays', in: ['plays it', 'play it'] },
  PROMOTES: { out: 'promotes', in: ['promotes it', 'promote it'] },
  PROVIDED_BY: {
    out: 'is provided by',
    in: ['is provided by it', 'are provided by it'],
  },
  REFERENCES: { out: 'refers to', in: ['refers to it', 'refer to it'] },
  RELATED_TO_APP_VERSION: {
    out: 'is related to',
    in: ['is related to it', 'are related to it'],
  },
  RELATED_TO_VERSION: {
    out: 'is related to',
    in: ['is related to it', 'are related to it'],
  },
  RUNS_ON: { out: 'runs on', in: ['runs on it', 'run on it'] },
  TARGETS: { out: 'targets', in: ['targets it', 'target it'] },
  USES: { out: 'uses', in: ['uses it', 'use it'] },
  USES_PAYMENT: { out: 'uses', in: ['uses it', 'use it'] },
  VERSION_OF: {
    out: 'is a version of',
    in: ['is a version of it', 'are versions of it'],
  },
}

/** Kinds of link that read the same from either end, so both ends are one line. */
const SYMMETRIC = new Set(['RELATED_TO', 'SIMILAR_TO'])

export interface LinkCount {
  type: string
  direction: 'out' | 'in'
  count: number
}

const number = (n: number) => n.toLocaleString('en-GB')

/**
 * A record's links as sentences, with the count first and the direction in
 * the verb: "is available in 1 market", "2,573 players play it", "is similar
 * to 6 others". `kindOf` names the node label at the other end of a link ("Game",
 * "GameFamily"), or nothing when it is not known; a symmetric kind
 * is one line counting both directions.
 */
export function linkLines(
  links: readonly LinkCount[],
  kindOf: (type: string, direction: 'out' | 'in') => string | undefined,
): string[] {
  const lines: string[] = []
  const merged = new Set<string>()
  for (const { type, direction, count } of links) {
    if (SYMMETRIC.has(type)) {
      if (merged.has(type)) continue
      merged.add(type)
      const total = links
        .filter((l) => l.type === type)
        .reduce((sum, l) => sum + l.count, 0)
      lines.push(
        `${relationshipPhrase(type)} ${number(total)} ${total === 1 ? 'other' : 'others'}`,
      )
      continue
    }
    const things = countedLabel(
      count,
      kindOf(type, direction) ?? 'record',
    ).replace(/^\d+/, number(count))
    const words = LINK_WORDS[type]
    if (direction === 'out')
      lines.push(`${words?.out ?? relationshipPhrase(type)} ${things}`)
    else
      lines.push(
        `${things} ${words?.in[count === 1 ? 0 : 1] ?? `${relationshipPhrase(type)} it`}`,
      )
  }
  return lines
}

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
