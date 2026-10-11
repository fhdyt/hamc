import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { buildCsp } from './src/shared/csp'

const alias = { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }

const cspPlugin = (dev: boolean): Plugin => ({
  name: 'mc-csp',
  transformIndexHtml: (html) =>
    html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${buildCsp(dev)}" />`)
})

export default defineConfig(({ command }) => ({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: { plugins: [react(), tailwindcss(), cspPlugin(command === 'serve')], resolve: { alias } }
}))
