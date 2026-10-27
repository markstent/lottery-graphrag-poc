import { GLOSSARY_TERMS } from '../../copy/glossary'

export function Glossary() {
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-6 gap-y-2">
      {GLOSSARY_TERMS.map(({ term, meaning }) => (
        <div key={term} className="contents">
          <dt className="font-semibold text-text-primary">{term}</dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  )
}
