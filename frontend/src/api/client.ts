import type {
  DhcpConfig,
  DhcpStatus,
  Lease,
  ServerInfo,
  Snapshot,
  SubnetUsage,
  User,
} from './types'

let csrfToken = ''

export function setCsrfToken(token: string) {
  csrfToken = token
}

export function getCsrfToken() {
  return csrfToken
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (init.method && init.method !== 'GET' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const data = await response.json()
      detail = data.detail || JSON.stringify(data)
    } catch {
      detail = await response.text()
    }
    throw new Error(detail)
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

export const api = {
  login(username: string, password: string) {
    return request<{ username: string; role: string; csrf_token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
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
  exportConfig() {
    return request<string>('/api/config/export')
  },
  importConfig(content: string) {
    return request<DhcpConfig>('/api/config/import', {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  },
  snapshots() {
    return request<{ snapshots: Snapshot[] }>('/api/snapshots')
  },
  restoreSnapshot(id: string) {
    return request<{ status: string }>(`/api/snapshots/${id}/restore`, { method: 'POST' })
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
  listUsers() {
    return request<{ users: User[] }>('/api/auth/users')
  },
  updateUsers(users: Array<{ username: string; role: string; password?: string }>) {
    return request<{ users: User[] }>('/api/auth/users', {
      method: 'PUT',
      body: JSON.stringify({ users }),
    })
  },
}
