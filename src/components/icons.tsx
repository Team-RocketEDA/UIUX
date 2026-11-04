// The app's icons, from Phosphor (https://phosphoricons.com). Named by what they mean here, so a page never has to
// know which drawing it uses. Only the ones listed are bundled.
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  CameraIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChartLineIcon,
  CheckIcon,
  CircuitryIcon,
  ClockIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  CornersOutIcon,
  CpuIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  ExportIcon,
  EyeIcon,
  FileIcon,
  FloppyDiskIcon,
  FolderIcon,
  GearIcon,
  GraduationCapIcon,
  HouseIcon,
  ImageIcon,
  LightbulbIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PaperclipIcon,
  PlayIcon,
  PlusIcon,
  SealCheckIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  StackIcon,
  StopIcon,
  TerminalWindowIcon,
  TreeStructureIcon,
  WarningIcon,
  XIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export type IconName =
  | "home"
  | "schematic"
  | "layout"
  | "constraints"
  | "verification"
  | "plot"
  | "terminal"
  | "export"
  | "file"
  | "folder"
  | "chevronDown"
  | "chevronRight"
  | "close"
  | "play"
  | "plus"
  | "sparkles"
  | "paperclip"
  | "camera"
  | "graduation"
  | "eye"
  | "search"
  | "settings"
  | "sync"
  | "warning"
  | "clock"
  | "history"
  | "refresh"
  | "layers"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "external"
  | "arrowUp"
  | "stop"
  | "more"
  | "bulb"
  | "save"
  | "download"
  | "check"
  | "x"
  | "lock"
  | "code"
  | "sliders"
  | "image"
  | "diagram";

const ICONS: Record<IconName, PhosphorIcon> = {
  home: HouseIcon,
  schematic: CircuitryIcon,
  layout: CpuIcon,
  constraints: SlidersHorizontalIcon,
  verification: SealCheckIcon,
  plot: ChartLineIcon,
  terminal: TerminalWindowIcon,
  export: ExportIcon,
  file: FileIcon,
  folder: FolderIcon,
  chevronDown: CaretDownIcon,
  chevronRight: CaretRightIcon,
  close: XIcon,
  play: PlayIcon,
  plus: PlusIcon,
  sparkles: SparkleIcon,
  paperclip: PaperclipIcon,
  camera: CameraIcon,
  graduation: GraduationCapIcon,
  eye: EyeIcon,
  search: MagnifyingGlassIcon,
  settings: GearIcon,
  sync: ArrowsClockwiseIcon,
  warning: WarningIcon,
  clock: ClockIcon,
  history: ClockCounterClockwiseIcon,
  refresh: ArrowClockwiseIcon,
  layers: StackIcon,
  zoomIn: MagnifyingGlassPlusIcon,
  zoomOut: MagnifyingGlassMinusIcon,
  fit: CornersOutIcon,
  external: ArrowSquareOutIcon,
  arrowUp: ArrowUpIcon,
  stop: StopIcon,
  more: DotsThreeVerticalIcon,
  bulb: LightbulbIcon,
  save: FloppyDiskIcon,
  download: DownloadSimpleIcon,
  check: CheckIcon,
  x: XIcon,
  lock: LockIcon,
  code: CodeIcon,
  sliders: SlidersHorizontalIcon,
  image: ImageIcon,
  diagram: TreeStructureIcon,
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Drawing = ICONS[name];
  return <Drawing className={className} size={size} weight="regular" aria-hidden="true" />;
}
