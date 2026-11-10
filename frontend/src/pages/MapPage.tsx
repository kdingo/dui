import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { DhcpConfig, DhcpHost, Lease } from '../api/types'
import { AutoRefreshControls } from '../components/AutoRefreshControls'
import { Flash } from '../components/Flash'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { errorMessage } from '../i18n/apiError'
import { cellOf, d2xy, forEachCell, gridFor, groupSpans, viewBlock, xy2d, type Grid } from '../lib/hilbert'
import { intToIPv4, ipv4NetworkPreview, parseIPv4, splitCidr } from '../lib/ipv4'
import { EASE_OUT } from '../lib/motion'
import { useTheme } from '../theme/ThemeContext'

interface MapSubnet {
  id: string
  label: string
  cidr: string
  lo: number
  hi: number
  pool: { lo: number; hi: number } | null
  tint: number
}

interface SubnetRect {
  subnet: MapSubnet
  x: number
  y: number
  w: number
  h: number
}

interface MapChunk {
  grid: Grid
  subnets: MapSubnet[]
  /** Per cell (Hilbert index): index into subnets, or -1. */
  subnetOf: Int16Array
  inSubnet: Uint32Array
  inPool: Uint32Array
  leased: Uint32Array
  hosts: Uint32Array
  rects: SubnetRect[]
  /** Visible part of the grid: the bounding box of the chunk's subnets. */
  view: { x: number; y: number; w: number; h: number }
}

interface MapData {
  chunks: MapChunk[]
  leasesByIp: Map<number, Lease>
  hostsByIp: Map<number, DhcpHost>
}

const SUBNET_TINTS = ['--muted', '--warn'] as const

function isActive(lease: Lease) {
  return lease.binding_state === null || lease.binding_state === 'active'
}

function buildMap(config: DhcpConfig, leases: Lease[]): MapData {
  const subnets: MapSubnet[] = []
  for (const subnet of config.subnets) {
    const parsed = splitCidr(subnet.network)
    const preview = parsed && ipv4NetworkPreview(parsed.address, parsed.prefix)
    if (!preview) continue
    const start = subnet.range ? parseIPv4(subnet.range.start) : null
    const end = subnet.range ? parseIPv4(subnet.range.end) : null
    subnets.push({
      id: subnet.id,
      label: subnet.name || preview.cidr,
      cidr: preview.cidr,
      lo: preview.networkInt,
      hi: preview.broadcastInt,
      pool: start !== null && end !== null && start <= end ? { lo: start, hi: end } : null,
      tint: 0,
    })
  }

  // Later entries in the leases file supersede earlier ones for the same address.
  const leasesByIp = new Map<number, Lease>()
  for (const lease of leases) {
    const ip = parseIPv4(lease.ip)
    if (ip !== null) leasesByIp.set(ip, lease)
  }
  for (const [ip, lease] of leasesByIp) {
    if (!isActive(lease)) leasesByIp.delete(ip)
  }
  const hostsByIp = new Map<number, DhcpHost>()
  for (const host of config.hosts) {
    const ip = parseIPv4(host.fixed_address)
    if (ip !== null) hostsByIp.set(ip, host)
  }

  const chunks = groupSpans(subnets).map((group): MapChunk => {
    const lo = Math.min(...group.map((subnet) => subnet.lo))
    const hi = Math.max(...group.map((subnet) => subnet.hi))
    const grid = gridFor(viewBlock(lo, hi))
    const subnetOf = new Int16Array(grid.cells).fill(-1)
    const inSubnet = new Uint32Array(grid.cells)
    const inPool = new Uint32Array(grid.cells)
    const leased = new Uint32Array(grid.cells)
    const hosts = new Uint32Array(grid.cells)
    const rects: SubnetRect[] = []

    group.forEach((subnet, index) => {
      subnet.tint = index % SUBNET_TINTS.length
      let minX = grid.side
      let minY = grid.side
      let maxX = -1
      let maxY = -1
      forEachCell(grid, subnet.lo, subnet.hi, (cell, count) => {
        inSubnet[cell] += count
        if (subnetOf[cell] === -1) subnetOf[cell] = index
        const [x, y] = d2xy(grid.side, cell)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      })
      if (subnet.pool) {
        forEachCell(grid, subnet.pool.lo, subnet.pool.hi, (cell, count) => {
          inPool[cell] += count
        })
      }
      if (maxX >= 0) {
        rects.push({ subnet, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
      }
    })
    for (const ip of leasesByIp.keys()) {
      const cell = cellOf(grid, ip)
      if (cell >= 0) leased[cell] += 1
    }
    for (const ip of hostsByIp.keys()) {
      const cell = cellOf(grid, ip)
      if (cell >= 0) hosts[cell] += 1
    }
    const x0 = Math.min(...rects.map((r) => r.x))
    const y0 = Math.min(...rects.map((r) => r.y))
    const x1 = Math.max(...rects.map((r) => r.x + r.w))
    const y1 = Math.max(...rects.map((r) => r.y + r.h))
    const view = rects.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: grid.side, h: grid.side }
    return { grid, subnets: group, subnetOf, inSubnet, inPool, leased, hosts, rects, view }
  })

  return { chunks, leasesByIp, hostsByIp }
}

/** What a panel covers: the subnet's CIDR, or the address span of a group of subnets. */
function chunkTitle(chunk: MapChunk) {
  if (chunk.subnets.length === 1) return chunk.subnets[0].cidr
  const lo = Math.min(...chunk.subnets.map((subnet) => subnet.lo))
  const hi = Math.max(...chunk.subnets.map((subnet) => subnet.hi))
  return `${intToIPv4(lo)} – ${intToIPv4(hi)}`
}

function readColors() {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(name).trim()
  return {
    track: token('--track'),
    leased: token('--accent'),
    host: token('--success'),
    tints: SUBNET_TINTS.map(token),
  }
}

function HilbertCanvas({ chunk }: { chunk: MapChunk }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { grid, view } = chunk
    const colors = readColors()
    ctx.clearRect(0, 0, view.w, view.h)
    ctx.globalAlpha = 1
    ctx.fillStyle = colors.track
    ctx.fillRect(0, 0, view.w, view.h)
    for (let cell = 0; cell < grid.cells; cell++) {
      let color: string
      let alpha: number
      if (chunk.hosts[cell]) {
        color = colors.host
        alpha = 1
      } else if (chunk.leased[cell]) {
        color = colors.leased
        // Aggregated cells brighten with how much of their pool is leased.
        alpha = grid.cellSize === 1 ? 1 : 0.55 + 0.45 * Math.min(1, chunk.leased[cell] / Math.max(chunk.inPool[cell], 1))
      } else if (chunk.inPool[cell]) {
        color = colors.tints[chunk.subnets[chunk.subnetOf[cell]]?.tint ?? 0]
        alpha = 0.45
      } else if (chunk.inSubnet[cell]) {
        color = colors.tints[chunk.subnets[chunk.subnetOf[cell]]?.tint ?? 0]
        alpha = 0.2
      } else {
        continue
      }
      const [gx, gy] = d2xy(grid.side, cell)
      const x = gx - view.x
      const y = gy - view.y
      if (x < 0 || y < 0 || x >= view.w || y >= view.h) continue
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
    ctx.globalAlpha = 1
  }, [chunk, theme])

  return (
    <canvas
      ref={canvasRef}
      className="map-canvas"
      width={chunk.view.w}
      height={chunk.view.h}
    />
  )
}

