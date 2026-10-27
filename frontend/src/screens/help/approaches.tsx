import { PIPELINES } from '../../design/pipelines'
import { APPROACH_LINES } from './approach-lines'

export function ApproachCards() {
  return (
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
          <p className="text-text-primary">{APPROACH_LINES[pipeline.id]}</p>
        </article>
      ))}
    </div>
  )
}
