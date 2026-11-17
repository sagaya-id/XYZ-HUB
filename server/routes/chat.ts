import { Hono } from 'hono'
import type { AppEnv } from '../ctx'
import { one, q, run, uid, nowIso } from '../db'
import { HttpError, loadProject, resolveEntity } from '../scope'
import { notify } from '../lib'
import type { SessionUser } from '../auth'
import {
  conversationById,
  ensureDirectConversation,
  ensureEntityConversation,
  ensureProjectConversation,
  getChatSettings,
  type ChatSettings,
} from '../chat-infra'

export const chatRoutes = new Hono<AppEnv>()

const MAX_BODY = 4000
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']

type ConversationContext = {
  entity: any
  conversation: any
  project: any | null
}

const entityById = (env: any, id: string) => one<any>(env.DB, `SELECT * FROM entities WHERE id = ?`, id)

/** Resolve room + enforce participation. Never uses admin overrides for DMs. */
async function loadChatContext(
  env: any,
  user: SessionUser,
  entity: any,
  projectId: string | null,
  dmId: string | null,
): Promise<ConversationContext> {
  if (dmId) {
    const conversation = await conversationById(env, dmId)
    if (!conversation || conversation.kind !== 'direct') throw new HttpError(404, 'Percakapan tidak ditemukan.')
    if (conversation.entity_id !== entity.id) throw new HttpError(404, 'Percakapan tidak ditemukan.')
    if (conversation.user_a !== user.id && conversation.user_b !== user.id) {
      throw new HttpError(403, 'Anda bukan peserta percakapan ini.')
    }
    return { entity, conversation, project: null }
  }
  if (projectId) {
    const { project } = await loadProject(env, user, projectId)
    if (project.entity_id !== entity.id) throw new HttpError(404, 'Kanal proyek tidak ditemukan.')
    const conversation = await ensureProjectConversation(env, entity.id, projectId)
    return { entity, conversation, project }
  }
  const conversation = await ensureEntityConversation(env, entity.id)
  return { entity, conversation, project: null }
}

function assertWritable(ctx: ConversationContext) {
  if (ctx.project?.archived_at) {
    throw new HttpError(403, 'Proyek sudah diarsipkan. Ruang diskusi hanya dapat dibaca.')
  }
}

async function chatProjects(env: any, user: SessionUser, entityId: string) {
  if (user.role === 'MA' || user.role === 'SA') {
    return q<any>(
      env.DB,
      `SELECT id, code, title, archived_at FROM projects
       WHERE entity_id = ? AND deleted_at IS NULL
       ORDER BY archived_at IS NOT NULL, created_at DESC`,
      entityId,
    )
  }
  return q<any>(
    env.DB,
    `SELECT p.id, p.code, p.title, p.archived_at FROM projects p
     JOIN project_members m ON m.project_id = p.id
     WHERE m.user_id = ? AND p.entity_id = ? AND p.deleted_at IS NULL
     ORDER BY p.archived_at IS NOT NULL, p.created_at DESC`,
    user.id, entityId,
  )
}

async function conversationUnread(env: any, conversation: any, userId: string) {
  const read = await one<any>(
    env.DB,
    `SELECT last_read_at FROM chat_reads WHERE user_id = ? AND entity_id = ? AND channel_key = ?`,
    userId, conversation.entity_id, conversation.channel_key,
  )
  const row = await one<any>(
    env.DB,
    `SELECT COUNT(*) AS n FROM chat_messages
     WHERE conversation_id = ? AND deleted_at IS NULL AND user_id != ? AND created_at > ?`,
    conversation.id, userId, read?.last_read_at ?? '',
  )
  return row?.n ?? 0
}

async function lastMessage(env: any, conversationId: string) {
  const row = await one<any>(
    env.DB,
    `SELECT m.body, m.created_at, m.user_id, u.name AS user_name,
       (SELECT COUNT(*) FROM chat_attachments a WHERE a.message_id = m.id) AS attachment_count
     FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = ? AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 1`,
    conversationId,
  )
  if (!row) return null
  return {
    body: row.body.length > 110 ? `${row.body.slice(0, 107)}…` : row.body,
    created_at: row.created_at,
    user_name: row.user_name,
    user_id: row.user_id,
    attachment_count: row.attachment_count,
  }
}

