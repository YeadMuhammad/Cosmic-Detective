import { spawn } from 'node:child_process'

const children = []
const windows = process.platform === 'win32'
let stopping = false

function start(label, command, args) {
  const child = spawn(command, args, { cwd: process.cwd(), stdio: 'inherit' })
  children.push({ label, child })
  child.once('error', (error) => {
    console.error(`${label} could not start: ${error.message}`)
    stopOthers(child)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`${label} exited with code ${code}.`)
      stopOthers(child)
      process.exitCode = code ?? 1
    }
  })
}

function stopOthers(exitedChild) {
  stopping = true
  for (const { child } of children) {
    if (child !== exitedChild && child.exitCode === null && child.signalCode === null) child.kill()
  }
}

process.once('SIGINT', () => {
  stopOthers(null)
  process.exitCode = 130
})
process.once('SIGTERM', () => {
  stopOthers(null)
  process.exitCode = 143
})

if (windows) {
  start('Netlify Dev', process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npx --yes netlify-cli dev'])
} else {
  start('Netlify Dev', 'npx', ['--yes', 'netlify-cli', 'dev'])
}
start('SPHEREx worker', windows ? 'python' : 'python3', ['worker/spherex_worker.py'])

console.log('Netlify Dev and the SPHEREx worker are starting. Press Ctrl+C to stop both.')
