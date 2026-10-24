import { PIPELINES, type PipelineId } from '../../design/pipelines'
import { Section } from './section'

const DEFINITIONS: Record<PipelineId, string> = {
  A: 'Finds the passages of documents that best match the words of the question.',
  B: 'Adds records linked to the question by relationships, such as an incident and its platform version.',
  C: 'Also uses the ontology, which ties each market’s local terms to one concept, so a question can cross markets.',
}

export function Approaches() {
  return (
    <Section id="approaches">
      <div className="grid grid-cols-3 gap-4">
        {PIPELINES.map((pipeline) => (
          <article
            key={pipeline.id}
            aria-labelledby={`approach-${pipeline.id}`}
            className="rounded-card p-4"
            style={{ backgroundColor: pipeline.tint }}
          >
            <h3
              id={`approach-${pipeline.id}`}
              className="mb-1 text-base font-semibold"
              style={{ color: pipeline.strong }}
            >
              {pipeline.label}
            </h3>
            <p className="text-text-primary">{DEFINITIONS[pipeline.id]}</p>
          </article>
        ))}
      </div>
    </Section>
  )
}