function attachmentDto(row: any) {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    is_image: IMAGE_MIMES.includes(row.mime),
    url: `/api/chat/attachments/${row.id}`,
    download_url: `/api/chat/attachments/${row.id}?download=1`,
  }
}

async function attachmentsFor(env: any, messageIds: string[]) {
  const map = new Map<string, any[]>()
  if (!messageIds.length) return map
  const placeholders = messageIds.map(() => '?').join(',')
  const rows = await q<any>(
    env.DB,
    `SELECT * FROM chat_attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
    ...messageIds,
  )
  for (const row of rows) {
    const list = map.get(row.message_id) ?? []
    list.push(attachmentDto(row))
    map.set(row.message_id, list)
  }
  return map
}

async function serializeMessages(env: any, rows: any[]) {
  const attachments = await attachmentsFor(env, rows.map((row) => row.id))
  return rows.map((row) => ({
    id: row.id,
    entity_id: row.entity_id,
    project_id: row.project_id,
    conversation_id: row.conversation_id,
    user_id: row.user_id,
    body: row.body,
    created_at: row.created_at,
    user_name: row.user_name,
    user_avatar_id: row.user_avatar_id,
    user_avatar_url: row.user_avatar_id ? `/api/files/${row.user_avatar_id}` : null,
    user_role: row.user_role,
    user_job_title: row.user_job_title,
    attachments: attachments.get(row.id) ?? [],
  }))
}

function peerDto(user: any) {
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    job_title: user.job_title,
    avatar_id: user.avatar_id,
    avatar_url: user.avatar_id ? `/api/files/${user.avatar_id}` : null,
    is_active: user.is_active,
  }
}

async function peerLastRead(env: any, conversation: any, userId: string) {
  if (conversation.kind !== 'direct') return null
  const peerId = conversation.user_a === userId ? conversation.user_b : conversation.user_a
  const row = await one<any>(
    env.DB,
    `SELECT last_read_at FROM chat_reads WHERE user_id = ? AND entity_id = ? AND channel_key = ?`,
    peerId, conversation.entity_id, conversation.channel_key,
  )
  return row?.last_read_at ?? null
}

/* ------------------------------------------------------------------ */
/* Conversation list                                                   */
/* ------------------------------------------------------------------ */

chatRoutes.get('/chat/channels', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const entityConversation = await ensureEntityConversation(c.env, entity.id)
  const projects = await chatProjects(c.env, user, entity.id)
  const dmConversations = await q<any>(
    c.env.DB,
    `SELECT * FROM chat_conversations
     WHERE entity_id = ? AND kind = 'direct' AND (user_a = ? OR user_b = ?)`,
    entity.id, user.id, user.id,
  )

  const channel = async (conversation: any, extra: any) => ({
    key: conversation.channel_key,
    conversation_id: conversation.id,
    unread: await conversationUnread(c.env, conversation, user.id),
    last_message: await lastMessage(c.env, conversation.id),
    peer_last_read_at: await peerLastRead(c.env, conversation, user.id),
    ...extra,
  })

  const channels: any[] = []
  channels.push(
    await channel(entityConversation, {
      kind: 'entity',
      project_id: null,
      name: `Obrolan ${entity.name}`,
      code: null,
      peer: null,
      is_read_only: false,
      sections: 'project',
    }),
  )

  for (const project of projects) {
    const conversation = await ensureProjectConversation(c.env, entity.id, project.id)
    channels.push(
      await channel(conversation, {
        kind: 'project',
        project_id: project.id,
        name: project.title,
        code: project.code,
        peer: null,
        is_read_only: !!project.archived_at,
        sections: 'project',
      }),
    )
  }

  const directChannels = []
  for (const conversation of dmConversations) {
    const peerId = conversation.user_a === user.id ? conversation.user_b : conversation.user_a
    const peer = await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ?`, peerId)
    if (!peer) continue
    directChannels.push(
      await channel(conversation, {
        kind: 'direct',
        project_id: null,
        name: peer.name,
        code: null,
        peer: peerDto(peer),
        is_read_only: false,
        sections: 'direct',
      }),
    )
  }
  directChannels.sort((a, b) => {
    const at = a.last_message?.created_at ?? ''
    const bt = b.last_message?.created_at ?? ''
    return bt.localeCompare(at) || a.name.localeCompare(b.name)
  })

  const all = [...channels, ...directChannels]
  return c.json({
    channels: all,
    unread: all.reduce((sum, item) => sum + item.unread, 0),
    direct_unread: directChannels.reduce((sum, item) => sum + item.unread, 0),
    can_post: true,
  })
})

