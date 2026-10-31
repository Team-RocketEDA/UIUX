import type {
  SymArc, SymAssetInput, SymAttrs, SymBBox, SymParseResult, SymPin,
  SymPoint, SymRenderModel, SymUnparseableRecord,
} from './types.ts'

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (value: number, shift: number) => (value >>> shift) | (value << (32 - shift))

/** Synchronous SHA-256 over UTF-8 strings or exact bytes. No environment-specific APIs. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0)
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2]
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const choice = (e & f) ^ (~e & g)
      const t1 = (h + s1 + choice + SHA256_K[i] + words[i]) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + majority) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) hash[i] = (hash[i] + value) >>> 0
  }
  return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('')
}

interface Token { value: string; grouped: boolean }

/** Preserve nested braces and escaped delimiters rather than splitting on whitespace. */
function tokens(source: string): Token[] {
  const result: Token[] = []
  let i = 0
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue }
    const start = i
    if (source[i] === '{') {
      let depth = 1
      i++
      while (i < source.length && depth > 0) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === '{') depth++
        if (source[i] === '}') depth--
        i++
      }
      if (depth !== 0) throw new Error('Unterminated braced field')
      result.push({ value: source.slice(start + 1, i - 1), grouped: true })
    } else {
      while (i < source.length && !/\s/.test(source[i])) i++
      result.push({ value: source.slice(start, i), grouped: false })
    }
    if (i < source.length && !/\s/.test(source[i])) throw new Error('Missing field separator')
  }
  return result
}

// Only syntax escapes are removed. SPICE/Tcl backslashes such as \n remain intact.
function unescapeField(value: string): string {
  return value.replace(/\\([{}"\\\s])/g, '$1')
}

function attrs(source: string): SymAttrs {
  // defineProperty safely preserves literal keys such as __proto__ and constructor.
  const result: SymAttrs = {}
  let i = 0
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i++
    if (i === source.length) break
    const start = i
    while (i < source.length && !/[\s=]/.test(source[i])) i++
    const key = source.slice(start, i)
    while (i < source.length && /\s/.test(source[i])) i++
    if (!key || source[i] !== '=') throw new Error(`Malformed attribute near ${source.slice(start, i + 1)}`)
    i++
    while (i < source.length && /\s/.test(source[i])) i++
    let value = ''
    if (source[i] === '"' || source[i] === '{') {
      const opening = source[i++], closing = opening === '"' ? '"' : '}'
      const valueStart = i
      let depth = 1
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue }
        if (opening === '{' && source[i] === '{') depth++
        if (source[i] === closing) {
          depth--
          if (depth === 0) break
        }
        i++
      }
      if (i >= source.length) throw new Error(`Unterminated attribute ${key}`)
      value = source.slice(valueStart, i++)
      if (i < source.length && !/\s/.test(source[i])) throw new Error(`Missing separator after ${key}`)
    } else {
      const valueStart = i
      while (i < source.length && !/\s/.test(source[i])) {
        if (source[i] === '\\' && i + 1 < source.length) i++
        i++
      }
      value = source.slice(valueStart, i)
    }
    Object.defineProperty(result, key, {
      value: unescapeField(value), enumerable: true, configurable: true, writable: true,
    })
  }
  return result
}

function* records(content: string): Generator<{ lineNumber: number; raw: string }> {
  const physical = content.split(/\r\n|\n|\r/)
  let pending: string[] = [], start = 1, depth = 0
  for (let line = 0; line < physical.length; line++) {
    const raw = physical[line]
    if (!pending.length) {
      if (!raw.trim() || raw.trimStart().startsWith('#')) continue
      start = line + 1
      // Unknown tags are line-local: an unknown opening brace must not swallow real records.
      if (!/^[vGKVSELBAPT](?:\s|$)/.test(raw.trimStart())) {
        yield { lineNumber: start, raw }
        continue
      }
    }
    pending.push(raw)
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\\') { i++; continue }
      if (raw[i] === '{') depth++
      if (raw[i] === '}') depth--
    }
    if (depth <= 0) {
      yield { lineNumber: start, raw: pending.join('\n') }
      pending = []; depth = 0
    }
  }
  // Recover subsequent complete records after an unterminated record at EOF.
  for (let i = 0; i < pending.length; i++) yield { lineNumber: start + i, raw: pending[i] }
}

