import type { Env } from './db'
import type { SessionUser } from './auth'

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: SessionUser
  }
}

export const ENTITY_KEYS = ['yayasan', 'store'] as const