chatRoutes.get('/chat/unread', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const entityConversation = await ensureEntityConversation(c.env, entity.id)
  let total = await conversationUnread(c.env, entityConversation, user.id)
  for (const project of await chatProjects(c.env, user, entity.id)) {
    total += await conversationUnread(c.env, await ensureProjectConversation(c.env, entity.id, project.id), user.id)
  }
  const dms = await q<any>(
    c.env.DB,
    `SELECT * FROM chat_conversations WHERE entity_id = ? AND kind = 'direct' AND (user_a = ? OR user_b = ?)`,
    entity.id, user.id, user.id,
  )
  for (const conversation of dms) {
    total += await conversationUnread(c.env, conversation, user.id)
  }
  return c.json({ unread: total })
})

/* ------------------------------------------------------------------ */
/* People search + open a DM                                           */
/* ------------------------------------------------------------------ */

chatRoutes.get('/chat/users', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const search = (c.req.query('q') ?? '').trim()
  const like = `%${search.toLowerCase()}%`
  const rows = await q<any>(
    c.env.DB,
    `SELECT * FROM users
     WHERE is_active = 1 AND entity_id = ? AND id != ?
       AND (? = '' OR lower(name) LIKE ? OR lower(email) LIKE ? OR lower(coalesce(job_title,'')) LIKE ?)
     ORDER BY name ASC LIMIT 25`,
    entity.id, user.id, search, like, like, like,
  )
  return c.json({ users: rows.map(peerDto) })
})

chatRoutes.post('/chat/dm', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const body = await c.req.json().catch(() => ({}))
  const peerId = String(body.userId ?? '').trim()
  if (!peerId || peerId === user.id) return c.json({ error: 'Pilih pengguna lain untuk memulai obrolan.' }, 400)
  const peer = await one<any>(c.env.DB, `SELECT * FROM users WHERE id = ? AND is_active = 1`, peerId)
  if (!peer) return c.json({ error: 'Pengguna tidak ditemukan atau tidak aktif.' }, 404)
  if (peer.entity_id !== entity.id) {
    throw new HttpError(403, 'Pesan langsung hanya dapat dilakukan dengan pengguna dari entitas yang sama.')
  }
  const conversation = await ensureDirectConversation(c.env, entity.id, user.id, peer.id)
  if (!conversation) return c.json({ error: 'Percakapan gagal dibuat.' }, 500)
  return c.json({
    conversation: {
      id: conversation.id,
      channel_key: conversation.channel_key,
      entity_id: conversation.entity_id,
      peer: peerDto(peer),
      unread: 0,
      last_message: await lastMessage(c.env, conversation.id),
    },
  })
})

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

