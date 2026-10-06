export const CIDR_PREFIXES = Array.from({ length: 25 }, (_, index) => index + 8)

export function parseIPv4(address: string): number | null {
  const parts = address.trim().split('.')
  if (parts.length !== 4) {
    return null
  }
  let value = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null
    }
    const octet = Number(part)
    if (octet < 0 || octet > 255) {
      return null
    }
    value = (value << 8) + octet
  }
  return value >>> 0
}

export function intToIPv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => ((value >>> shift) & 255).toString()).join('.')
}

export function ipv4NetworkPreview(address: string, prefix: number) {
  const ip = parseIPv4(address)
  if (ip === null || prefix < 0 || prefix > 32) {
    return null
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  // /31 and /32 have no network/broadcast reservation, so every address is assignable.
  const reserved = prefix <= 30
  return {
    network: intToIPv4(network),
    netmask: intToIPv4(mask),
    broadcast: intToIPv4(broadcast),
    size: 2 ** (32 - prefix),
    cidr: `${intToIPv4(network)}/${prefix}`,
    networkInt: network,
    broadcastInt: broadcast,
    firstHost: reserved ? network + 1 : network,
    lastHost: reserved ? broadcast - 1 : broadcast,
  }
}

export function splitCidr(cidr: string): { address: string; prefix: number } | null {
  const match = cidr.trim().match(/^(.+)\/(\d+)$/)
  if (!match) {
    return null
  }
  const prefix = Number(match[2])
  if (!CIDR_PREFIXES.includes(prefix) || parseIPv4(match[1]) === null) {
    return null
  }
  return { address: match[1], prefix }
}