function number(token: Token | undefined): number {
  if (!token || token.grouped || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token.value)) {
    throw new Error(`Invalid number: ${token?.value ?? '(missing)'}`)
  }
  const value = Number(token.value)
  if (!Number.isFinite(value)) throw new Error(`Non-finite number: ${token.value}`)
  return value
}

function group(token: Token | undefined): string {
  if (!token?.grouped) throw new Error('Expected braced field')
  return token.value
}

function arity(fields: Token[], count: number): void {
  if (fields.length !== count) throw new Error(`Expected ${count} fields, got ${fields.length}`)
}

function layer(token: Token | undefined): number {
  const value = number(token)
  if (!Number.isInteger(value) || value < 0) throw new Error('Layer must be a nonnegative integer')
  return value
}

function arcPoints(arc: SymArc): SymPoint[] {
  const normalize = (a: number) => ((a % 360) + 360) % 360
  const start = normalize(arc.startAngle)
  const angles = [start, start + arc.sweepAngle]
  for (const angle of [0, 90, 180, 270]) {
    const delta = arc.sweepAngle >= 0 ? normalize(angle - start) : normalize(start - angle)
    if (Math.abs(arc.sweepAngle) >= 360 || delta <= Math.abs(arc.sweepAngle)) angles.push(angle)
  }
  return angles.map(angle => {
    const radians = normalize(angle) * Math.PI / 180
    // Xschem uses screen coordinates: positive arc angles rise above the x axis.
    const cos = Math.cos(radians), sin = Math.sin(radians)
    return {
      x: arc.x + arc.r * (Math.abs(cos) < 1e-14 ? 0 : cos),
      y: arc.y - arc.r * (Math.abs(sin) < 1e-14 ? 0 : sin),
    }
  })
}

function bounds(points: Iterable<SymPoint>): SymBBox {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const point of points) {
    x1 = Math.min(x1, point.x); y1 = Math.min(y1, point.y)
    x2 = Math.max(x2, point.x); y2 = Math.max(y2, point.y)
  }
  if (x1 === Infinity) return { x1: 0, y1: 0, x2: 0, y2: 0, width: 0, height: 0 }
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 }
}

function pinSide(pin: SymPin, box: SymBBox): SymPin['side'] {
  const distances: [SymPin['side'], number][] = [
    ['left', Math.abs(pin.x - box.x1)], ['right', Math.abs(box.x2 - pin.x)],
    ['top', Math.abs(pin.y - box.y1)], ['bottom', Math.abs(box.y2 - pin.y)],
  ]
  return distances.reduce((best, next) => next[1] < best[1] ? next : best)[0]
}

