export interface User {
  username: string
  role: 'admin' | 'viewer'
}

export interface SubnetUsage {
  id: string
  network: string
  netmask: string
  name: string | null
  range_start: string | null
  range_end: string | null
  total: number
  used: number
  free: number
  utilization_pct: number
}

export interface Lease {
  ip: string
  mac: string | null
  hostname: string | null
  starts: string | null
  ends: string | null
  binding_state: string | null
  subnet_id: string | null
  subnet_network: string | null
}

export interface DhcpRange {
  start: string
  end: string
}

export interface DhcpSubnet {
  id: string
  network: string
  netmask: string
  name: string | null
  range: DhcpRange | null
  options: Record<string, unknown>
}

export interface DhcpHost {
  id: string
  name: string
  hardware_address: string
  fixed_address: string
  options: Record<string, unknown>
}

export interface DhcpConfig {
  global_options: Record<string, unknown>
  subnets: DhcpSubnet[]
  hosts: DhcpHost[]
  option_definitions: string[]
  authoritative: boolean
  ddns_update_style: string | null
  log_facility: string
}

export interface Snapshot {
  id: string
  created_at: string
  has_config_json: boolean
  has_dhcpd_conf: boolean
}

export interface ServerInfo {
  name: string
  interface: string
  http_port: number
  data_dir: string
}

export interface DhcpStatus {
  managed_by: string
  running: boolean
  detail: string
}