chatRoutes.get('/chat/messages', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const projectId = c.req.query('project') || null
  const dmId = c.req.query('dm') || null
  const ctx = await loadChatContext(c.env, user, entity, projectId, dmId)
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 80), 10), 100)
  const before = c.req.query('before') || null
  const beforeId = c.req.query('beforeId') || null

  const filters = [`m.conversation_id = ?`, `m.deleted_at IS NULL`]
  const params: any[] = [ctx.conversation.id]
  if (before) {
    filters.push(`(m.created_at < ? OR (m.created_at = ? AND m.id < ?))`)
    params.push(before, before, beforeId ?? '')
  }
  params.push(limit + 1)

  const rows = await q<any>(
    c.env.DB,
    `SELECT m.*, u.name AS user_name, u.avatar_id AS user_avatar_id, u.role AS user_role, u.job_title AS user_job_title
     FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE ${filters.join(' AND ')}
     ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
    ...params,
  )
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit).reverse()
  const peer = ctx.conversation.kind === 'direct'
    ? await one<any>(
        c.env.DB,
        `SELECT * FROM users WHERE id = ?`,
        ctx.conversation.user_a === user.id ? ctx.conversation.user_b : ctx.conversation.user_a,
      )
    : null

  return c.json({
    channel: {
      key: ctx.conversation.channel_key,
      conversation_id: ctx.conversation.id,
      kind: ctx.conversation.kind,
      project_id: ctx.conversation.project_id,
      name: ctx.project ? ctx.project.title : ctx.conversation.kind === 'direct' ? peer?.name : `Obrolan ${entity.name}`,
      code: ctx.project?.code ?? null,
      peer: peerDto(peer),
      is_read_only: !!ctx.project?.archived_at,
    },
    peer_last_read_at: await peerLastRead(c.env, ctx.conversation, user.id),
    messages: await serializeMessages(c.env, page),
    has_more: hasMore,
  })
})

chatRoutes.post('/chat/messages', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const payload = await c.req.json().catch(() => ({}))
  const projectId = payload.projectId ? String(payload.projectId) : null
  const dmId = payload.dmConversationId ? String(payload.dmConversationId) : null
  const ctx = await loadChatContext(c.env, user, entity, projectId, dmId)
  assertWritable(ctx)

  const body = String(payload.body ?? '').trim()
  const attachmentIds: string[] = Array.isArray(payload.attachmentIds)
    ? [...new Set<string>(payload.attachmentIds.map((id: any) => String(id)).filter(Boolean))]
    : []
  if (body.length > MAX_BODY) return c.json({ error: `Pesan maksimal ${MAX_BODY} karakter.` }, 400)
  if (!body && !attachmentIds.length) return c.json({ error: 'Pesan tidak boleh kosong.' }, 400)

  const settings = await getChatSettings(c.env)
  if (attachmentIds.length > settings.maxFiles) {
    return c.json({ error: `Maksimal ${settings.maxFiles} lampiran per pesan.` }, 400)
  }

  const clientToken = payload.clientToken ? String(payload.clientToken).slice(0, 100) : null
  if (clientToken) {
    const existing = await one<any>(
      c.env.DB,
      `SELECT * FROM chat_messages WHERE user_id = ? AND client_token = ? AND deleted_at IS NULL`,
      user.id, clientToken,
    )
    if (existing) {
      const [message] = await serializeMessages(c.env, [{
        ...existing,
        user_name: user.name,
        user_avatar_id: user.avatar_id,
        user_role: user.role,
        user_job_title: user.job_title,
      }])
      return c.json({ message, duplicate: true })
    }
  }

  const attachments = attachmentIds.length
    ? await q<any>(
        c.env.DB,
        `SELECT * FROM chat_attachments
         WHERE id IN (${attachmentIds.map(() => '?').join(',')})
           AND uploaded_by = ? AND conversation_id = ? AND message_id IS NULL`,
        ...attachmentIds, user.id, ctx.conversation.id,
      )
    : []
  if (attachments.length !== attachmentIds.length) {
    return c.json({ error: 'Lampiran tidak valid atau sudah dipakai pada pesan lain.' }, 400)
  }

  const id = uid('cht_')
  const createdAt = nowIso()
  await run(
    c.env.DB,
    `INSERT INTO chat_messages (id, entity_id, project_id, conversation_id, user_id, body, created_at, client_token)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, ctx.entity.id, ctx.project?.id ?? null, ctx.conversation.id, user.id, body, createdAt, clientToken,
  )
  for (const attachment of attachments) {
    await run(c.env.DB, `UPDATE chat_attachments SET message_id = ? WHERE id = ?`, id, attachment.id)
  }
  await run(
    c.env.DB,
    `INSERT INTO chat_reads (user_id, entity_id, channel_key, last_read_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id, entity_id, channel_key) DO UPDATE SET last_read_at = excluded.last_read_at`,
    user.id, ctx.entity.id, ctx.conversation.channel_key, createdAt,
  )

  await notifyChatRecipients(c.env, ctx, user, body, attachments.length, id)

  const [message] = await serializeMessages(c.env, [{
    id,
    entity_id: ctx.entity.id,
    project_id: ctx.project?.id ?? null,
    conversation_id: ctx.conversation.id,
    user_id: user.id,
    body,
    created_at: createdAt,
    user_name: user.name,
    user_avatar_id: user.avatar_id,
    user_role: user.role,
    user_job_title: user.job_title,
  }])
  return c.json({ message })
})

