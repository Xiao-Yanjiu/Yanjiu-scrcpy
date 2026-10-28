import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Basic package: do not alter sandbox ownership/mode, device rules or host policy.
export function createLinuxAfterInstall() {
  const outputPath = fileURLToPath(new URL('../node_modules/.cache/yanjiu-scrcpy/after-install.sh', import.meta.url))
  mkdirSync(fileURLToPath(new URL('../node_modules/.cache/yanjiu-scrcpy/', import.meta.url)), { recursive: true })
  writeFileSync(outputPath, '#!/bin/sh\nexit 0\n')
  return outputPath
}
