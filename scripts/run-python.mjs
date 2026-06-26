import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const candidates = process.platform === 'win32'
  ? [resolve('.venv/Scripts/python.exe'), 'python']
  : [resolve('.venv/bin/python3'), resolve('.venv/bin/python'), 'python3', 'python']

const command = candidates.find((candidate) => candidate.includes('/') || candidate.includes('\\')
  ? existsSync(candidate)
  : true)

if (!command) {
  console.error('Python executable not found.')
  process.exit(1)
}

const result = spawnSync(command, process.argv.slice(2), {
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  }
})

process.exit(result.status ?? 1)