async function notifyChatRecipients(
  env: any,
  ctx: ConversationContext,
  user: SessionUser,
  body: string,
  attachmentCount: number,
  messageId: string,
) {
  let recipients: string[] = []
  let title = `Pesan baru di ${ctx.entity.name}`
  let link = '/app/chat'

  if (ctx.conversation.kind === 'direct') {
    const peerId = ctx.conversation.user_a === user.id ? ctx.conversation.user_b : ctx.conversation.user_a
    recipients = [peerId]
    title = `Pesan pribadi dari ${user.name}`
    link = `/app/chat?dm=${ctx.conversation.id}`
  } else if (ctx.project) {
    const rows = await q<any>(
      env.DB,
      `SELECT DISTINCT u.id FROM users u
       WHERE u.is_active = 1 AND u.id != ? AND (
         u.role = 'MA' OR (u.role = 'SA' AND u.entity_id = ?)
         OR u.id IN (SELECT user_id FROM project_members WHERE project_id = ?)
       )`,
      user.id, ctx.entity.id, ctx.project.id,
    )
    recipients = rows.map((r: any) => r.id)
    title = `Pesan baru · ${ctx.project.code}`
    link = `/app/chat?project=${ctx.project.id}`
  } else {
    const rows = await q<any>(
      env.DB,
      `SELECT id FROM users WHERE is_active = 1 AND (entity_id = ? OR role = 'MA')`,
      ctx.entity.id,
    )
    recipients = rows.map((r: any) => r.id).filter((id: string) => id !== user.id)
  }

  if (!recipients.length) return
  const preview = body
    ? body.length > 140 ? `${body.slice(0, 137)}…` : body
    : `${attachmentCount} lampiran`
  await notify(env, {
    userIds: recipients,
    type: 'chat.message',
    title,
    body: `${user.name}: ${preview}`,
    link,
    entityId: ctx.entity.id,
    projectId: ctx.project?.id ?? null,
    dedupeKey: `chat:${messageId}`,
  })
}

chatRoutes.post('/chat/read', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const payload = await c.req.json().catch(() => ({}))
  const ctx = await loadChatContext(
    c.env, user, entity,
    payload.projectId ? String(payload.projectId) : null,
    payload.dmConversationId ? String(payload.dmConversationId) : null,
  )
  await run(
    c.env.DB,
    `INSERT INTO chat_reads (user_id, entity_id, channel_key, last_read_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id, entity_id, channel_key) DO UPDATE SET last_read_at = excluded.last_read_at`,
    user.id, ctx.entity.id, ctx.conversation.channel_key, nowIso(),
  )
  return c.json({ ok: true })
})

