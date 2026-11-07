/**
 * Hilbert-curve layout of IPv4 address space.
 *
 * An aligned block of 4^k addresses maps onto a 2^k × 2^k square, so consecutive addresses stay
 * adjacent and every CIDR block inside it is a square or a 2:1 rectangle. Address arithmetic uses
 * plain numbers (not bitwise ops), because addresses can exceed 2^31.
 */

/** Largest grid drawn per chunk: 2^8 × 2^8 = 65,536 cells. Bigger blocks aggregate addresses per cell. */
export const MAX_ORDER = 8

/** Hilbert index → (x, y) on a side × side grid (side a power of two). */
export function d2xy(side: number, d: number): [number, number] {
  let x = 0
  let y = 0
  let t = d
  for (let s = 1; s < side; s *= 2) {
    const rx = 1 & (t >> 1)
    const ry = 1 & (t ^ rx)
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x
        y = s - 1 - y
      }
      const swap = x
      x = y
      y = swap
    }
    x += s * rx
    y += s * ry
    t >>= 2
  }
  return [x, y]
}

/** (x, y) → Hilbert index on a side × side grid. */
export function xy2d(side: number, px: number, py: number): number {
  let x = px
  let y = py
  let d = 0
  for (let s = side >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0
    const ry = (y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) {
        x = side - 1 - x
        y = side - 1 - y
      }
      const swap = x
      x = y
      y = swap
    }
  }
  return d
}

export interface Block {
  base: number
  /** Host bits; always even so the block is a square. */
  hostBits: number
}

export function blockSize(block: Block) {
  return 2 ** block.hostBits
}

/** Smallest aligned square block containing [lo, hi] with at least minSize addresses. */
export function enclosingBlock(lo: number, hi: number, minSize = 1): Block {
  for (let hostBits = 0; hostBits < 32; hostBits += 2) {
    const size = 2 ** hostBits
    const base = Math.floor(lo / size) * size
    if (size >= minSize && base + size - 1 >= hi) {
      return { base, hostBits }
    }
  }
  return { base: 0, hostBits: 32 }
}

/** Tightest square block holding a group of addresses; the page then crops it to the subnets drawn. */
export function viewBlock(lo: number, hi: number): Block {
  return enclosingBlock(lo, hi)
}

export interface Span {
  lo: number
  hi: number
}

/**
 * Groups spans (sorted by lo) into chunks that are drawn together. A span joins the current chunk
 * when the combined view is not much larger than drawing the two separately.
 */
export function groupSpans<T extends Span>(spans: T[]): T[][] {
  const sorted = [...spans].sort((a, b) => a.lo - b.lo)
  const chunks: { items: T[]; lo: number; hi: number }[] = []
  for (const span of sorted) {
    const current = chunks[chunks.length - 1]
    if (current) {
      const merged = blockSize(viewBlock(current.lo, Math.max(current.hi, span.hi)))
      const separate = blockSize(viewBlock(current.lo, current.hi)) + blockSize(viewBlock(span.lo, span.hi))
      if (merged <= 4 * separate) {
        current.items.push(span)
        current.hi = Math.max(current.hi, span.hi)
        continue
      }
    }
    chunks.push({ items: [span], lo: span.lo, hi: span.hi })
  }
  return chunks.map((chunk) => chunk.items)
}

/** Grid geometry for a block: a side × side grid where each cell covers cellSize addresses. */
export interface Grid {
  base: number
  hostBits: number
  side: number
  cellSize: number
  cells: number
}

export function gridFor(block: Block): Grid {
  const order = Math.min(block.hostBits / 2, MAX_ORDER)
  const side = 2 ** order
  return {
    base: block.base,
    hostBits: block.hostBits,
    side,
    cellSize: 2 ** (block.hostBits - 2 * order),
    cells: side * side,
  }
}

/** Calls fn(cellIndex, addressesCovered) for every cell that [lo, hi] overlaps. */
export function forEachCell(grid: Grid, lo: number, hi: number, fn: (cell: number, count: number) => void) {
  const end = grid.base + grid.cells * grid.cellSize - 1
  const from = Math.max(lo, grid.base)
  const to = Math.min(hi, end)
  if (from > to) return
  const first = Math.floor((from - grid.base) / grid.cellSize)
  const last = Math.floor((to - grid.base) / grid.cellSize)
  for (let cell = first; cell <= last; cell++) {
    const cellStart = grid.base + cell * grid.cellSize
    const cellEnd = cellStart + grid.cellSize - 1
    fn(cell, Math.min(to, cellEnd) - Math.max(from, cellStart) + 1)
  }
}

/** Index of the cell holding an address, or -1 when it is outside the grid. */
export function cellOf(grid: Grid, address: number) {
  const offset = address - grid.base
  if (offset < 0 || offset >= grid.cells * grid.cellSize) return -1
  return Math.floor(offset / grid.cellSize)
}
