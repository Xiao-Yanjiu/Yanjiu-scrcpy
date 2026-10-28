import { app } from 'electron'

/**
 * Sandbox configuration manager options
 */
export interface SandboxManagerOptions {
  /**
   * Process module (for testing)
   */
  processModule?: NodeJS.Process
}

/**
 * Sandbox configuration result
 */
export interface SandboxConfigResult {
  disabled: boolean
  reason: string
}

/**
 * Sandbox configuration manager
 *
 * The Chromium sandbox stays enabled by default on Linux. Packaging does not
 * elevate the helper or silently opt out by distribution format. Host policy
 * failures must be reported; explicit environment overrides remain user choices.
 *
 * IMPORTANT: this must run before `app.whenReady()` — Chromium decides on the
 * sandbox (zygote/SUID helper) during browser startup, so switches appended
 * after the ready event have no effect on it.
 */
export class SandboxManager {
  private process: NodeJS.Process

  /**
   * Constructor
   * @param options - Configuration options
   */
  constructor(options: SandboxManagerOptions = {}) {
    this.process = options.processModule || process
  }

  /**
   * Configure sandbox settings
   * @returns Configuration result
   */
  configureSandbox(): SandboxConfigResult {
    if (this.process.platform !== 'linux') {
      return {
        disabled: false,
        reason: 'Not applicable on non-Linux platforms',
      }
    }

    // Environment overrides take precedence in both directions.
    if (this.process.env.FORCE_NO_SANDBOX === '1') {
      return this.disable('FORCE_NO_SANDBOX=1')
    }

    if (this.process.env.FORCE_SANDBOX === '1') {
      return {
        disabled: false,
        reason: 'FORCE_SANDBOX=1',
      }
    }

    // Keep Chromium's sandbox enabled for every distribution format.
    // A host policy failure must be reported, not silently bypassed.

    return {
      disabled: false,
      reason: 'Sandbox enabled',
    }
  }

  /**
   * Disable the Chromium sandbox
   */
  private disable(reason: string): SandboxConfigResult {
    app.commandLine.appendSwitch('no-sandbox')
    app.commandLine.appendSwitch('disable-dev-shm-usage')
    return {
      disabled: true,
      reason,
    }
  }
}

/**
 * Configure the Chromium sandbox. Must be called before `app.whenReady()`.
 */
export function configureSandbox(options: SandboxManagerOptions = {}): SandboxConfigResult {
  return new SandboxManager(options).configureSandbox()
}