chatRoutes.delete('/chat/messages/:id', async (c) => {
  const user = c.get('user')
  const message = await one<any>(c.env.DB, `SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL`, c.req.param('id'))
  if (!message) return c.json({ error: 'Pesan tidak ditemukan.' }, 404)

  const conversation = await conversationById(c.env, message.conversation_id)
  if (!conversation) return c.json({ error: 'Percakapan tidak ditemukan.' }, 404)
  const entity = await entityById(c.env, conversation.entity_id)
  if (!entity) return c.json({ error: 'Entitas tidak ditemukan.' }, 404)

  if (conversation.kind === 'direct') {
    if (conversation.user_a !== user.id && conversation.user_b !== user.id) {
      throw new HttpError(403, 'Anda bukan peserta percakapan ini.')
    }
    if (message.user_id !== user.id) throw new HttpError(403, 'Hanya pengirim yang dapat menghapus pesan pribadi.')
  } else {
    if (user.role !== 'MA' && user.entity_id !== conversation.entity_id) {
      throw new HttpError(403, 'Akses lintas entitas ditolak.')
    }
    await loadChatContext(c.env, user, entity, conversation.project_id, null)
    const isModerator = user.role === 'MA' || user.role === 'SA'
    if (message.user_id !== user.id && !isModerator) {
      throw new HttpError(403, 'Hanya penulis pesan atau admin entitas yang dapat menghapus pesan ini.')
    }
  }

  await run(c.env.DB, `UPDATE chat_messages SET deleted_at = ? WHERE id = ?`, nowIso(), message.id)
  return c.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

type FileRule = {
  ext: string
  mime: string[]
  image: boolean
  check: (bytes: Uint8Array) => boolean
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value)
const asciiAt = (bytes: Uint8Array, offset: number, text: string) =>
  [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0))
const isZip = (bytes: Uint8Array) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])

