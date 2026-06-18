import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const DEFAULT_API_PORT = Number(process.env.PORT) || 8787
const API_PORT = await findOpenPort(DEFAULT_API_PORT)

const processes = [
  spawn(process.execPath, ['server.mjs'], {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, PORT: String(API_PORT), VITE_API_PORT: String(API_PORT) },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, PORT: String(API_PORT), VITE_API_PORT: String(API_PORT) },
  }),
]

async function findOpenPort(startPort) {
  let port = startPort

  while (true) {
    const isFree = await new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => {
        resolve(false)
      })
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })

    if (isFree) {
      if (port !== startPort) {
        console.log(`Port ${startPort} is unavailable, using ${port} instead.`)
      }
      return port
    }

    port += 1
  }
}

let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of processes) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  process.exit(code)
}

for (const child of processes) {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      shutdown(code ?? 1)
    }
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
