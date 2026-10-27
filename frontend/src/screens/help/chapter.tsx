/**
 * One chapter of Help: an anchor the route can scroll to, in the Panel every
 * destination uses. A chapter that needs the question bank takes its load, so
 * it shows the loading and error states while the rest of Help reads. The
 * Plain blocks are always shown; at the Technical level the Technical blocks
 * follow them under their own subheading, so a technical reader keeps the
 * framing.
 */

import type { Load } from '../../app/use-load'
import { Panel } from '../../components/panel'
import { Blocks } from './blocks'
import { CHAPTERS, type ChapterCopy, type ChapterId } from './chapters'
import { useHelpData } from './help-data'

const BODY = 'space-y-3 [&>p]:max-w-4xl'

export function Chapter({
  id,
  copy,
  load,
}: {
  id: ChapterId
  copy: ChapterCopy
  load?: Load<unknown>
}) {
  const { level } = useHelpData()
  const { title } = CHAPTERS.find((chapter) => chapter.id === id)!
  return (
    <div id={id} className="scroll-mt-24">
      <Panel
        title={title}
        state={load?.status ?? 'ready'}
        error={load?.status === 'error' ? load.error : undefined}
        onRetry={load?.retry}
      >
        <div className={`${BODY} text-base text-text-secondary`}>
          <Blocks blocks={copy.plain} />
          {level === 'technical' && copy.technical.length > 0 && (
            <div className={`${BODY} border-t border-hairline pt-3`}>
              <h3 className="text-base font-semibold text-text-primary">
                Technical detail
              </h3>
              <Blocks blocks={copy.technical} />
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
