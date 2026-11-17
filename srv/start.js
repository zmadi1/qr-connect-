import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const serve = fileURLToPath(new URL('../node_modules/@sap/cds/bin/serve.js', import.meta.url))
const child = spawn(process.execPath, [serve], { stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
