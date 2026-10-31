// The browser app deliberately has no Node typing dependency. Only this test uses Node APIs.
// @ts-ignore -- Resolved by the native Node test runner, independent of app typings.
import { test } from 'node:test'
// @ts-ignore -- Resolved by the native Node test runner.
import assert from 'node:assert/strict'
// @ts-ignore -- Independent reference implementation used only in tests.
import { createHash } from 'node:crypto'
// @ts-ignore -- Native Node strip-types requires explicit TypeScript extensions.
import { parseSymAsset, sha256Hex } from './parser.ts'
// @ts-ignore -- Native Node strip-types requires explicit TypeScript extensions.
import { getSky130SymFixtures, parseAllSky130Fixtures, SKY130_PDK_ID, SKY130_PDK_REVISION } from './fixtures.ts'
import type { SymAssetInput, SymRenderModel } from './types.ts'

function asset(content: string | Uint8Array): SymAssetInput {
  return {
    pdkId: 'test-pdk', pdkRevision: 'revision-1', assetPath: 'test.sym',
    expectedSha256: sha256Hex(content), content,
  }
}

function parse(content: string | Uint8Array): SymRenderModel {
  const result = parseSymAsset(asset(content))
  if (!result.ok) throw new Error(result.error.message)
  return result.symbol
}

function approx(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
}

test('SHA-256 matches published empty, abc, multiblock and million-a vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  )
  assert.equal(sha256Hex('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
})

test('SHA-256 matches Node crypto at padding boundaries, on Unicode and on byte views', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 4096]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) % 256)
    assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'))
  }
  for (const text of ['회로 설계 Ω 🚀', '\uD800', 'é', 'e\u0301', '\uFEFFT {λ} 0 0 0 0 1 1 {}\r\n']) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'))
    assert.equal(sha256Hex(text), sha256Hex(new TextEncoder().encode(text)))
  }
  const bytes = new Uint8Array([99, 97, 98, 99, 99])
  assert.equal(sha256Hex(bytes.subarray(1, 4)), sha256Hex('abc'))
  assert.deepEqual(bytes, new Uint8Array([99, 97, 98, 99, 99]))
})

test('matching integrity accepts uppercase expected digest and preserves provenance', () => {
  const input = asset('L 4 0 0 10 20 {}\n')
  input.expectedSha256 = input.expectedSha256.toUpperCase()
  const result = parseSymAsset(input)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('Expected integrity pass')
  assert.equal(result.symbol.lines.length, 1)
  assert.deepEqual(result.provenance, {
    pdkId: 'test-pdk', pdkRevision: 'revision-1', assetPath: 'test.sym', sha256: sha256Hex(input.content),
  })
  assert.deepEqual(result.symbol.provenance, result.provenance)
})

test('integrity mismatch immediately refuses without a partially parsed symbol or diagnostics', () => {
  const input = asset('L 4 0 0 10 20 {}\nB 5 -1 -1 1 1 {name=A dir=in}\nUNKNOWN {}')
  input.expectedSha256 = 'A'.repeat(64)
  const result = parseSymAsset(input)
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Must refuse corrupted content')
  assert.equal(result.error.code, 'sha256_mismatch')
  assert.equal(result.error.expectedSha256, 'A'.repeat(64))
  assert.equal(result.error.actualSha256, sha256Hex(input.content))
  assert.equal(result.provenance.sha256, result.error.actualSha256)
  assert.match(result.error.message, /test\.sym/)
  assert.equal('symbol' in result, false)
  assert.equal('warnings' in result, false)
  assert.deepEqual(Object.keys(result).sort(), ['error', 'ok', 'provenance'])
})

test('hashes exact incoming bytes before decoding, never normalizes newlines for integrity', () => {
  const source = 'T {회로 🚀} 0 0 0 0 1 1 {}\r\n'
  const bytes = new TextEncoder().encode(source)
  assert.deepEqual(parse(bytes), parse(source))
  const input = asset(source)
  input.content = source.replace(/\r\n/g, '\n')
  assert.equal(parseSymAsset(input).ok, false)
  input.expectedSha256 = ` ${sha256Hex(input.content)}`
  assert.equal(parseSymAsset(input).ok, false)
  // Invalid UTF-8 still hashes its original octets, rather than replacement characters.
  const invalid = new Uint8Array([0xff])
  const result = parseSymAsset(asset(invalid))
  assert.equal(result.provenance.sha256, createHash('sha256').update(invalid).digest('hex'))
})

