import type { ReactNode } from "react";

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
  | "sliders";

const icons: Record<IconName, ReactNode> = {
  paperclip: <path d="m13.5 7.500-5.700 5.700a3.300 3.300 0 0 1-4.700-4.700l5.800-5.800a2.200 2.200 0 0 1 3.100 3.100l-5.700 5.700a1.100 1.100 0 0 1-1.600-1.600l5.200-5.200" />,
  camera: (
    <>
      <path d="M2 5.500a1 1 0 0 1 1-1h2.300l1-1.500h3.400l1 1.500H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
      <circle cx="8" cy="8.700" r="2.300" />
    </>
  ),
  graduation: (
    <>
      <path d="M1.500 6.200 8 3l6.500 3.200L8 9.400z" />
      <path d="M4.300 7.700v3.100c0 .8 1.700 1.700 3.700 1.700s3.700-.9 3.700-1.700V7.700" />
    </>
  ),
  eye: (
    <>
      <path d="M1.500 8S3.800 3.700 8 3.700 14.500 8 14.500 8 12.200 12.300 8 12.300 1.500 8 1.500 8z" />
      <circle cx="8" cy="8" r="1.900" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.300" />
      <path d="m13.500 13.500-3.400-3.400" />
    </>
  ),
  home: (
    <>
      <path d="M2.5 7.5 8 2.5l5.5 5" />
      <path d="M4 7v6.5h8V7" />
    </>
  ),
  schematic: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx=".5" />
      <rect x="9" y="9" width="4.5" height="4.5" rx=".5" />
      <path d="M7 4.75h2.5V9M4.75 7v3.5H9" />
    </>
  ),
  layout: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 6h12M6 6v8M6 10h8" />
    </>
  ),
  constraints: (
    <>
      <path d="M2 4h12M2 8h12M2 12h12" />
      <circle cx="6" cy="4" r="1.4" />
      <circle cx="10" cy="8" r="1.4" />
      <circle cx="5" cy="12" r="1.4" />
    </>
  ),
  verification: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="m5 8 2 2 4-4" />
    </>
  ),
  plot: (
    <>
      <path d="M2 13h12M3 11l3-4 3 2 4-6" />
      <circle cx="13" cy="3" r=".8" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="m4.5 6.5 2 1.5-2 1.5M8.5 10h3" />
    </>
  ),
  export: (
    <>
      <path d="M8 2v8M5 7l3 3 3-3" />
      <path d="M3 12v2h10v-2" />
    </>
  ),
  file: (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </>
  ),
  folder: (
    <>
      <path d="M2 4h4l1.5 2H14v7H2z" />
    </>
  ),
  chevronDown: <path d="m4 6 4 4 4-4" />,
  chevronRight: <path d="m6 4 4 4-4 4" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  play: <path d="M5 3.5 12.5 8 5 12.5z" />,
  plus: <path d="M8 3v10M3 8h10" />,
  sparkles: (
    <>
      <path d="m8 2 1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2z" />
      <path d="m12.5 10 .6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.1 1.1M11.15 11.15l1.1 1.1M12.25 3.75l-1.1 1.1M4.85 11.15l-1.1 1.1" />
    </>
  ),
  sync: (
    <path d="M13 6a5 5 0 0 0-8.7-3L3 5m0 0V2m0 3h3M3 10a5 5 0 0 0 8.7 3L13 11m0 0v3m0-3h-3" />
  ),
  warning: (
    <>
      <path d="M8 2 14 13H2z" />
      <path d="M8 6v3.5M8 11.5v.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  history: (
    <>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.5" />
      <path d="M2.5 2.5v3h3M8 5v3.2l2.2 1.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M13 6a5 5 0 0 0-8.7-3L3 5m0 0V2m0 3h3" />
      <path d="M3 10a5 5 0 0 0 8.7 3L13 11m0 0v3m0-3h-3" />
    </>
  ),
  layers: (
    <>
      <path d="m8 2 6 3-6 3-6-3z" />
      <path d="m2 8 6 3 6-3M2 11l6 3 6-3" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.4 10.4 3.1 3.1M7 5v4M5 7h4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.4 10.4 3.1 3.1M5 7h4" />
    </>
  ),
  fit: (
    <>
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </>
  ),
  external: (
    <>
      <path d="M9 3h4v4M13 3 7.5 8.5" />
      <path d="M12 9v4H3V4h4" />
    </>
  ),
  save: (
    <>
      <path d="M3 2h8l2 2v10H3z" />
      <path d="M5 2v4h5V2M5 14v-4h6v4" />
    </>
  ),
  download: (
    <>
      <path d="M8 2v7M5 6.5 8 9.5l3-3" />
      <path d="M3 12v2h10v-2" />
    </>
  ),
  check: <path d="m3 8 3 3 7-7" />,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" stroke="none" />,
  more: (
    <>
      <circle cx="8" cy="3.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  bulb: <path d="M6 13h4M6.5 11h3c0-1.6 2.5-2.4 2.5-5a4 4 0 0 0-8 0c0 2.6 2.5 3.4 2.5 5Z" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="7" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  code: <path d="m5 4-4 4 4 4M11 4l4 4-4 4M9.5 2.5l-3 11" />,
  sliders: (
    <>
      <path d="M2 5h5M9 5h5M2 11h8M12 11h2" />
      <circle cx="8" cy="5" r="1.4" />
      <circle cx="11" cy="11" r="1.4" />
    </>
  ),
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
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
