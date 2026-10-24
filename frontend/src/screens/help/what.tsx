import { FlowDiagram } from '../../components/flow-diagram'
import { Section } from './section'

export function What() {
  return (
    <Section id="what">
      <p>
        This experiment asks what a knowledge graph and a shared ontology add to
        a company&apos;s existing data. Three approaches answer the same
        questions from the same synthetic data with the same model. Each answer
        is scored against an answer key, so the three can be compared.
      </p>
      <FlowDiagram />
    </Section>
  )
}
