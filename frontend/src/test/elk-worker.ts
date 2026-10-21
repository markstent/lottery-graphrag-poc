/**
 * Stands in for `elkjs/lib/elk-worker.min.js?worker` under vitest (see
 * vite.config.ts): jsdom has no Worker, so elk's own in-process worker, the
 * one `elk.bundled.js` uses, runs the layout instead.
 */
// @ts-expect-error elk-worker.d.ts declares only a type; the module exports the class.
import { Worker as InProcessWorker } from 'elkjs/lib/elk-worker.min.js'

export default InProcessWorker as new () => Worker
