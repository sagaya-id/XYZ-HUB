export class ApiError extends Error {
  status: number
  code?: string
  payload?: any
  constructor(message: string, status: number, code?: string, payload?: any) {
    super(message)
    this.status = status
    this.code = code
    this.payload = payload
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Permintaan gagal (${res.status})`, res.status, data?.code, data)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: any) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: any) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export async function uploadFile(
  file: File,
  opts: { projectId?: string; entityId?: string; visibility?: 'team' | 'entity' } = {},
): Promise<{ id: string; name: string; mime: string; size: number; url: string }> {
  const form = new FormData()
  form.append('file', file)
  if (opts.projectId) form.append('projectId', opts.projectId)
  if (opts.entityId) form.append('entityId', opts.entityId)
  if (opts.visibility) form.append('visibility', opts.visibility)
  const res = await request<{ file: any }>('/api/files', { method: 'POST', body: form })
  return res.file
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const str = search.toString()
  return str ? `?${str}` : ''
}
