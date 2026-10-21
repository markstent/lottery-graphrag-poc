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
