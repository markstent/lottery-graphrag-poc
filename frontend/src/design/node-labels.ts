/**
 * Plain-language name for each kind of graph node, for people who do not know
 * the graph's type names ("IncidentType" reads "incident type").
 * The keys are the node labels the graph is built with.
 */
export const NODE_LABELS: Record<string, string> = {
  AppVersion: 'app version',
  BusinessConcept: 'business concept',
  Campaign: 'campaign',
  Channel: 'channel',
  Currency: 'currency',
  Device: 'device',
  Document: 'document',
  DocumentChunk: 'passage',
  Draw: 'draw',
  Experiment: 'experiment',
  Game: 'game',
  GameCategory: 'game category',
  GameFamily: 'game family',
  GameMechanic: 'game mechanic',
  Incident: 'incident',
  IncidentType: 'incident type',
  Language: 'language',
  Market: 'market',
  PaymentMethod: 'payment method',
  PaymentProvider: 'payment provider',
  Platform: 'platform',
  PlatformVersion: 'platform version',
  Player: 'player',
  PlayerSegment: 'player segment',
  PrizeType: 'prize type',
  Region: 'region',
  Supplier: 'supplier',
  SupportCase: 'support case',
  SupportCategory: 'support category',
}

/**
 * The words for a node label. A label with no entry that is a bare type name
 * is split at its capitals; any other text, such as a name already written
 * for people, is returned as it is.
 */
export function nodeLabel(label: string): string {
  const known = NODE_LABELS[label]
  if (known !== undefined) return known
  return /^[A-Z][a-z]*(?:[A-Z][a-z]*)*$/.test(label)
    ? label.replace(/(?<=[a-z])(?=[A-Z])/g, ' ').toLowerCase()
    : label
}

/** The plural for a count: "1 game", "3 games"; "category" reads "categories". */
export function countedLabel(count: number, label: string): string {
  const words = nodeLabel(label)
  if (count === 1) return `1 ${words}`
  const plural = /[^aeiou]y$/.test(words)
    ? `${words.slice(0, -1)}ies`
    : /(?:s|x|ch|sh)$/.test(words)
      ? `${words}es`
      : `${words}s`
  return `${count} ${plural}`
}
