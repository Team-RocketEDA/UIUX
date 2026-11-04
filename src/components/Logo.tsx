// The RocketIDE mark (Launch Chip): a rocket whose body carries a chip's pins, on the accent tile.
// The same drawing as RocketIDE/docs/brand/logo.svg. "launch" plays the brand intro once, "loop" keeps the
// rocket floating with its flame flickering (for waiting states). Both stop under reduced motion.
export function Logo({ size = 26, animate, title }: { size?: number; animate?: "launch" | "loop"; title?: string }) {
  return (
    <svg
      className={`logo${animate ? ` logo-${animate}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <clipPath id="logo-tile-clip">
        <rect width="64" height="64" rx="15" />
      </clipPath>
      <rect className="logo-tile" width="64" height="64" rx="15" fill="#ee6a4c" />
      <g clipPath="url(#logo-tile-clip)">
        <g className="logo-rocket">
          <path className="logo-flame" d="M27.6 49h8.8L32 57.5z" fill="#ffd3c6" />
          <path d="M22.8 36.5 15.5 45v5.2l7.3-3.2zM41.2 36.5 48.5 45v5.2l-7.3-3.2z" fill="#fff" />
          <path d="M32 8.5c6.4 5.2 9.2 12.6 9.2 21.6V46H22.8V30.1c0-9 2.8-16.4 9.2-21.6z" fill="#fff" />
          <circle className="logo-window" cx="32" cy="27" r="4.3" fill="#ee6a4c" />
          <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
            <path className="logo-pin" d="M17.8 23.5h5" />
            <path className="logo-pin" d="M41.2 23.5h5" />
            <path className="logo-pin" d="M17.8 30h5" />
            <path className="logo-pin" d="M41.2 30h5" />
          </g>
        </g>
      </g>
    </svg>
  );
}