test('extracts only explicit layer-5 pins, including centers, directions, attributes and numbers', () => {
  const symbol = parse(`B 4 -10 -10 10 10 {name=NOT_A_PIN dir=in}
L 5 -30 0 -10 0 {name=ALSO_NOT_A_PIN dir=in}
T {VDD} 0 -30 0 0 1 1 {}
B 5 -32 -2 -28 2 {name=A dir=in pinnumber=1 custom="gate input"}
B 5 28 -2 32 2 {name=Y dir=out pinnumber=2}
B 5 -2 -32 2 -28 {name=VDD dir=inout pinnumber=3}
B 5 -2 28 2 32 {name=VSS dir=inout}
B 5 0 0 1 1 {dir=inout}`)
  assert.equal(symbol.warnings.length, 0)
  assert.equal(symbol.rects.length, 2)
  assert.equal(symbol.lines.length, 1)
  assert.deepEqual(symbol.pins.map(p => [p.name, p.dir, p.x, p.y, p.side, p.pinNumber]), [
    ['A', 'in', -30, 0, 'left', '1'], ['Y', 'out', 30, 0, 'right', '2'],
    ['VDD', 'inout', 0, -30, 'top', '3'], ['VSS', 'inout', 0, 30, 'bottom', undefined],
  ])
  assert.deepEqual(symbol.pins[0].box, [-32, -2, -28, 2])
  assert.equal(symbol.pins[0].attrs.custom, 'gate input')
})

test('lines, text, polygons and graphical boxes never fabricate connectivity', () => {
  const symbol = parse(`L 4 -40 0 40 0 {name=IN dir=in}
B 4 -20 -20 20 20 {name=OUT dir=out pinnumber=1}
B 5 -2 -2 2 2 {}
T {IN OUT VDD VSS} 0 0 0 0 1 1 {}
P 5 3 0 0 10 0 5 10 {name=FAKE dir=in}`)
  assert.deepEqual(symbol.pins, [])
  assert.equal(symbol.warnings.length, 0)
})

test('invalid or missing pin directions produce warnings and skip their records', () => {
  const symbol = parse(`B 5 -1 -1 1 1 {name=NO_DIR}
B 5 2 2 4 4 {name=BAD dir=input}
B 5 5 5 7 7 {name=VALID dir=inout}`)
  assert.deepEqual(symbol.pins.map(p => p.name), ['VALID'])
  assert.equal(symbol.unparseableRecords.length, 2)
  assert.equal(symbol.rects.length, 0)
  assert.deepEqual(symbol.bbox, { x1: 5, y1: 5, x2: 7, y2: 7, width: 2, height: 2 })
})

test('all specified record types parse, including multiline K, nested braces and label transforms', () => {
  const symbol = parse(`v {xschem version=3.4.5 file_version=1.2}
G {A header
with a nested {license block}}
K {type=subcircuit
format="@name @pinlist @model"
template="name=X1 model=ota w=1.5"}
V {}
S {}
E {}
L 4 -1e1 .5 +10.0 2.5 {dash=4}
B 4 1 2 3 4 {fill=true}
A 4 10 20 5 0 360 {dash=2}
P 4 3 0 0 10 0 5 10 {fill=false}
T {OTA {demo}
second line} 12 13 1 1 .2 0.3 {hcenter=true}`)
  assert.deepEqual(symbol.warnings, [])
  assert.equal(symbol.symbolType, 'subcircuit')
  assert.equal(symbol.format, '@name @pinlist @model')
  assert.deepEqual(symbol.template, { name: 'X1', model: 'ota', w: '1.5' })
  assert.deepEqual(symbol.lines[0], { layer: 4, x1: -10, y1: 0.5, x2: 10, y2: 2.5, attrs: { dash: '4' } })
  assert.equal(symbol.rects.length, 1)
  assert.equal(symbol.arcs.length, 1)
  assert.deepEqual(symbol.polygons[0], {
    layer: 4, npoints: 3, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], attrs: { fill: 'false' },
  })
  assert.deepEqual(symbol.texts[0], {
    text: 'OTA {demo}\nsecond line', x: 12, y: 13, rot: 1, mirror: 1,
    xscale: 0.2, yscale: 0.3, attrs: { hcenter: 'true' },
  })
})