interface HoverState {
  cell: number
  left: number
  top: number
  flipX: boolean
  flipY: boolean
}

function MapPanel({ chunk, data }: { chunk: MapChunk; data: MapData }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<HoverState | null>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const [headHeight, setHeadHeight] = useState<number | null>(null)
  const { grid, view } = chunk
  const block = chunkTitle(chunk)

  // The header can wrap in narrow panels; its height is part of the row's height budget.
  useLayoutEffect(() => {
    const head = headRef.current
    if (!head) return
    const observer = new ResizeObserver(() => setHeadHeight(head.offsetHeight))
    observer.observe(head)
    setHeadHeight(head.offsetHeight)
    return () => observer.disconnect()
  }, [])

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const fx = (event.clientX - rect.left) / rect.width
    const fy = (event.clientY - rect.top) / rect.height
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) {
      setHover(null)
      return
    }
    const x = view.x + Math.floor(fx * view.w)
    const y = view.y + Math.floor(fy * view.h)
    setHover({
      cell: xy2d(grid.side, x, y),
      left: event.clientX - rect.left,
      top: event.clientY - rect.top,
      flipX: fx > 0.5,
      flipY: fy > 0.6,
    })
  }

  return (
    <motion.div
      className="card map-panel"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      style={headHeight !== null ? ({ '--map-head': `${headHeight}px` } as React.CSSProperties) : undefined}
    >
      <div className="map-panel-head" ref={headRef}>
        <h3 className="mono">{block}</h3>
        <span className="muted">
          {t('map.networks', { count: chunk.subnets.length })} · {t('map.perCell', { count: grid.cellSize })}
        </span>
      </div>
      <div
        className="map-surface"
        style={{ aspectRatio: `${view.w} / ${view.h}`, '--map-ratio': view.w / view.h } as React.CSSProperties}
        role="img"
        aria-label={t('map.mapLabel', { block })}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <HilbertCanvas chunk={chunk} />
        {chunk.rects.map(({ subnet, x, y, w, h }) => (
          <div
            key={subnet.id}
            className="map-subnet"
            style={{
              left: `${((x - view.x) / view.w) * 100}%`,
              top: `${((y - view.y) / view.h) * 100}%`,
              width: `${(w / view.w) * 100}%`,
              height: `${(h / view.h) * 100}%`,
            }}
          >
            {w / view.w >= 0.12 && h / view.h >= 0.06 && <span>{subnet.label}</span>}
          </div>
        ))}
        {hover && <MapTooltip chunk={chunk} data={data} hover={hover} />}
      </div>
    </motion.div>
  )
}

