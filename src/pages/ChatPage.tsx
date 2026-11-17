import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Check, Download, FileSpreadsheet, FileText, FolderKanban, Image as ImageIcon,
  Loader2, MessagesSquare, Paperclip, Plus, RefreshCw, Search, Send, Trash2, Users, WifiOff, X,
} from 'lucide-react'
import { api, qs } from '../lib/api'
import { useApp, useDebounced } from '../lib/app-context'
import type { ChatAttachment, ChatChannel, ChatMessage, ChatPeer } from '../lib/types'
import { Avatar, ConfirmDialog, EmptyState, LoadingBlock, Modal, Spinner, cn } from '../components/ui'
import { addDaysIso, formatDate } from '../lib/format'

const ROLE_LABEL: Record<string, string> = { MA: 'Master Admin', SA: 'Super Admin', PA: 'Anggota' }
const MAX_FILES = 5
const MAX_FILE_MB = 10
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'docx', 'xlsx', 'csv', 'txt']

type UploadItem = { key: string; name: string; size: number; progress: number; error: string | null }

function jakartaDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

function jakartaTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

function dayLabel(iso: string): string {
  const day = jakartaDay(iso)
  const today = jakartaDay(new Date().toISOString())
  if (day === today) return 'Hari ini'
  if (day === addDaysIso(today, -1)) return 'Kemarin'
  return formatDate(day, 'long')
}

function listStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const day = jakartaDay(iso)
  const today = jakartaDay(new Date().toISOString())
  if (day === today) return jakartaTime(iso)
  if (day === addDaysIso(today, -1)) return 'Kemarin'
  return formatDate(day, 'short')
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function channelPreview(channel: ChatChannel): string {
  const last = channel.last_message
  if (!last) return channel.kind === 'direct' ? 'Mulai percakapan pribadi' : 'Belum ada pesan'
  if (last.body) return `${last.user_name?.split(' ')[0] ?? 'Pengguna'}: ${last.body}`
  return last.attachment_count ? `${last.user_name?.split(' ')[0] ?? 'Pengguna'} mengirim ${last.attachment_count} lampiran` : ''
}