const FILE_RULES: FileRule[] = [
  { ext: 'jpg', mime: ['image/jpeg'], image: true, check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { ext: 'jpeg', mime: ['image/jpeg'], image: true, check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { ext: 'png', mime: ['image/png'], image: true, check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: 'webp', mime: ['image/webp'], image: true, check: (b) => asciiAt(b, 0, 'RIFF') && asciiAt(b, 8, 'WEBP') },
  { ext: 'pdf', mime: ['application/pdf'], image: false, check: (b) => asciiAt(b, 0, '%PDF') },
  {
    ext: 'docx',
    mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
    image: false,
    check: isZip,
  },
  {
    ext: 'xlsx',
    mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
    image: false,
    check: isZip,
  },
  {
    ext: 'csv',
    mime: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'],
    image: false,
    check: (b) => !b.slice(0, 1024).includes(0),
  },
  { ext: 'txt', mime: ['text/plain'], image: false, check: (b) => !b.slice(0, 1024).includes(0) },
]

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\"]/g, '_').trim().slice(-180)
  return cleaned || 'berkas'
}

function validateFile(name: string, mime: string, bytes: Uint8Array, maxBytes: number) {
  if (!bytes.length) throw new HttpError(400, 'Berkas kosong tidak dapat dilampirkan.')
  if (bytes.length > maxBytes) {
    throw new HttpError(400, `Ukuran berkas maksimum ${Math.round(maxBytes / (1024 * 1024))} MB.`)
  }
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const rule = FILE_RULES.find((item) => item.ext === ext)
  if (!rule) throw new HttpError(400, 'Tipe berkas tidak diizinkan. Gunakan JPG, PNG, WebP, PDF, DOCX, XLSX, CSV, atau TXT.')
  if (mime && !rule.mime.includes(mime.toLowerCase())) {
    throw new HttpError(400, 'Tipe berkas tidak sesuai dengan ekstensinya.')
  }
  if (!rule.check(bytes)) throw new HttpError(400, 'Isi berkas tidak sesuai dengan tipe yang dinyatakan.')
  return { ext: rule.ext === 'jpeg' ? 'jpg' : rule.ext, mime: mime || rule.mime[0], image: rule.image }
}

async function attachmentAccess(env: any, user: SessionUser, attachment: any) {
  const conversation = await conversationById(env, attachment.conversation_id)
  if (!conversation) throw new HttpError(404, 'Lampiran tidak ditemukan.')
  if (conversation.kind === 'direct') {
    if (conversation.user_a !== user.id && conversation.user_b !== user.id) {
      throw new HttpError(403, 'Anda tidak berhak membuka lampiran percakapan ini.')
    }
    return conversation
  }
  const entity = await entityById(env, conversation.entity_id)
  if (!entity) throw new HttpError(404, 'Lampiran tidak ditemukan.')
  if (user.role === 'MA' || user.entity_id === entity.id) {
    if (conversation.project_id) await loadProject(env, user, conversation.project_id)
    return conversation
  }
  throw new HttpError(403, 'Akses lintas entitas ditolak.')
}

chatRoutes.post('/chat/attachments', async (c) => {
  const user = c.get('user')
  const entity = await resolveEntity(c.env, c, user)
  const projectId = c.req.query('project') || null
  const dmId = c.req.query('dm') || null
  const ctx = await loadChatContext(c.env, user, entity, projectId, dmId)
  assertWritable(ctx)
  const settings = await getChatSettings(c.env)
  const maxBytes = Math.min(settings.maxFileMb, 25) * 1024 * 1024

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ error: 'Formulir unggahan tidak valid.' }, 400)
  const files = [...form.getAll('files'), ...form.getAll('file')].filter((item): item is File => item instanceof File)
  if (!files.length) return c.json({ error: 'Tidak ada berkas yang diunggah.' }, 400)
  if (files.length > settings.maxFiles) {
    return c.json({ error: `Maksimal ${settings.maxFiles} lampiran per pesan.` }, 400)
  }

  const created = []
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const safeName = sanitizeName(file.name || 'berkas')
    const meta = validateFile(safeName, file.type || '', bytes, maxBytes)
    const id = uid('att_')
    const objectKey = `chat/${ctx.entity.id}/${ctx.conversation.id}/${id}.${meta.ext}`
    await c.env.FILES.put(objectKey, bytes, {
      httpMetadata: { contentType: meta.mime, cacheControl: 'private, no-store' },
      customMetadata: { entity: ctx.entity.id, conversation: ctx.conversation.id, uploader: user.id },
    })
    await run(
      c.env.DB,
      `INSERT INTO chat_attachments (id, conversation_id, message_id, uploaded_by, object_key, name, mime, size, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, ctx.conversation.id, null, user.id, objectKey, safeName, meta.mime, bytes.length, nowIso(),
    )
    created.push({
      id,
      name: safeName,
      mime: meta.mime,
      size: bytes.length,
      is_image: IMAGE_MIMES.includes(meta.mime),
      url: `/api/chat/attachments/${id}`,
      download_url: `/api/chat/attachments/${id}?download=1`,
    })
  }
  return c.json({ attachments: created })
})

chatRoutes.get('/chat/attachments/:id', async (c) => {
  const user = c.get('user')
  const attachment = await one<any>(c.env.DB, `SELECT * FROM chat_attachments WHERE id = ?`, c.req.param('id'))
  if (!attachment) return c.json({ error: 'Lampiran tidak ditemukan.' }, 404)
  await attachmentAccess(c.env, user, attachment)

  const object = await c.env.FILES.get(attachment.object_key)
  if (!object) return c.json({ error: 'Objek lampiran tidak tersedia.' }, 404)
  const download = c.req.query('download') === '1'
  const headers = new Headers()
  headers.set('content-type', attachment.mime)
  headers.set('content-length', String(attachment.size))
  headers.set('cache-control', 'private, no-store')
  headers.set('x-content-type-options', 'nosniff')
  headers.set(
    'content-disposition',
    `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
  )
  return new Response(object.body, { headers })
})

chatRoutes.delete('/chat/attachments/:id', async (c) => {
  const user = c.get('user')
  const attachment = await one<any>(c.env.DB, `SELECT * FROM chat_attachments WHERE id = ?`, c.req.param('id'))
  if (!attachment) return c.json({ error: 'Lampiran tidak ditemukan.' }, 404)
  if (attachment.uploaded_by !== user.id) throw new HttpError(403, 'Hanya pengunggah yang dapat membatalkan lampiran.')
  if (attachment.message_id) return c.json({ error: 'Lampiran sudah terkirim.' }, 400)
  try { await c.env.FILES.delete(attachment.object_key) } catch { /* ignore */ }
  await run(c.env.DB, `DELETE FROM chat_attachments WHERE id = ?`, attachment.id)
  return c.json({ ok: true })
})
