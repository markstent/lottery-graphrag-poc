/** The glossary: each term with its plain meaning, and at the Technical level its technical one. */

import { GLOSSARY_TERMS } from '../../copy/glossary'
import { useHelpData } from './help-data'

export function Glossary() {
  const { level } = useHelpData()
  return (
    <dl className="grid grid-cols-[12rem_1fr] gap-x-6 gap-y-2">
      {GLOSSARY_TERMS.map(({ term, meaning, technical }) => (
        <div key={term} className="contents">
          <dt className="font-semibold text-text-primary">{term}</dt>
          <dd>
            {meaning}
            {level === 'technical' && technical && (
              <span className="mt-1 block text-text-muted">{technical}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