test('quoted, braced and escaped attribute values retain their intended content', () => {
  const symbol = parse(String.raw`K {type=subcircuit format="@name {literal}" template={name=X1 model=demo}}
B 5 -1 -1 1 1 {name="input bus" dir=in label={nested {label}} note="say \"hi\"" path="C:\\pdk\\cell"}
T {literal \{brace\} and \\ slash} 0 0 0 0 1 1 {text="a=b c"}`)
  assert.deepEqual(symbol.warnings, [])
  assert.equal(symbol.format, '@name {literal}')
  assert.deepEqual(symbol.template, { name: 'X1', model: 'demo' })
  assert.equal(symbol.pins[0].name, 'input bus')
  assert.equal(symbol.pins[0].attrs.label, 'nested {label}')
  assert.equal(symbol.pins[0].attrs.note, 'say "hi"')
  assert.equal(symbol.pins[0].attrs.path, 'C:\\pdk\\cell')
  assert.equal(symbol.texts[0].text, 'literal {brace} and \\ slash')
  assert.equal(symbol.texts[0].attrs.text, 'a=b c')
})

test('attribute maps safely preserve __proto__ and constructor as literal attributes', () => {
  const symbol = parse('B 5 -1 -1 1 1 {name=A dir=in __proto__=literal constructor=custom}')
  assert.deepEqual(symbol.warnings, [])
  assert.equal(symbol.pins[0].attrs.__proto__, 'literal')
  assert.equal(symbol.pins[0].attrs.constructor, 'custom')
  assert.equal(Object.getPrototypeOf(symbol.pins[0].attrs), Object.prototype)
})

test('unknown records fail soft with exact raw lines and one-based physical line numbers', () => {
  const content = '\r\n# ignored comment\r\nL 4 0 0 1 1 {}\r\n  Z 4 unexpected {\r\nB 4 2 2 3 3 {}\r\n'
  const symbol = parse(content)
  assert.equal(symbol.lines.length, 1)
  assert.equal(symbol.rects.length, 1)
  assert.equal(symbol.warnings.length, 1)
  assert.equal(symbol.unparseableRecords[0].lineNumber, 4)
  assert.equal(symbol.unparseableRecords[0].raw, '  Z 4 unexpected {')
  assert.match(symbol.unparseableRecords[0].reason, /Unknown record tag: Z/)
  assert.match(symbol.warnings[0], /Line 4/)
})

test('malformed numbers, shapes, counts and attributes are skipped atomically', () => {
  const malformed = [
    'L 4 NaN 0 1 1 {}', 'L 4 0 0 Infinity 1 {}', 'L 4 0 0 1e999 1 {}',
    'L 4 0x10 0 1 1 {}', 'L 4 0 0 1junk 1 {}', 'L 4.5 0 0 1 1 {}',
    'L -1 0 0 1 1 {}', 'B 4 0 0 10 {}', 'B 5 0 0 1 1 {name=A dir=in flag}',
    'A 4 0 0 -1 0 360 {}', 'P 4 2 0 0 1 {}', 'P 4 1.5 0 0 {}',
    'P 4 0 {}', 'T {bad} 0 0 0 0 invalid 1 {}', 'L 4 0 0 1 1 {} trailing',
    'K {type=must_not_leak format="unterminated}',
  ]
  const symbol = parse([...malformed, 'L 4 1 2 3 4 {}'].join('\n'))
  assert.equal(symbol.warnings.length, malformed.length)
  assert.deepEqual(symbol.unparseableRecords.map(r => r.raw), malformed)
  assert.equal(symbol.symbolType, undefined)
  assert.equal(symbol.lines.length, 1)
  assert.deepEqual(symbol.pins, [])
  assert.deepEqual(symbol.arcs, [])
  assert.deepEqual(symbol.polygons, [])
  assert.deepEqual(symbol.texts, [])
  assert.deepEqual(symbol.bbox, { x1: 1, y1: 2, x2: 3, y2: 4, width: 2, height: 2 })
})

test('unterminated braced records retain a warning and recover subsequent complete records', () => {
  const symbol = parse('T {broken\nL 4 -1 -2 3 4 {}\nB 5 -2 -3 0 -1 {name=A dir=in}')
  assert.equal(symbol.warnings.length, 1)
  assert.equal(symbol.unparseableRecords[0].lineNumber, 1)
  assert.equal(symbol.unparseableRecords[0].raw, 'T {broken')
  assert.equal(symbol.lines.length, 1)
  assert.equal(symbol.pins.length, 1)
})

