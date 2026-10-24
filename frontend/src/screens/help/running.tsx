/**
 * Running it: the one section that names the vendors and the engineering
 * commands. Every command is a target in the Makefile, and a test checks it.
 */

import { BRING_UP, MODELS, RECOVERY } from './running-data'
import { Section } from './section'

const CODE = 'rounded-chip bg-surface-raised px-1.5 py-0.5 text-sm'
const CELL = 'border-b border-hairline px-3 py-2 align-top'

const Command = ({ children }: { children: string }) => (
  <code className={CODE}>{children}</code>
)

export function Running() {
  return (
    <Section id="running">
      <h3 className="text-base font-semibold text-text-primary">Bring-up</h3>
      <ol className="list-decimal space-y-1 pl-6">
        {BRING_UP.map(([command, line]) => (
          <li key={command}>
            <Command>{command}</Command> {line}
          </li>
        ))}
      </ol>
      <h3 className="text-base font-semibold text-text-primary">Recovery</h3>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Recovery</caption>
        <thead className="text-text-muted">
          <tr>
            {['What you see', 'Run', 'Note'].map((name) => (
              <th key={name} scope="col" className={CELL}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RECOVERY.map(([symptom, command, note]) => (
            <tr key={command}>
              <td className={CELL}>{symptom}</td>
              <td className={CELL}>
                <Command>{command}</Command>
              </td>
              <td className={CELL}>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="text-base font-semibold text-text-primary">
        Model configuration
      </h3>
      <p>
        All three approaches use the same answer model and settings. Models are
        set in <code className={CODE}>.env</code>, and the example file lists
        every setting. The example answer and judge are stand-ins that need no
        model.
      </p>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Model configuration</caption>
        <thead className="text-text-muted">
          <tr>
            {['Role', 'Settings', 'Note'].map((name) => (
              <th key={name} scope="col" className={CELL}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODELS.map(([role, settings, note]) => (
            <tr key={role}>
              <td className={CELL}>{role}</td>
              <td className={CELL}>
                <code className={CODE}>{settings}</code>
              </td>
              <td className={CELL}>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        An official run needs <code className={CODE}>GENERATION_PROVIDER</code>{' '}
        and <code className={CODE}>JUDGE_PROVIDER</code> set to{' '}
        <code className={CODE}>litellm</code>. Then{' '}
        <Command>make run-benchmark</Command> runs every question on three
        worlds, three times each. <Command>make run-smoke</Command> checks the
        scoring with stand-ins and is not a result.
      </p>
    </Section>
  )
}
