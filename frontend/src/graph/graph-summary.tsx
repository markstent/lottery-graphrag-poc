/**
 * The text alternative to the whole canvas, read aloud through the canvas's
 * `aria-describedby`. The evidence-path list (`EvidencePathList`) covers the
 * nodes on a path; this covers every other node, grouped by state and, where
 * the cap folded nodes together, by group, so a screen-reader user can learn
 * the whole view without the picture.
 */

import { EVIDENCE_STATES } from '../design/evidence-states'
import { countedLabel, nodeLabel } from '../design/node-labels'
import type { EvidenceState } from '../design/evidence-states'
import { hopWords, type GraphNodeView, type GraphView } from './model'

export function GraphSummary({ id, view }: { id: string; view: GraphView }) {
  const onPath = new Set(view.path)
  const others = view.nodes.filter((node) => !onPath.has(node.id))
  const byState = new Map<EvidenceState, GraphNodeView[]>()
  for (const node of others)
    byState.set(node.state, [...(byState.get(node.state) ?? []), node])
  const folded = view.clusters.reduce((total, c) => total + c.count, 0)
  const added = view.nodes.filter((node) => node.addedByOntology).length
  return (
    <div id={id} className="sr-only">
      <p>
        The graph shows {countedLabel(view.nodes.length, 'node')} and{' '}
        {countedLabel(view.edges.length, 'relationship')}.
        {view.clusters.length > 0
          ? ` ${countedLabel(folded, 'node')} are folded into ${countedLabel(view.clusters.length, 'group')}.`
          : ''}
        {view.path.length > 0
          ? ` ${countedLabel(view.path.length, 'node')} lie on an evidence path, listed with the evidence paths.`
          : ' No evidence path has been recorded yet.'}
        {added > 0
          ? ` ${countedLabel(added, 'node')} were added by the ontology.`
          : ''}
      </p>
      {(Object.keys(EVIDENCE_STATES) as EvidenceState[])
        .filter((state) => byState.has(state))
        .map((state) => {
          const nodes = byState.get(state) ?? []
          const single = nodes.filter((node) => node.clusterId === undefined)
          return (
            <section key={state} aria-label={EVIDENCE_STATES[state].label}>
              <h4>
                {EVIDENCE_STATES[state].label}:{' '}
                {countedLabel(nodes.length, 'other node')}
              </h4>
              <ul>
                {single.map((node) => (
                  <li key={node.id}>
                    {nodeLabel(node.label)} ({node.id}), {hopWords(node.hop)}
                    {node.addedByOntology ? ', added by the ontology' : ''}
                  </li>
                ))}
                {view.clusters.flatMap((cluster) => {
                  const members = nodes.filter(
                    (n) => n.clusterId === cluster.id,
                  )
                  return members.length === 0
                    ? []
                    : [
                        <li key={cluster.id}>
                          Group of {countedLabel(members.length, cluster.label)}
                          , {hopWords(cluster.hop)}:{' '}
                          {members.map((n) => n.id).join(', ')}
                          {members.some((n) => n.addedByOntology)
                            ? `, ${members.filter((n) => n.addedByOntology).length} added by the ontology`
                            : ''}
                        </li>,
                      ]
                })}
              </ul>
            </section>
          )
        })}
    </div>
  )
}
