/// <reference types="vite/client" />
import type { MissionApi } from '@shared/ipc'

declare global {
  interface Window {
    mc: MissionApi
  }
}

export {}
