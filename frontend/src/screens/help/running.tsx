/**
 * Running it, at the Technical level: the one chapter that names the vendors
 * and the engineering commands. Every command is a target in the Makefile,
 * and a test checks it.
 */

import { BRING_UP, COMMAND_GROUPS, MODELS, RECOVERY } from './running-data'
import { ScrollBox } from '../../components/scroll-box'

const CODE = 'rounded-chip bg-surface-raised px-1.5 py-0.5 text-sm'
const CELL = 'border-b border-hairline px-3 py-2 align-top'

const Command = ({ children }: { children: string }) => (
  <code className={CODE}>{children}</code>
)

export function Running() {
  return (
    <div className="space-y-3 [&>h3]:pt-3">
      <h3 className="text-base font-semibold text-text-primary">Bring-up</h3>
      <ol className="list-decimal space-y-1 pl-6">
        {BRING_UP.map(([command, line]) => (
          <li key={command}>
            <Command>{command}</Command> {line}
          </li>
        ))}
      </ol>
      <h3 className="text-base font-semibold text-text-primary">Recovery</h3>
      <ScrollBox label="Recovery">
        <table className="w-full min-w-[36rem] text-left text-sm">
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
      </ScrollBox>
      <h3 className="text-base font-semibold text-text-primary">
        Model configuration
      </h3>
      <p>
        All three approaches use the same answer model and settings. Models are
        set in <code className={CODE}>.env</code>, and the example file lists
        every setting. Its defaults put fixed programs in place of the answer
        model and the judge, so they run without a language model.
      </p>
      <ScrollBox label="Model configuration">
        <table className="w-full min-w-[36rem] text-left text-sm">
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
      </ScrollBox>
      <p>
        An official run needs <code className={CODE}>GENERATION_PROVIDER</code>{' '}
        and <code className={CODE}>JUDGE_PROVIDER</code> set to{' '}
        <code className={CODE}>litellm</code>. Then{' '}
        <Command>make run-benchmark</Command> runs every question once on the
        six unseen worlds, 2029 to 2034 (D-097); <Command>REPEATS=N</Command>{' '}
        asks each N times. <Command>make run-smoke</Command> checks the scoring
        with those fixed programs and is not a result.
      </p>
      <h3 className="text-base font-semibold text-text-primary">
        Every command
      </h3>
      {COMMAND_GROUPS.map(({ group, rows }) => (
        <ScrollBox key={group} label={group}>
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="py-2 text-left font-semibold text-text-primary">
              {group}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Command</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([command, line]) => (
                <tr key={command}>
                  <th scope="row" className={`${CELL} w-56 font-normal`}>
                    <Command>{command}</Command>
                  </th>
                  <td className={CELL}>{line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      ))}
    </div>
  )
}
