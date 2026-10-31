export type SymAttrs = Record<string, string>

export interface SymProvenance {
  pdkId: string
  pdkRevision: string
  assetPath: string
  /** Digest of the exact supplied bytes, before decoding or newline normalization. */
  sha256: string
}

export interface SymAssetInput {
  pdkId: string
  pdkRevision: string
  assetPath: string
  expectedSha256: string
  content: string | Uint8Array
}

export interface SymPoint { x: number; y: number }
export interface SymBBox {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  height: number
}

export interface SymPin extends SymPoint {
  name: string
  dir: 'in' | 'out' | 'inout'
  box: [number, number, number, number]
  /** Geometric placement hint only; it does not imply connectivity. */
  side: 'left' | 'right' | 'top' | 'bottom'
  pinNumber?: string
  attrs: SymAttrs
}

export interface SymLine {
  layer: number
  x1: number
  y1: number
  x2: number
  y2: number
  attrs: SymAttrs
}
export interface SymRect extends SymLine {}
export interface SymArc extends SymPoint {
  layer: number
  r: number
  startAngle: number
  sweepAngle: number
  attrs: SymAttrs
}
export interface SymPolygon {
  layer: number
  npoints: number
  points: SymPoint[]
  attrs: SymAttrs
}
export interface SymText extends SymPoint {
  text: string
  rot: number
  mirror: number
  xscale: number
  yscale: number
  attrs: SymAttrs
}
export interface SymUnparseableRecord {
  /** One-based starting physical line. Multiline records retain all their raw text. */
  lineNumber: number
  raw: string
  reason: string
}

export interface SymRenderModel {
  provenance: SymProvenance
  symbolType?: string
  format?: string
  template?: SymAttrs
  pins: SymPin[]
  lines: SymLine[]
  rects: SymRect[]
  arcs: SymArc[]
  polygons: SymPolygon[]
  texts: SymText[]
  /** Geometry, pin boxes and text anchors; text glyph extents need renderer font metrics. */
  bbox: SymBBox
  warnings: string[]
  unparseableRecords: SymUnparseableRecord[]
}

export interface SymIntegrityError {
  code: 'sha256_mismatch'
  message: string
  expectedSha256: string
  actualSha256: string
}

export type SymParseResult =
  | { ok: true; symbol: SymRenderModel; provenance: SymProvenance }
  | { ok: false; error: SymIntegrityError; provenance: SymProvenance }
