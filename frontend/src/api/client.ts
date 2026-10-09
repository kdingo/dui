import type {
  DhcpConfig,
  DhcpStatus,
  Lease,
  ServerInfo,
  Snapshot,
  SubnetUsage,
  PasswordPolicy,
  SyslogConfig,
  User,
} from './types'

let csrfToken = ''

export function setCsrfToken(token: string) {
  csrfToken = token
}

export function getCsrfToken() {
  return csrfToken
}

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

function csrfFromCookie() {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.split('; ').find((row) => row.startsWith('dui_csrf='))
  return match ? decodeURIComponent(match.slice('dui_csrf='.length)) : ''
}

/** One FastAPI/pydantic validation problem; `type` and `ctx` are what the UI translates. */
export interface ApiErrorItem {
  loc?: (string | number)[]
  msg?: string
  type?: string
  ctx?: Record<string, unknown>
}

/** Error body: `code` + `params` name a message in locales/<lang> under `server.*` (see backend app/errors.py). */
export interface ApiErrorBody {
  detail?: string | ApiErrorItem[]
  code?: string
  params?: Record<string, unknown>
  errors?: ApiErrorItem[]
  cause?: ApiErrorBody
}

/** `message` is the server's English text; use `errorMessage()` from i18n/apiError to show it translated. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiError(response: Response): Promise<ApiError> {
  let detail = response.statusText
  let body: ApiErrorBody = {}
  const text = await response.text()
  try {
    body = JSON.parse(text)
    if (Array.isArray(body.detail)) {
      // FastAPI validation errors: [{ loc, msg }, ...]
      detail = body.detail
        .map((item) => {
          const field = item.loc?.filter((part) => part !== 'body').join('.')
          return field ? `${field}: ${item.msg}` : item.msg
        })
        .join('; ')
    } else {
      detail = body.detail || text
    }
  } catch {
    detail = text || detail
  }
  return new ApiError(detail, response.status, body)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (init.body && !headers.has('Content-Type') && !isFormData) {
    headers.set('Content-Type', 'application/json')
  }
  const token = csrfToken || csrfFromCookie()
  if (init.method && init.method !== 'GET' && token) {
    headers.set('X-CSRF-Token', token)
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') {
      unauthorizedHandler?.()
    }
    throw await apiError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return response.text() as T
}

interface SessionResponse {
  username: string
  role: string
  csrf_token: string
  must_change_password: boolean
}

export const api = {
  login(username: string, password: string) {
    return request<SessionResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },
  changePassword(current_password: string, new_password: string) {
    return request<SessionResponse>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    })
  },
  logout() {
    return request<{ status: string }>('/api/auth/logout', { method: 'POST' })
  },
  me() {
    return request<User>('/api/auth/me')
  },
  dashboard() {
    return request<{ server_name: string; subnets: SubnetUsage[] }>('/api/dashboard')
  },
  leases(subnet?: string) {
    const query = subnet ? `?subnet=${encodeURIComponent(subnet)}` : ''
    return request<{ leases: Lease[] }>(`/api/leases${query}`)
  },
  logs(tail = 500) {
    return request<{ lines: string[]; path: string }>(`/api/logs/dhcp?tail=${tail}`)
  },
  getConfig() {
    return request<DhcpConfig>('/api/config')
  },
  saveConfig(config: DhcpConfig) {
    return request<DhcpConfig>('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  },
  updateOptions(global_options: Record<string, unknown>) {
    return request<DhcpConfig>('/api/config/options', {
      method: 'PUT',
      body: JSON.stringify({ global_options }),
    })
  },
  addSubnet(subnet: Omit<DhcpConfig['subnets'][0], 'id'>) {
    return request<DhcpConfig>('/api/config/subnets', {
      method: 'POST',
      body: JSON.stringify(subnet),
    })
  },
  updateSubnet(id: string, subnet: Omit<DhcpConfig['subnets'][0], 'id'>) {
    return request<DhcpConfig>(`/api/config/subnets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(subnet),
    })
  },
  deleteSubnet(id: string) {
    return request<DhcpConfig>(`/api/config/subnets/${id}`, { method: 'DELETE' })
  },
  addHost(host: Omit<DhcpConfig['hosts'][0], 'id'>) {
    return request<DhcpConfig>('/api/config/hosts', {
      method: 'POST',
      body: JSON.stringify(host),
    })
  },
  updateHost(id: string, host: Omit<DhcpConfig['hosts'][0], 'id'>) {
    return request<DhcpConfig>(`/api/config/hosts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(host),
    })
  },
  deleteHost(id: string) {
    return request<DhcpConfig>(`/api/config/hosts/${id}`, { method: 'DELETE' })
  },
  exportDhcpdConf() {
    return request<string>('/api/config/dhcpd-conf')
  },
  async exportConfig() {
    const response = await fetch('/api/config/export', { credentials: 'include' })
    if (!response.ok) {
      if (response.status === 401) {
        unauthorizedHandler?.()
      }
      throw await apiError(response)
    }
    return response.blob()
  },
  importConfig(content: string) {
    return request<DhcpConfig>('/api/config/import', {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  },
  importConfigZip(file: File) {
    const body = new FormData()
    body.append('file', file)
    return request<DhcpConfig>('/api/config/import-zip', {
      method: 'POST',
      body,
    })
  },
  snapshots() {
    return request<{ snapshots: Snapshot[] }>('/api/snapshots')
  },
  snapshotDhcpdConf(id: string) {
    return request<string>(`/api/snapshots/${id}/dhcpd-conf`)
  },
  restoreSnapshot(id: string) {
    return request<{ status: string }>(`/api/snapshots/${id}/restore`, { method: 'POST' })
  },
  deleteSnapshot(id: string) {
    return request<{ status: string }>(`/api/snapshots/${id}`, { method: 'DELETE' })
  },
  serverInfo() {
    return request<ServerInfo>('/api/admin/server')
  },
  updateServerName(name: string) {
    return request<{ name: string }>('/api/admin/server', {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
  },
  dhcpStatus() {
    return request<DhcpStatus>('/api/admin/dhcp/status')
  },
  dhcpControl(action: 'start' | 'stop' | 'restart') {
    return request<{ status: string }>(`/api/admin/dhcp/${action}`, { method: 'POST' })
  },
  containerStop() {
    return request<{ status: string }>('/api/admin/container/stop', { method: 'POST' })
  },
  containerRestart() {
    return request<{ status: string }>('/api/admin/container/restart', { method: 'POST' })
  },
  passwordPolicy() {
    return request<PasswordPolicy>('/api/auth/password-policy')
  },
  updatePasswordPolicy(policy: PasswordPolicy) {
    return request<PasswordPolicy>('/api/auth/password-policy', {
      method: 'PUT',
      body: JSON.stringify(policy),
    })
  },
  syslogConfig() {
    return request<SyslogConfig>('/api/admin/syslog')
  },
  updateSyslogConfig(config: SyslogConfig) {
    return request<SyslogConfig>('/api/admin/syslog', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  },
  testSyslog(config: SyslogConfig) {
    return request<{ status: string }>('/api/admin/syslog/test', {
      method: 'POST',
      body: JSON.stringify(config),
    })
  },
  listUsers() {
    return request<{ users: User[] }>('/api/auth/users')
  },
  createUser(user: { username: string; role: User['role']; password: string }) {
    return request<{ users: User[] }>('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify(user),
    })
  },
  updateUser(username: string, payload: { role?: User['role']; password?: string }) {
    return request<{ users: User[] }>(`/api/auth/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
  deleteUser(username: string) {
    return request<{ users: User[] }>(`/api/auth/users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    })
  },
}
