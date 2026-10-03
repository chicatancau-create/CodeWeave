import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const entry = resolve(process.argv[2])
const parentPid = Number(process.argv[3])
// Preserve the existing server's direct-run branch: locks, session sweeping,
// corruption protection and signal handlers remain owned by server.mjs.
process.argv[1] = entry
await import(pathToFileURL(entry).href)

process.parentPort?.on('message', ({ data }) => {
  if (data?.type === 'shutdown') process.emit('SIGTERM')
})

// A crashed parent must not leave a service holding the user's data lock.
const parentWatch = setInterval(() => {
  try {
    process.kill(parentPid, 0)
  } catch {
    process.emit('SIGTERM')
  }
}, 2000)
parentWatch.unref()