test('failed multiline records report their starting line and retain the full record', () => {
  const symbol = parse('# header\nK {type=subcircuit\nformat="unterminated}\nL 4 0 0 1 1 {}')
  assert.equal(symbol.unparseableRecords.length, 1)
  assert.equal(symbol.unparseableRecords[0].lineNumber, 2)
  assert.equal(symbol.unparseableRecords[0].raw, 'K {type=subcircuit\nformat="unterminated}')
  assert.equal(symbol.lines.length, 1)
})

test('bbox combines reversed boxes, lines, polygons, pin boxes and text anchors', () => {
  const symbol = parse(`L 4 -10 2 20 4 {}
B 4 8 10 -8 -5 {}
P 4 3 -15 5 0 25 10 0 {}
B 5 28 -2 32 2 {name=Y dir=out}
T {anchor only} 3 -30 0 0 1 1 {}`)
  assert.deepEqual(symbol.bbox, { x1: -15, y1: -30, x2: 32, y2: 25, width: 47, height: 55 })
  assert.deepEqual(symbol.rects[0], { layer: 4, x1: 8, y1: 10, x2: -8, y2: -5, attrs: {} })
  assert.equal(symbol.pins[0].side, 'right')
})

test('empty and metadata-only symbols have zero bbox and no invented entities', () => {
  for (const source of ['', '# comment\n\n', 'v {xschem version=3.4.5 file_version=1.2}\nG {}\nK {}\nV {}\nS {}\nE {}']) {
    const symbol = parse(source)
    assert.deepEqual(symbol.bbox, { x1: 0, y1: 0, x2: 0, y2: 0, width: 0, height: 0 })
    assert.deepEqual(symbol.pins, [])
    assert.deepEqual(symbol.warnings, [])
  }
})

test('arc bbox includes full circles and only the extrema swept by partial arcs', () => {
  assert.deepEqual(parse('A 4 10 20 5 0 360 {}').bbox, {
    x1: 5, y1: 15, x2: 15, y2: 25, width: 10, height: 10,
  })
  assert.deepEqual(parse('A 4 0 0 10 0 90 {}').bbox, {
    x1: 0, y1: -10, x2: 10, y2: 0, width: 10, height: 10,
  })
  assert.deepEqual(parse('A 4 0 0 10 0 -90 {}').bbox, {
    x1: 0, y1: 0, x2: 10, y2: 10, width: 10, height: 10,
  })
  const wrap = parse('A 4 0 0 10 350 20 {}').bbox
  approx(wrap.x1, Math.cos(Math.PI / 18) * 10)
  approx(wrap.x2, 10)
  approx(wrap.y1, -Math.sin(Math.PI / 18) * 10)
  approx(wrap.y2, Math.sin(Math.PI / 18) * 10)
  assert.deepEqual(parse('A 4 1 2 0 45 10 {}').bbox, {
    x1: 1, y1: 2, x2: 1, y2: 2, width: 0, height: 0,
  })
})

test('very large valid polylines do not depend on JavaScript function argument limits', () => {
  const count = 70_000
  const coordinates = Array.from({ length: count }, (_, i) => `${i} ${i % 2}`).join(' ')
  const symbol = parse(`P 4 ${count} ${coordinates} {}`)
  assert.deepEqual(symbol.warnings, [])
  assert.equal(symbol.polygons[0].points.length, count)
  assert.deepEqual(symbol.bbox, { x1: 0, y1: 0, x2: count - 1, y2: 1, width: count - 1, height: 1 })
})

const fixturePins = [
  ['D', 'G', 'S', 'B'], ['D', 'G', 'S', 'B'], ['P', 'M', 'B'],
  ['TOP', 'BOT'], ['VINP', 'VINN', 'VOUT', 'IBIAS', 'VDD', 'VSS'],
]
const fixturePaths = [
  'sky130_fd_pr/nfet_01v8.sym', 'sky130_fd_pr/pfet_01v8.sym',
  'sky130_fd_pr/res_high_po.sym', 'sky130_fd_pr/cap_mim_m3_1.sym', 'sky130_fd_pr/ota_5t.sym',
]