function MapTooltip({ chunk, data, hover }: { chunk: MapChunk; data: MapData; hover: HoverState }) {
  const { t } = useTranslation()
  const { grid } = chunk
  const { cell } = hover
  const start = grid.base + cell * grid.cellSize
  const end = start + grid.cellSize - 1
  const subnet = chunk.subnets[chunk.subnetOf[cell]]

  let detail: React.ReactNode
  if (grid.cellSize === 1) {
    const host = data.hostsByIp.get(start)
    const lease = data.leasesByIp.get(start)
    if (host) {
      detail = (
        <>
          <span>{t('map.status.host', { name: host.name })}</span>
          <span className="mono muted">{host.hardware_address}</span>
        </>
      )
    } else if (lease) {
      detail = (
        <>
          <span>{t('map.status.leased')}</span>
          {lease.hostname && <span>{lease.hostname}</span>}
          {lease.mac && <span className="mono muted">{lease.mac}</span>}
        </>
      )
    } else if (chunk.inPool[cell]) {
      detail = <span>{t('map.status.pool')}</span>
    } else if (chunk.inSubnet[cell]) {
      detail = <span>{t('map.status.subnet')}</span>
    } else {
      detail = <span>{t('map.status.outside')}</span>
    }
  } else {
    detail = (
      <span>
        {t('map.counts', {
          leased: chunk.leased[cell],
          hosts: chunk.hosts[cell],
          pool: chunk.inPool[cell],
        })}
      </span>
    )
  }

  return (
    <div className={`map-tooltip${hover.flipX ? ' flip-x' : ''}${hover.flipY ? ' flip-y' : ''}`} style={{ left: hover.left, top: hover.top }}>
      <strong className="mono">
        {grid.cellSize === 1 ? intToIPv4(start) : `${intToIPv4(start)} – ${intToIPv4(end)}`}
      </strong>
      <span className="muted">{subnet ? `${subnet.label}${subnet.label !== subnet.cidr ? ` (${subnet.cidr})` : ''}` : t('map.outside')}</span>
      {detail}
    </div>
  )
}

export function MapPage() {
  const { t } = useTranslation()
  const [source, setSource] = useState<{ config: DhcpConfig; leases: Lease[] } | null>(null)
  const [error, setError] = useState('')

  const { enabled, intervalMs, setEnabled, setIntervalMs, refreshNow } = useAutoRefresh(async () => {
    try {
      const [config, leases] = await Promise.all([api.getConfig(), api.leases()])
      setSource({ config, leases: leases.leases })
      setError('')
    } catch (err) {
      setError(errorMessage(err, t('map.loadFailed')))
    }
  })

  const data = useMemo(() => (source ? buildMap(source.config, source.leases) : null), [source])

  // Height left below the grid's top edge, so the first row of maps fits in the window.
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowMax, setRowMax] = useState<number | null>(null)
  const hasData = data !== null
  useLayoutEffect(() => {
    if (!hasData) return
    function measure() {
      const grid = gridRef.current
      if (!grid) return
      const top = grid.getBoundingClientRect().top + window.scrollY
      setRowMax(Math.max(240, Math.floor(window.innerHeight - top - 16)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [hasData, error])

  return (
    <div>
      <div className="actions page-header">
        <h2>{t('map.title')}</h2>
        <AutoRefreshControls
          enabled={enabled}
          intervalMs={intervalMs}
          onEnabledChange={setEnabled}
          onIntervalChange={setIntervalMs}
          onRefresh={refreshNow}
        />
      </div>
      <p className="muted page-subtitle">{t('map.subtitle')}</p>
      <Flash kind="error" message={error} />
      {data && (
        <>
          <ul className="map-legend">
            <li><i className="map-swatch outside" />{t('map.legend.outside')}</li>
            <li><i className="map-swatch subnet" />{t('map.legend.subnet')}</li>
            <li><i className="map-swatch pool" />{t('map.legend.pool')}</li>
            <li><i className="map-swatch leased" />{t('map.legend.leased')}</li>
            <li><i className="map-swatch host" />{t('map.legend.host')}</li>
          </ul>
          <div
            className="map-grid"
            ref={gridRef}
            style={rowMax !== null ? ({ '--map-row-max': `${rowMax}px` } as React.CSSProperties) : undefined}
          >
            {data.chunks.map((chunk) => (
              <MapPanel key={`${chunk.grid.base}/${chunk.grid.hostBits}`} chunk={chunk} data={data} />
            ))}
            {!data.chunks.length && !error && <div className="card">{t('map.empty')}</div>}
          </div>
        </>
      )}
    </div>
  )
}
