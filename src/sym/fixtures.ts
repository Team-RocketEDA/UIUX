// Explicit .ts imports let Node's native strip-types runner load the same sources as Vite.
// @ts-ignore -- The owning app tsconfig does not enable allowImportingTsExtensions.
import { parseSymAsset, sha256Hex } from './parser.ts'
import type { SymAssetInput, SymParseResult } from './types.ts'

export const SKY130_PDK_ID = 'sky130A'
export const SKY130_PDK_REVISION = '5f09001e4b975ba35d27d99a10ecdf45054a9bd5'

/**
 * Authored parser/rendering fixtures, not byte-for-byte upstream PDK assets.
 * The revision identifies the target PDK contract; digests identify these exact
 * local fixture bytes. In particular ota_5t is a demonstration subcircuit.
 */
const sources = [
  {
    assetPath: 'sky130_fd_pr/nfet_01v8.sym',
    content: `v {xschem version=3.4.5 file_version=1.2}
G {RocketEDA authored sky130A nfet fixture}
K {type=nmos
format="@name @pinlist @model w=@w l=@l nf=@nf m=@mult"
template="name=M1 model=sky130_fd_pr__nfet_01v8 w=1 l=0.15 nf=1 mult=1"}
V {}
S {}
E {}
L 4 -12 -24 -12 24 {}
L 4 -6 -20 -6 -8 {}
L 4 -6 -6 -6 6 {}
L 4 -6 8 -6 20 {}
L 4 -40 0 -12 0 {}
L 4 -6 -20 0 -20 {}
L 4 0 -50 0 -20 {}
L 4 -6 20 0 20 {}
L 4 0 20 0 50 {}
L 4 10 0 40 0 {}
P 4 4 2 0 10 -4 10 4 2 0 {fill=true}
B 5 -2.5 -52.5 2.5 -47.5 {name=D dir=inout pinnumber=1}
B 5 -42.5 -2.5 -37.5 2.5 {name=G dir=in pinnumber=2}
B 5 -2.5 47.5 2.5 52.5 {name=S dir=inout pinnumber=3}
B 5 37.5 -2.5 42.5 2.5 {name=B dir=inout pinnumber=4}
T {@name} 12 -30 0 0 0.2 0.2 {}
T {NFET 1.8V} 12 20 0 0 0.15 0.15 {}
`,
  },
  {
    assetPath: 'sky130_fd_pr/pfet_01v8.sym',
    content: `v {xschem version=3.4.5 file_version=1.2}
G {RocketEDA authored sky130A pfet fixture}
K {type=pmos
format="@name @pinlist @model w=@w l=@l nf=@nf m=@mult"
template="name=M1 model=sky130_fd_pr__pfet_01v8 w=2 l=0.15 nf=1 mult=1"}
V {}
S {}
E {}
L 4 -12 -24 -12 24 {}
L 4 -6 -20 -6 -8 {}
L 4 -6 -6 -6 6 {}
L 4 -6 8 -6 20 {}
L 4 -40 0 -22 0 {}
A 4 -17 0 5 0 360 {}
L 4 -6 -20 0 -20 {}
L 4 0 -50 0 -20 {}
L 4 -6 20 0 20 {}
L 4 0 20 0 50 {}
L 4 10 0 40 0 {}
P 4 4 12 0 4 -4 4 4 12 0 {fill=true}
B 5 -2.5 -52.5 2.5 -47.5 {name=D dir=inout pinnumber=1}
B 5 -42.5 -2.5 -37.5 2.5 {name=G dir=in pinnumber=2}
B 5 -2.5 47.5 2.5 52.5 {name=S dir=inout pinnumber=3}
B 5 37.5 -2.5 42.5 2.5 {name=B dir=inout pinnumber=4}
T {@name} 12 -30 0 0 0.2 0.2 {}
T {PFET 1.8V} 12 20 0 0 0.15 0.15 {}
`,
  },
  {
    assetPath: 'sky130_fd_pr/res_high_po.sym',
    content: `v {xschem version=3.4.5 file_version=1.2}
G {RocketEDA authored sky130A high-resistance poly fixture}
K {type=subcircuit
format="@name @pinlist @model w=@w l=@l m=@mult"
template="name=XR1 model=sky130_fd_pr__res_high_po w=0.35 l=1 mult=1"}
V {}
S {}
E {}
L 4 0 -50 0 -30 {}
B 4 -8 -30 8 30 {fill=false}
L 4 0 30 0 50 {}
L 4 8 0 40 0 {}
B 5 -2.5 -52.5 2.5 -47.5 {name=P dir=inout pinnumber=1}
B 5 -2.5 47.5 2.5 52.5 {name=M dir=inout pinnumber=2}
B 5 37.5 -2.5 42.5 2.5 {name=B dir=inout pinnumber=3}
T {@name} 12 -30 0 0 0.2 0.2 {}
T {w=@w l=@l} 12 20 0 0 0.15 0.15 {}
`,
  },
  {
    assetPath: 'sky130_fd_pr/cap_mim_m3_1.sym',
    content: `v {xschem version=3.4.5 file_version=1.2}
G {RocketEDA authored sky130A metal-3 MIM capacitor fixture}
K {type=subcircuit
format="@name @pinlist @model w=@w l=@l m=@mult"
template="name=XC1 model=sky130_fd_pr__cap_mim_m3_1 w=2 l=2 mult=1"}
V {}
S {}
E {}
L 4 0 -40 0 -6 {}
L 4 -20 -6 20 -6 {}
L 4 -20 6 20 6 {}
L 4 0 6 0 40 {}
B 5 -2.5 -42.5 2.5 -37.5 {name=TOP dir=inout pinnumber=1}
B 5 -2.5 37.5 2.5 42.5 {name=BOT dir=inout pinnumber=2}
T {@name} 8 -26 0 0 0.2 0.2 {}
T {MIM} 8 20 0 0 0.15 0.15 {}
`,
  },
  {
    assetPath: 'sky130_fd_pr/ota_5t.sym',
    content: `v {xschem version=3.4.5 file_version=1.2}
G {RocketEDA authored five-transistor OTA demo subcircuit, not a foundry primitive}
K {type=subcircuit
format="@name @pinlist ota_5t"
template="name=XOTA1"}
V {}
S {}
E {}
P 4 4 -40 -50 -40 50 50 0 -40 -50 {fill=false}
L 4 -70 -20 -40 -20 {}
L 4 -70 20 -40 20 {}
L 4 50 0 80 0 {}
L 4 -10 -70 -10 -33.333333 {}
L 4 -10 33.333333 -10 70 {}
L 4 -40 60 -40 35 {}
B 5 -72.5 -22.5 -67.5 -17.5 {name=VINP dir=in pinnumber=1}
B 5 -72.5 17.5 -67.5 22.5 {name=VINN dir=in pinnumber=2}
B 5 77.5 -2.5 82.5 2.5 {name=VOUT dir=out pinnumber=3}
B 5 -42.5 57.5 -37.5 62.5 {name=IBIAS dir=in pinnumber=4}
B 5 -12.5 -72.5 -7.5 -67.5 {name=VDD dir=inout pinnumber=5}
B 5 -12.5 67.5 -7.5 72.5 {name=VSS dir=inout pinnumber=6}
T {+} -33 -25 0 0 0.3 0.3 {}
T {-} -33 15 0 0 0.3 0.3 {}
T {@name} -20 -18 0 0 0.2 0.2 {}
T {OTA 5T} -20 10 0 0 0.15 0.15 {}
`,
  },
] as const

const fixtures: readonly Readonly<SymAssetInput>[] = Object.freeze(sources.map(source => Object.freeze({
  ...source, pdkId: SKY130_PDK_ID, pdkRevision: SKY130_PDK_REVISION,
  expectedSha256: sha256Hex(source.content),
})))

/** Fresh descriptors protect later callers from accidental edits to a fixture input. */
export function getSky130SymFixtures(): SymAssetInput[] {
  return fixtures.map(fixture => ({ ...fixture }))
}

export function parseAllSky130Fixtures(): SymParseResult[] {
  return getSky130SymFixtures().map(parseSymAsset)
}