test('all five sky130A fixtures have exact independently verified SHA-256 digests and required provenance', () => {
  const fixtures = getSky130SymFixtures()
  assert.equal(fixtures.length, 5)
  assert.deepEqual(fixtures.map(f => f.assetPath), fixturePaths)
  for (const fixture of fixtures) {
    assert.equal(fixture.pdkId, 'sky130A')
    assert.equal(fixture.pdkRevision, '5f09001e4b975ba35d27d99a10ecdf45054a9bd5')
    assert.match(fixture.expectedSha256, /^[a-f0-9]{64}$/)
    assert.equal(fixture.expectedSha256, createHash('sha256').update(fixture.content).digest('hex'))
    assert.equal(fixture.expectedSha256, sha256Hex(fixture.content))
  }
  assert.equal(SKY130_PDK_ID, 'sky130A')
  assert.equal(SKY130_PDK_REVISION, '5f09001e4b975ba35d27d99a10ecdf45054a9bd5')
  const firstPath = fixtures[0].assetPath
  fixtures[0].assetPath = 'modified.sym'
  assert.equal(getSky130SymFixtures()[0].assetPath, firstPath)
})

for (const [index, expectedPins] of fixturePins.entries()) {
  test(`sky130A ${fixturePaths[index]} parses without warnings and exposes its explicit pins`, () => {
    const fixture = getSky130SymFixtures()[index]
    const result = parseSymAsset(fixture)
    if (!result.ok) throw new Error(result.error.message)
    const symbol = result.symbol
    assert.deepEqual(symbol.pins.map(p => p.name), expectedPins)
    assert.deepEqual(symbol.pins.map(p => p.pinNumber), expectedPins.map((_, i) => String(i + 1)))
    assert.deepEqual(symbol.warnings, [])
    assert.deepEqual(symbol.unparseableRecords, [])
    assert.equal(symbol.provenance.assetPath, fixturePaths[index])
    assert.equal(symbol.provenance.sha256, fixture.expectedSha256)
    assert.ok(symbol.symbolType)
    assert.ok(symbol.format)
    assert.ok(symbol.template?.name)
    assert.ok(symbol.lines.length > 0)
    assert.ok(symbol.texts.length > 0)
    assert.ok(symbol.bbox.width > 0 && symbol.bbox.height > 0)
    for (const pin of symbol.pins) {
      assert.ok(pin.x >= symbol.bbox.x1 && pin.x <= symbol.bbox.x2)
      assert.ok(pin.y >= symbol.bbox.y1 && pin.y <= symbol.bbox.y2)
    }
    const changed = parseSymAsset({ ...fixture, content: `${fixture.content}\n` })
    assert.equal(changed.ok, false)
  })
}

test('fixture helper returns five independent parse results with realistic geometry and directions', () => {
  const results = parseAllSky130Fixtures()
  assert.equal(results.length, 5)
  const symbols = results.map(result => {
    if (!result.ok) throw new Error(result.error.message)
    return result.symbol
  })
  assert.deepEqual(symbols.map(s => s.pins.length), [4, 4, 3, 2, 6])
  assert.deepEqual(symbols[0].pins.map(p => p.side), ['top', 'left', 'bottom', 'right'])
  assert.equal(symbols[1].arcs.length, 1)
  assert.equal(symbols[2].rects.length, 1)
  assert.equal(symbols[4].pins.find(p => p.name === 'VOUT')?.dir, 'out')
  assert.deepEqual(symbols[0].bbox, { x1: -42.5, y1: -52.5, x2: 42.5, y2: 52.5, width: 85, height: 105 })
  assert.deepEqual(symbols[3].bbox, { x1: -20, y1: -42.5, x2: 20, y2: 42.5, width: 40, height: 85 })
  symbols[0].pins.pop()
  const fresh = parseAllSky130Fixtures()[0]
  assert.equal(fresh.ok && fresh.symbol.pins.length, 4)
})

test('public barrel exports work through the same native Node consumer', async () => {
  // @ts-ignore -- Native Node strip-types requires explicit TypeScript extensions.
  const api = await import('./index.ts')
  assert.equal(api.sha256Hex('abc'), sha256Hex('abc'))
  assert.equal(api.parseSymAsset(asset('')).ok, true)
  assert.equal(api.getSky130SymFixtures().length, 5)
  assert.equal(api.parseAllSky130Fixtures().length, 5)
})
