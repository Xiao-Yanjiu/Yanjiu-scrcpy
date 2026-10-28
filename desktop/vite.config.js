import { defineConfig, mergeConfig } from 'vite'

import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import useVueRouter from 'vue-router/vite'
import useVue from '@vitejs/plugin-vue'
import useVueJsx from '@vitejs/plugin-vue-jsx'
import useUnoCSS from 'unocss/vite'

import useElectron from 'vite-plugin-electron/simple'
import { notBundle } from 'vite-plugin-electron/plugin'

import useInternalPlugins from './src/plugins/internal.js'

import postcssConfig from './postcss.config.js'

const alias = {
  // Direct source startup must not consume stale workspace dist files.
  '@yanjiu-scrcpy/electron-setup/main': resolve('../packages/electron-setup/main/index.ts'),
  '@yanjiu-scrcpy/electron-setup/plugins': resolve('../packages/electron-setup/plugins/index.ts'),
  '$': resolve('src'),
  '$root': resolve(),
  '$docs': resolve('docs'),
  '$renderer': resolve('src'),
  '$electron': resolve('electron'),
  '$control': resolve('pages/control'),
  '$explorer': resolve('pages/explorer'),
  '$terminal': resolve('pages/terminal'),
}

function mergeCommon(config) {
  return mergeConfig({
    resolve: {
      alias,
    },
    build: {
      rolldownOptions: {
        external: [
          'i18next-fs-backend',
          '@lydell/node-pty',
        ],
      },
    },
  },
  config)
}

export default defineConfig((args) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const { command } = args

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = (isServe || !!process.env.VSCODE_DEBUG) ? 'inline' : undefined

  return mergeCommon(
    defineConfig({
      server: {
        port: 1535,
      },
      build: {
        sourcemap,
        minify: isBuild,
        rolldownOptions: {
          input: {
            main: resolve('index.html'),
            desktop: resolve('pages/desktop/index.html'),
            control: resolve('pages/control/index.html'),
            explorer: resolve('pages/explorer/index.html'),
            terminal: resolve('pages/terminal/index.html'),
          },
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules'))
                return undefined
              if (id.includes('element-plus') || id.includes('@element-plus'))
                return 'element-plus'
              if (id.includes('@tdesign'))
                return 'tdesign'
              if (id.includes('konva') || id.includes('vue-konva'))
                return 'konva'
              if (id.includes('@xterm'))
                return 'xterm'
              if (id.includes('@vueuse'))
                return 'vueuse'
              if (id.includes('dexie'))
                return 'dexie'
              if (id.includes('rxjs'))
                return 'rxjs'
              if (id.includes('lodash'))
                return 'lodash'
              if (/[\\/]node_modules[\\/](vue|vue-router|pinia)[\\/]/.test(id))
                return 'vue'
              if (id.includes('pinyin-pro'))
                return 'pinyin-pro'
              if (id.includes('/ai-sdk/') || id.includes('/ai/'))
                return 'ai-sdk'
              if (id.includes('@modelcontextprotocol'))
                return 'mcp'
            },
          },
        },
        chunkSizeWarningLimit: 1500,
      },
      plugins: [
        useUnoCSS(),
        useVueRouter({
          routesFolder: [
            {
              src: './src/views',
              exclude: [
                '**/modules',
                '**/components',
              ],
            },
          ],
        }),
        useVue(),
        useVueJsx(),
        useElectron({
          main: {
            entry: 'electron/main.js',
            vite: mergeCommon({
              plugins: [notBundle()],
            }, args),
            async onstart(args) {
              await args.startup()
              // Capture native/fatal exits from the parent, even when Electron
              // cannot flush its own log. The plugin exits Node immediately.
              process.electronApp?.prependOnceListener('exit', (code, signal) => {
                try {
                  const directory = resolve('..', 'user-data', 'logs')
                  mkdirSync(directory, { recursive: true })
                  appendFileSync(resolve(directory, 'electron-exit.log'), `${JSON.stringify({ time: new Date().toISOString(), code, hex: code == null ? null : `0x${(code >>> 0).toString(16)}`, signal })}\n`)
                }
                catch {}
              })
            },
          },
          preload: {
            entry: 'electron/preload.js',
            vite: mergeCommon({
              plugins: [notBundle()],
            }, args),
            onstart(args) {
              args.reload()
            },
          },
          renderer: {},
        }),
        ...useInternalPlugins(),
      ],
      css: {
        postcss: postcssConfig,
      },
      clearScreen: false,
    }),
  )
})