export function ChatPage() {
  const { entity } = useParams<{ entity: string }>()
  const entityKey = entity ?? 'yayasan'
  const { me, toast } = useApp()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project')
  const dmId = params.get('dm')
  const selectedChannelKey = dmId ? `dm:${dmId}` : projectId ? `project:${projectId}` : 'entity'

  const [channels, setChannels] = useState<ChatChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [mobileOpen, setMobileOpen] = useState(Boolean(projectId || dmId))

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(true)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [channelMeta, setChannelMeta] = useState<any>(null)
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [newDmOpen, setNewDmOpen] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastMarkedRef = useRef<string | null>(null)
  const attachmentsRef = useRef<ChatAttachment[]>([])

  attachmentsRef.current = attachments

  const conversationQuery = useMemo(
    () => qs({ entity: entityKey, project: projectId ?? undefined, dm: dmId ?? undefined }),
    [entityKey, projectId, dmId],
  )

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      const list = listRef.current
      if (!list) return
      list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    })
  }, [])

  const loadChannels = useCallback(async () => {
    try {
      const data = await api.get<{ channels: ChatChannel[] }>(`/api/chat/channels${qs({ entity: entityKey })}`)
      setChannels(data.channels)
      setChannelsError(null)
    } catch (err: any) {
      if (err?.status !== 401) setChannelsError(err?.message ?? 'Gagal memuat daftar percakapan')
    } finally {
      setChannelsLoading(false)
    }
  }, [entityKey])

  const loadMessages = useCallback(
    async (initial = false) => {
      const list = listRef.current
      const nearBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 150
      try {
        const data = await api.get<{
          messages: ChatMessage[]
          channel: any
          has_more: boolean
          peer_last_read_at: string | null
        }>(`/api/chat/messages${conversationQuery}${conversationQuery ? '&' : '?'}limit=80`)
        setMessages(data.messages)
        setChannelMeta(data.channel)
        setPeerReadAt(data.peer_last_read_at ?? null)
        setHasMore(data.has_more)
        setMessagesError(null)
        if (initial || nearBottom) scrollToBottom(!initial)
        const last = data.messages[data.messages.length - 1]
        if (last && lastMarkedRef.current !== last.id) {
          lastMarkedRef.current = last.id
          await api
            .post(`/api/chat/read${qs({ entity: entityKey })}`, {
              projectId: projectId ?? undefined,
              dmConversationId: dmId ?? undefined,
            })
            .catch(() => null)
          setChannels((prev) => prev.map((ch) => (channelSelectionKey(ch) === selectedChannelKey ? { ...ch, unread: 0 } : ch)))
        }
      } catch (err: any) {
        if (err?.status !== 401) setMessagesError(err?.message ?? 'Gagal memuat pesan')
      } finally {
        setMessagesLoading(false)
      }
    },
    [conversationQuery, entityKey, projectId, dmId, scrollToBottom, selectedChannelKey],
  )

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  useEffect(() => {
    lastMarkedRef.current = null
    setMessages([])
    setMessagesLoading(true)
    setMessagesError(null)
    setDraft('')
    setAttachments([])
    setUploads([])
    setHasMore(false)
    loadMessages(true)
    const timer = setInterval(() => {
      if (!document.hidden) loadMessages(false)
    }, 6000)
    return () => clearInterval(timer)
  }, [loadMessages])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // Drop queued uploads when leaving the page.
  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      fetch(`/api/chat/attachments/${attachment.id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null)
    }
  }, [])

  const activeChannel = channels.find((ch) => channelSelectionKey(ch) === selectedChannelKey)
  const totalUnread = channels.reduce((sum, ch) => sum + ch.unread, 0)
  const isReadOnly = Boolean(channelMeta?.is_read_only ?? activeChannel?.is_read_only)
  const uploading = uploads.some((item) => !item.error)

  function selectChannel(channel: ChatChannel) {
    discardQueued()
    setMobileOpen(true)
    if (channel.kind === 'direct') setParams({ dm: channel.conversation_id })
    else if (channel.project_id) setParams({ project: channel.project_id })
    else setParams({})
  }

  function discardQueued() {
    for (const attachment of attachments) {
      fetch(`/api/chat/attachments/${attachment.id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null)
    }
    setAttachments([])
  }

  async function loadOlder() {
    const first = messages[0]
    if (!first || loadingOlder) return
    setLoadingOlder(true)
    const list = listRef.current
    const previousHeight = list?.scrollHeight ?? 0
    const previousTop = list?.scrollTop ?? 0
    try {
      const data = await api.get<{ messages: ChatMessage[]; has_more: boolean }>(
        `/api/chat/messages${conversationQuery}${conversationQuery ? '&' : '?'}limit=60&before=${encodeURIComponent(first.created_at)}&beforeId=${encodeURIComponent(first.id)}`,
      )
      setMessages((prev) => [...data.messages, ...prev])
      setHasMore(data.has_more)
      requestAnimationFrame(() => {
        if (!listRef.current) return
        listRef.current.scrollTop = listRef.current.scrollHeight - previousHeight + previousTop
      })
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memuat pesan lama', 'error')
    } finally {
      setLoadingOlder(false)
    }
  }

  function validateFiles(files: File[]): File[] {
    const remaining = MAX_FILES - attachments.length - uploads.filter((u) => !u.error).length
    const accepted: File[] = []
    for (const file of files) {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      if (!ALLOWED_EXT.includes(ext)) {
        toast(`${file.name}: tipe berkas tidak didukung.`, 'error')
        continue
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast(`${file.name}: melebihi ${MAX_FILE_MB} MB.`, 'error')
        continue
      }
      if (accepted.length >= remaining) {
        toast(`Maksimal ${MAX_FILES} lampiran per pesan.`, 'error')
        break
      }
      accepted.push(file)
    }
    return accepted
  }

  function uploadOne(file: File, key: string): Promise<ChatAttachment> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/chat/attachments${conversationQuery}`)
      xhr.withCredentials = true
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const progress = Math.round((event.loaded / event.total) * 100)
        setUploads((prev) => prev.map((item) => (item.key === key ? { ...item, progress } : item)))
      }
      xhr.onload = () => {
        let data: any = null
        try { data = JSON.parse(xhr.responseText) } catch { data = null }
        if (xhr.status >= 200 && xhr.status < 300 && data?.attachments?.[0]) {
          resolve(data.attachments[0] as ChatAttachment)
        } else {
          reject(new Error(data?.error ?? `Unggahan gagal (${xhr.status}).`))
        }
      }
      xhr.onerror = () => reject(new Error('Koneksi terputus saat mengunggah berkas.'))
      xhr.ontimeout = () => reject(new Error('Waktu unggah habis. Coba lagi.'))
      const form = new FormData()
      form.append('files', file)
      xhr.send(form)
    })
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    if (isReadOnly) {
      toast('Ruang diskusi proyek yang diarsipkan hanya dapat dibaca.', 'error')
      return
    }
    const files = validateFiles(Array.from(fileList))
    if (fileRef.current) fileRef.current.value = ''
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`
      setUploads((prev) => [...prev, { key, name: file.name, size: file.size, progress: 0, error: null }])
      try {
        const attachment = await uploadOne(file, key)
        setAttachments((prev) => [...prev, attachment])
        setUploads((prev) => prev.filter((item) => item.key !== key))
      } catch (err: any) {
        const message = err?.message ?? 'Gagal mengunggah berkas.'
        setUploads((prev) => prev.map((item) => (item.key === key ? { ...item, error: message } : item)))
        toast(message, 'error')
      }
    }
  }

  async function removeAttachment(attachment: ChatAttachment) {
    setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))
    await api.del(`/api/chat/attachments/${attachment.id}`).catch(() => null)
  }

  async function send() {
    const body = draft.trim()
    if ((!body && !attachments.length) || sending || uploading || isReadOnly) return
    setSending(true)
    try {
      const clientToken = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const res = await api.post<{ message: ChatMessage }>(
        `/api/chat/messages${qs({ entity: entityKey })}`,
        {
          body,
          projectId: projectId ?? undefined,
          dmConversationId: dmId ?? undefined,
          attachmentIds: attachments.map((item) => item.id),
          clientToken,
        },
      )
      setMessages((prev) => [...prev, res.message])
      setDraft('')
      setAttachments([])
      lastMarkedRef.current = res.message.id
      scrollToBottom(true)
      loadChannels()
    } catch (err: any) {
      toast(err?.message ?? 'Pesan gagal dikirim', 'error')
    } finally {
      setSending(false)
    }
  }

  async function removeMessage() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.del(`/api/chat/messages/${deleteTarget.id}`)
      setMessages((prev) => prev.filter((m) => m.id !== deleteTarget.id))
      setDeleteTarget(null)
      toast('Pesan dihapus.')
      loadChannels()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menghapus pesan', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function startDirect(peer: ChatPeer) {
    try {
      const data = await api.post<{ conversation: { id: string } }>(
        `/api/chat/dm${qs({ entity: entityKey })}`,
        { userId: peer.id },
      )
      discardQueued()
      setNewDmOpen(false)
      setMobileOpen(true)
      setParams({ dm: data.conversation.id })
      await loadChannels()
    } catch (err: any) {
      toast(err?.message ?? 'Gagal membuka percakapan pribadi', 'error')
    }
  }

  const filtered = channels.filter((channel) => {
    if (!query.trim()) return true
    const haystack = `${channel.name} ${channel.code ?? ''} ${channel.peer?.job_title ?? ''} ${channel.last_message?.body ?? ''}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })
  const projectChannels = filtered.filter((ch) => ch.sections === 'project')
  const directChannels = filtered.filter((ch) => ch.sections === 'direct')

  return (
    <div className="space-y-4">
      <div className={cn('flex flex-wrap items-end justify-between gap-3', mobileOpen && 'hidden lg:flex')}>
        <div className="min-w-0">
          <p className="mb-1 hidden text-[11px] font-semibold tracking-[0.14em] text-forest uppercase sm:block">Komunikasi</p>
          <h1 className="text-xl font-semibold text-ink sm:text-[28px]">Obrolan Tim</h1>
          <p className="mt-1 hidden max-w-2xl text-sm text-muted sm:block">
            Kanal proyek dan pesan pribadi antar anggota entitas. Lampiran disimpan privat dan hanya bisa dibuka peserta percakapan.
          </p>
        </div>
        <span className="chip shrink-0">
          <Users className="h-3.5 w-3.5" />
          {totalUnread > 0 ? `${totalUnread} pesan belum dibaca` : 'Semua pesan terbaca'}
        </span>
      </div>

      {!online && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <WifiOff className="h-4 w-4" /> Koneksi terputus. Pesan akan dicoba lagi saat jaringan pulih.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Conversation list */}
        <aside
          className={cn(
            'card min-w-0 flex-col overflow-hidden',
            mobileOpen ? 'hidden lg:flex' : 'flex',
            'lg:h-[calc(100dvh-230px)]',
          )}
        >
          <div className="space-y-2.5 border-b border-line px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">Percakapan</p>
                <p className="text-[11px] text-muted">Proyek & pesan langsung</p>
              </div>
              <button className="btn-primary btn-sm" onClick={() => setNewDmOpen(true)} title="Pesan langsung baru">
                <Plus className="h-3.5 w-3.5" /> Pesan
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                className="input py-2 pl-9 text-sm"
                placeholder="Cari percakapan…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {channelsLoading ? (
              <div className="flex justify-center px-3 py-8"><Spinner /></div>
            ) : channelsError ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-red-600">{channelsError}</p>
                <button className="btn-secondary btn-sm mt-3" onClick={loadChannels}>
                  <RefreshCw className="h-3.5 w-3.5" /> Coba lagi
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <ChannelSection
                  title="Proyek"
                  channels={projectChannels}
                  selected={selectedChannelKey}
                  onSelect={selectChannel}
                />
                <ChannelSection
                  title="Pesan Langsung"
                  channels={directChannels}
                  selected={selectedChannelKey}
                  onSelect={selectChannel}
                  action={
                    <button
                      onClick={() => setNewDmOpen(true)}
                      className="rounded-full p-1 text-muted hover:bg-forest-50 hover:text-forest"
                      title="Pesan langsung baru"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  }
                  emptyLabel="Belum ada pesan pribadi. Mulai dengan tombol +."
                />
              </div>
            )}
          </div>
        </aside>

        {/* Conversation */}
        <section
          className={cn(
            'card min-w-0 flex-col overflow-hidden',
            mobileOpen ? 'flex' : 'hidden lg:flex',
            'h-[calc(100dvh-200px)] min-h-[440px] lg:h-[calc(100dvh-230px)]',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                className="rounded-full p-1.5 text-muted hover:bg-canvas lg:hidden"
                onClick={() => {
                  setMobileOpen(false)
                  setParams({})
                }}
                aria-label="Kembali ke daftar percakapan"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              {activeChannel?.peer ? (
                <Avatar name={activeChannel.peer.name} url={activeChannel.peer.avatar_url} size={36} />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest">
                  {projectId ? <FolderKanban className="h-4 w-4" /> : <MessagesSquare className="h-4 w-4" />}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {activeChannel?.peer?.name ?? activeChannel?.name ?? channelMeta?.name ?? 'Obrolan'}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {activeChannel?.peer
                    ? [activeChannel.peer.job_title, activeChannel.peer.role ? ROLE_LABEL[activeChannel.peer.role] : null].filter(Boolean).join(' · ')
                    : activeChannel?.code
                      ? `${activeChannel.code} · ${isReadOnly ? 'Diarsipkan (hanya baca)' : 'Khusus peserta proyek'}`
                      : 'Seluruh anggota entitas'}
                </p>
              </div>
            </div>
            <span className="hidden shrink-0 text-[11px] text-muted sm:block">{isReadOnly ? 'Hanya baca' : 'Diperbarui otomatis'}</span>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-canvas/40 px-3 py-4 sm:px-5">
            {messagesLoading ? (
              <LoadingBlock label="Memuat pesan…" />
            ) : messagesError ? (
              <div className="py-10 text-center">
                <p className="text-sm text-red-600">{messagesError}</p>
                <button className="btn-secondary btn-sm mt-3" onClick={() => loadMessages(true)}>
                  <RefreshCw className="h-3.5 w-3.5" /> Muat ulang
                </button>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState
                icon={MessagesSquare}
                title="Belum ada pesan"
                description={
                  dmId
                    ? 'Ini awal percakapan pribadi Anda. Hanya Anda dan lawan bicara yang dapat melihat pesan ini.'
                    : projectId
                      ? 'Mulai diskusi proyek ini: bagikan kendala, keputusan, atau tindak lanjut.'
                      : 'Sapa tim Anda dan mulai koordinasi harian di kanal entitas.'
                }
              />
            ) : (
              <div className="space-y-1">
                {hasMore && (
                  <div className="flex justify-center pb-2">
                    <button className="btn-secondary btn-sm" onClick={loadOlder} disabled={loadingOlder}>
                      {loadingOlder ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} Muat pesan lebih lama
                    </button>
                  </div>
                )}
                {messages.map((message, index) => {
                  const previous = messages[index - 1]
                  const mine = message.user_id === me?.user.id
                  const newDay = !previous || jakartaDay(previous.created_at) !== jakartaDay(message.created_at)
                  const grouped = !!previous && !newDay && previous.user_id === message.user_id
                  const lastOwn = mine && index === messages.length - 1
                  return (
                    <div key={message.id}>
                      {newDay && (
                        <div className="my-4 flex items-center gap-3">
                          <span className="h-px flex-1 bg-line" />
                          <span className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[10px] font-medium text-muted">
                            {dayLabel(message.created_at)}
                          </span>
                          <span className="h-px flex-1 bg-line" />
                        </div>
                      )}
                      <div className={cn('group flex gap-2.5', mine ? 'flex-row-reverse' : 'flex-row', grouped ? 'mt-1' : 'mt-3')}>
                        <div className="w-8 shrink-0">
                          {!grouped && <Avatar name={message.user_name} url={message.user_avatar_url} size={32} />}
                        </div>
                        <div className={cn('min-w-0 max-w-[85%] sm:max-w-[78%]', mine ? 'items-end text-right' : 'items-start')}>
                          {!grouped && (
                            <div className={cn('mb-1 flex flex-wrap items-center gap-1.5 text-[11px]', mine && 'justify-end')}>
                              <span className="font-semibold text-ink">{mine ? 'Anda' : message.user_name ?? 'Pengguna'}</span>
                              {message.user_role && (
                                <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium text-muted ring-1 ring-line">
                                  {ROLE_LABEL[message.user_role] ?? message.user_role}
                                </span>
                              )}
                              <span className="text-muted">{jakartaTime(message.created_at)}</span>
                            </div>
                          )}
                          <div
                            className={cn(
                              'inline-block max-w-full rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed break-words whitespace-pre-wrap',
                              mine
                                ? 'rounded-br-md bg-forest text-white'
                                : 'rounded-bl-md border border-line bg-white text-ink',
                            )}
                          >
                            {message.body}
                            {message.attachments.length > 0 && (
                              <MessageAttachments attachments={message.attachments} mine={mine} />
                            )}
                          </div>
                          <div className={cn('mt-0.5 flex items-center gap-2', mine && 'justify-end')}>
                            {grouped && <span className="text-[10px] text-muted">{jakartaTime(message.created_at)}</span>}
                            {lastOwn && dmId && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                                {peerReadAt && peerReadAt >= message.created_at ? (
                                  <><Check className="h-3 w-3 text-forest" /> Dibaca</>
                                ) : 'Terkirim'}
                              </span>
                            )}
                            {(mine || (!dmId && (me?.user.role === 'MA' || me?.user.role === 'SA'))) && (
                              <button
                                onClick={() => setDeleteTarget(message)}
                                className="rounded-full p-1 text-muted/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100"
                                title="Hapus pesan"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t border-line bg-white px-3 py-3 sm:px-4">
            {isReadOnly ? (
              <p className="rounded-xl border border-line bg-canvas px-3 py-2.5 text-center text-xs text-muted">
                Proyek ini sudah diarsipkan. Ruang diskusi hanya dapat dibaca.
              </p>
            ) : (
              <>
                {(attachments.length > 0 || uploads.length > 0) && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {attachments.map((attachment) => (
                      <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] text-ink">
                        {attachment.is_image ? <ImageIcon className="h-3.5 w-3.5 text-forest" /> : <FileText className="h-3.5 w-3.5 text-forest" />}
                        <span className="max-w-[140px] truncate">{attachment.name}</span>
                        <button onClick={() => removeAttachment(attachment)} className="text-muted hover:text-red-600" title="Batalkan lampiran">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {uploads.map((upload) => (
                      <span
                        key={upload.key}
                        className={cn(
                          'inline-flex max-w-full flex-col gap-1 rounded-xl border px-2.5 py-1 text-[11px]',
                          upload.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-line bg-canvas text-ink',
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {upload.error ? <X className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-forest" />}
                          <span className="max-w-[140px] truncate">{upload.name}</span>
                          <span className="text-muted">{upload.error ? 'gagal' : `${upload.progress}%`}</span>
                          {upload.error && (
                            <button
                              className="text-muted hover:text-red-700"
                              onClick={() => setUploads((prev) => prev.filter((item) => item.key !== upload.key))}
                              title="Tutup"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                        {!upload.error && (
                          <span className="h-1 w-32 overflow-hidden rounded-full bg-line">
                            <span className="block h-full rounded-full bg-forest transition-all" style={{ width: `${upload.progress}%` }} />
                          </span>
                        )}
                        {upload.error && <span className="max-w-[220px] leading-snug">{upload.error}</span>}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.csv,.txt,image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    onChange={(event) => handleFiles(event.target.files)}
                  />
                  <button
                    className="btn-secondary shrink-0 p-2.5"
                    onClick={() => fileRef.current?.click()}
                    disabled={!!uploading || attachments.length >= MAX_FILES}
                    title="Lampirkan berkas"
                    aria-label="Lampirkan berkas"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        send()
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    placeholder={dmId ? 'Tulis pesan pribadi…' : projectId ? 'Tulis pesan untuk tim proyek ini…' : 'Tulis pesan untuk tim entitas…'}
                    className="input max-h-32 min-h-[46px] resize-none py-3"
                  />
                  <button
                    className="btn-primary shrink-0"
                    onClick={send}
                    disabled={sending || uploading || (!draft.trim() && !attachments.length)}
                    aria-label="Kirim pesan"
                  >
                    {sending ? <Spinner /> : <Send className="h-4 w-4" />}
                    <span className="hidden sm:inline">Kirim</span>
                  </button>
                </div>
                <p className="mt-1.5 px-1 text-[10px] text-muted">
                  Enter mengirim · Shift + Enter baris baru · Lampiran maks. {MAX_FILES} berkas, {MAX_FILE_MB} MB per berkas
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus pesan?"
        description="Pesan akan dihapus dari percakapan ini untuk semua peserta. Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Hapus pesan"
        danger
        busy={deleting}
        onConfirm={removeMessage}
        onCancel={() => setDeleteTarget(null)}
      />

      <NewDirectMessage
        open={newDmOpen}
        entityKey={entityKey}
        onClose={() => setNewDmOpen(false)}
        onSelect={startDirect}
      />
    </div>
  )
}

function channelSelectionKey(channel: ChatChannel): string {
  return channel.kind === 'direct' ? `dm:${channel.conversation_id}` : channel.key
}

function ChannelSection({
  title, channels, selected, onSelect, action, emptyLabel,
}: {
  title: string
  channels: ChatChannel[]
  selected: string
  onSelect: (channel: ChatChannel) => void
  action?: ReactNode
  emptyLabel?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">{title}</p>
        {action}
      </div>
      <div className="space-y-1">
        {channels.map((channel) => (
          <ChannelRow
            key={channel.key}
            channel={channel}
            active={channelSelectionKey(channel) === selected}
            onSelect={() => onSelect(channel)}
          />
        ))}
        {channels.length === 0 && <p className="px-2 py-1.5 text-[11px] text-muted">{emptyLabel ?? 'Belum ada percakapan.'}</p>}
      </div>
    </div>
  )
}

function ChannelRow({ channel, active, onSelect }: { channel: ChatChannel; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
        active ? 'bg-forest-50' : 'hover:bg-canvas',
      )}
    >
      {channel.peer ? (
        <Avatar name={channel.peer.name} url={channel.peer.avatar_url} size={32} className="mt-0.5" />
      ) : (
        <span
          className={cn(
            'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
            active ? 'bg-forest text-white' : 'bg-canvas text-muted',
          )}
        >
          {channel.kind === 'entity' ? <MessagesSquare className="h-4 w-4" /> : <FolderKanban className="h-4 w-4" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-[13px] font-medium', active ? 'text-forest' : 'text-ink')}>{channel.name}</span>
          {channel.unread > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-forest px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {channel.unread > 9 ? '9+' : channel.unread}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-1">
          <span className="min-w-0 truncate text-[11px] text-muted">{channelPreview(channel)}</span>
          <span className="shrink-0 text-[10px] text-muted">{listStamp(channel.last_message?.created_at)}</span>
        </span>
        {channel.peer && (
          <span className="mt-0.5 block truncate text-[10px] text-muted/80">
            {channel.peer.job_title ?? ROLE_LABEL[channel.peer.role] ?? 'Anggota'}
          </span>
        )}
      </span>
    </button>
  )
}

function MessageAttachments({ attachments, mine }: { attachments: ChatAttachment[]; mine: boolean }) {
  const images = attachments.filter((item) => item.is_image)
  const documents = attachments.filter((item) => !item.is_image)
  return (
    <div className="mt-2 space-y-1.5">
      {images.length > 0 && (
        <div className={cn('grid gap-1.5', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {images.map((image) => (
            <a
              key={image.id}
              href={image.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border border-black/10"
              title={`${image.name} · ${formatBytes(image.size)}`}
            >
              <img src={image.url} alt={image.name} loading="lazy" className="max-h-56 w-full object-cover" />
            </a>
          ))}
        </div>
      )}
      {documents.map((document) => (
        <a
          key={document.id}
          href={document.download_url}
          className={cn(
            'flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors',
            mine ? 'border-white/25 bg-white/10 hover:bg-white/20' : 'border-line bg-canvas hover:border-forest/30',
          )}
          title={`Unduh ${document.name}`}
        >
          <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', mine ? 'bg-white/15 text-white' : 'bg-white text-forest')}>
            {document.mime.includes('sheet') || document.mime.includes('csv') ? (
              <FileSpreadsheet className="h-4 w-4" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block max-w-[220px] truncate text-[12px] font-medium">{document.name}</span>
            <span className={cn('block text-[10px]', mine ? 'text-white/70' : 'text-muted')}>
              {document.name.split('.').pop()?.toUpperCase()} · {formatBytes(document.size)}
            </span>
          </span>
          <Download className={cn('h-3.5 w-3.5 shrink-0', mine ? 'text-white/80' : 'text-muted')} />
        </a>
      ))}
    </div>
  )
}

function NewDirectMessage({
  open, entityKey, onClose, onSelect,
}: {
  open: boolean
  entityKey: string
  onClose: () => void
  onSelect: (peer: ChatPeer) => void
}) {
  const { toast } = useApp()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const [users, setUsers] = useState<ChatPeer[]>([])
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    api
      .get<{ users: ChatPeer[] }>(`/api/chat/users${qs({ entity: entityKey, q: debounced })}`)
      .then((data) => { if (alive) setUsers(data.users) })
      .catch((err) => { if (alive) toast(err?.message ?? 'Gagal memuat daftar anggota', 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, debounced, entityKey, toast])

  useEffect(() => {
    if (!open) {
      setSearch('')
      setUsers([])
    }
  }, [open])

  return (
    <Modal open={open} onClose={onClose} title="Pesan langsung baru" description="Pilih anggota dari entitas yang sama. Hanya Anda dan penerima yang dapat melihat percakapan ini.">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="Cari nama, email, atau jabatan…"
            value={search}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="max-h-[340px] space-y-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : users.length === 0 ? (
            <EmptyState icon={Users} title="Anggota tidak ditemukan" description="Coba kata kunci lain atau pastikan anggota sudah terdaftar di entitas ini." />
          ) : (
            users.map((user) => (
              <button
                key={user.id}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-canvas disabled:opacity-60"
                disabled={starting === user.id}
                onClick={() => { setStarting(user.id); onSelect(user) }}
              >
                <Avatar name={user.name} url={user.avatar_url} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {user.job_title ?? ROLE_LABEL[user.role] ?? 'Anggota'}
                  </span>
                </span>
                {starting === user.id ? <Spinner /> : <MessagesSquare className="h-4 w-4 text-muted" />}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
