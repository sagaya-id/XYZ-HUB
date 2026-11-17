import { one, q, run, uid, nowIso, parseJson } from './db'

/**
 * Chat infrastructure shared by the project/entity rooms and direct messages.
 * Project rooms are created lazily and keyed uniquely, so concurrent requests
 * can never create a duplicate room for the same project.
 */
export const ENTITY_CHANNEL_KEY = 'entity'
export const projectChannelKey = (projectId: string) => `project:${projectId}`
export const dmChannelKey = (userA: string, userB: string) => `dm:${[userA, userB].sort().join(':')}`

export type ChatSettings = { maxFileMb: number; maxFiles: number }

export const DEFAULT_CHAT_SETTINGS: ChatSettings = { maxFileMb: 10, maxFiles: 5 }

export async function getChatSettings(env: any): Promise<ChatSettings> {
  const row = await one<any>(env.DB, `SELECT value FROM app_config WHERE key = 'chat:settings'`)
  if (!row) return DEFAULT_CHAT_SETTINGS
  const parsed = parseJson<Partial<ChatSettings>>(row.value, {})
  return {
    maxFileMb: Math.min(Math.max(Number(parsed.maxFileMb ?? DEFAULT_CHAT_SETTINGS.maxFileMb) || 10, 1), 25),
    maxFiles: Math.min(Math.max(Number(parsed.maxFiles ?? DEFAULT_CHAT_SETTINGS.maxFiles) || 5, 1), 10),
  }
}

async function insertConversation(
  env: any,
  entityId: string,
  kind: 'entity' | 'project' | 'direct',
  channelKey: string,
  projectId: string | null,
  userA: string | null,
  userB: string | null,
) {
  const id = uid('cnv_')
  try {
    await run(
      env.DB,
      `INSERT OR IGNORE INTO chat_conversations (id, entity_id, kind, project_id, channel_key, user_a, user_b, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, entityId, kind, projectId, channelKey, userA, userB, nowIso(),
    )
  } catch {
    /* unique key race: another request created it first */
  }
  return one<any>(
    env.DB,
    `SELECT * FROM chat_conversations WHERE entity_id = ? AND channel_key = ?`,
    entityId, channelKey,
  )
}

export async function ensureEntityConversation(env: any, entityId: string) {
  return insertConversation(env, entityId, 'entity', ENTITY_CHANNEL_KEY, null, null, null)
}

export async function ensureProjectConversation(env: any, entityId: string, projectId: string) {
  return insertConversation(env, entityId, 'project', projectChannelKey(projectId), projectId, null, null)
}

export async function ensureDirectConversation(env: any, entityId: string, userId: string, peerId: string) {
  const [a, b] = [userId, peerId].sort()
  return insertConversation(env, entityId, 'direct', dmChannelKey(a, b), null, a, b)
}

export async function conversationById(env: any, id: string) {
  return one<any>(env.DB, `SELECT * FROM chat_conversations WHERE id = ?`, id)
}

/**
 * One-off idempotent migration:
 * - adds conversation_id / client_token to existing chat_messages
 * - backfills room rows for entity and project channels (existing history kept)
 * - points old messages at their conversation
 * - removes abandoned attachment drafts
 */
export async function ensureChatInfra(env: any) {
  const columns = await q<any>(env.DB, `PRAGMA table_info(chat_messages)`)
  const names = columns.map((column: any) => column.name)
  if (!names.includes('conversation_id')) {
    await run(env.DB, `ALTER TABLE chat_messages ADD COLUMN conversation_id TEXT`)
  }
  if (!names.includes('client_token')) {
    await run(env.DB, `ALTER TABLE chat_messages ADD COLUMN client_token TEXT`)
  }
  await run(
    env.DB,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_client_token ON chat_messages(user_id, client_token)`,
  )
  await run(
    env.DB,
    `CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(conversation_id, created_at)`,
  )

  const entities = await q<any>(env.DB, `SELECT id FROM entities`)
  for (const entity of entities) {
    await ensureEntityConversation(env, entity.id)
  }
  const projects = await q<any>(env.DB, `SELECT id, entity_id FROM projects WHERE deleted_at IS NULL`)
  for (const project of projects) {
    await ensureProjectConversation(env, project.entity_id, project.id)
  }

  await run(
    env.DB,
    `UPDATE chat_messages SET conversation_id = (
       SELECT c.id FROM chat_conversations c
       WHERE c.entity_id = chat_messages.entity_id
         AND c.channel_key = CASE
           WHEN chat_messages.project_id IS NULL THEN 'entity'
           ELSE 'project:' || chat_messages.project_id
         END
     )
     WHERE conversation_id IS NULL`,
  )

  // Abandoned uploads (never attached to a message) are removed after a day.
  const stale = await q<any>(
    env.DB,
    `SELECT * FROM chat_attachments WHERE message_id IS NULL AND created_at < ?`,
    new Date(Date.now() - 24 * 3600_000).toISOString(),
  )
  for (const attachment of stale) {
    try { await env.FILES.delete(attachment.object_key) } catch { /* object already gone */ }
    await run(env.DB, `DELETE FROM chat_attachments WHERE id = ?`, attachment.id)
  }
}