/** Verify exact bytes first, then recover independently from unsupported/malformed records. */
export function parseSymAsset(input: SymAssetInput): SymParseResult {
  const actualSha256 = sha256Hex(input.content)
  const provenance = {
    pdkId: input.pdkId, pdkRevision: input.pdkRevision, assetPath: input.assetPath, sha256: actualSha256,
  }
  if (actualSha256 !== input.expectedSha256.toLowerCase()) {
    return {
      ok: false, provenance,
      error: {
        code: 'sha256_mismatch', message: `SHA-256 mismatch for ${input.assetPath}`,
        expectedSha256: input.expectedSha256, actualSha256,
      },
    }
  }
  const symbol: SymRenderModel = {
    provenance, pins: [], lines: [], rects: [], arcs: [], polygons: [], texts: [],
    bbox: bounds([]), warnings: [], unparseableRecords: [],
  }
  const content = typeof input.content === 'string' ? input.content : new TextDecoder().decode(input.content)
  const geometry: SymPoint[] = []
  for (const record of records(content)) {
    try {
      const rawTag = record.raw.trimStart().match(/^\S+/)?.[0]
      if (!rawTag || !/^[vGKVSELBAPT]$/.test(rawTag)) {
        throw new Error(`Unknown record tag: ${rawTag ?? '(empty)'}`)
      }
      const fields = tokens(record.raw)
      const tag = fields.shift()?.value
      switch (tag) {
        case 'v': case 'G': case 'V': case 'S': case 'E':
          arity(fields, 1); group(fields[0]); break
        case 'K': {
          arity(fields, 1)
          const properties = attrs(group(fields[0]))
          const template = properties.template === undefined ? undefined : attrs(properties.template)
          if (properties.type !== undefined) symbol.symbolType = properties.type
          if (properties.format !== undefined) symbol.format = properties.format
          if (template !== undefined) symbol.template = template
          break
        }
        case 'L': case 'B': {
          arity(fields, 6)
          const item = {
            layer: layer(fields[0]), x1: number(fields[1]), y1: number(fields[2]),
            x2: number(fields[3]), y2: number(fields[4]), attrs: attrs(group(fields[5])),
          }
          if (tag === 'B' && item.layer === 5 && Object.hasOwn(item.attrs, 'name') && item.attrs.name !== '') {
            const dir = item.attrs.dir
            if (dir !== 'in' && dir !== 'out' && dir !== 'inout') throw new Error('Explicit pin requires dir=in|out|inout')
            const pin: SymPin = {
              name: item.attrs.name, dir, x: item.x1 / 2 + item.x2 / 2, y: item.y1 / 2 + item.y2 / 2,
              box: [item.x1, item.y1, item.x2, item.y2], side: 'left', attrs: item.attrs,
            }
            if (Object.hasOwn(item.attrs, 'pinnumber')) pin.pinNumber = item.attrs.pinnumber
            symbol.pins.push(pin)
          } else if (tag === 'L') symbol.lines.push(item)
          else symbol.rects.push(item)
          geometry.push({ x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 })
          break
        }
        case 'A': {
          arity(fields, 7)
          const item: SymArc = {
            layer: layer(fields[0]), x: number(fields[1]), y: number(fields[2]), r: number(fields[3]),
            startAngle: number(fields[4]), sweepAngle: number(fields[5]), attrs: attrs(group(fields[6])),
          }
          if (item.r < 0) throw new Error('Arc radius must be nonnegative')
          const points = arcPoints(item)
          if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Arc bounds overflow')
          symbol.arcs.push(item); geometry.push(...points)
          break
        }
        case 'P': {
          const itemLayer = layer(fields[0]), npoints = number(fields[1])
          if (!Number.isSafeInteger(npoints) || npoints < 1) throw new Error('Polygon point count must be a positive integer')
          arity(fields, 3 + npoints * 2)
          const points: SymPoint[] = []
          for (let i = 0; i < npoints; i++) points.push({ x: number(fields[2 + i * 2]), y: number(fields[3 + i * 2]) })
          const properties = attrs(group(fields[fields.length - 1]))
          symbol.polygons.push({ layer: itemLayer, npoints, points, attrs: properties })
          // Avoid spread argument limits for large, otherwise valid polylines.
          for (const point of points) geometry.push(point)
          break
        }
        case 'T': {
          arity(fields, 8)
          symbol.texts.push({
            text: unescapeField(group(fields[0])), x: number(fields[1]), y: number(fields[2]),
            rot: number(fields[3]), mirror: number(fields[4]), xscale: number(fields[5]),
            yscale: number(fields[6]), attrs: attrs(group(fields[7])),
          })
          break
        }
        default: throw new Error(`Unknown record tag: ${tag ?? '(empty)'}`)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const failed: SymUnparseableRecord = { ...record, reason }
      symbol.unparseableRecords.push(failed)
      symbol.warnings.push(`Line ${record.lineNumber}: ${reason}`)
    }
  }
  const geometryBounds = bounds(geometry)
  for (const pin of symbol.pins) pin.side = pinSide(pin, geometryBounds)
  symbol.bbox = bounds([...geometry, ...symbol.texts])
  return { ok: true, symbol, provenance }
}
