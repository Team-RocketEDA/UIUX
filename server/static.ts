// Serves the built UI (dist/) beside the workspace server when Electron main hosts both.
// In development the Vite dev server does this job instead.
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function isFile(full: string) {
  return existsSync(full) && statSync(full).isFile();
}

// The file under root for a request path; index.html for a path without an extension (the app itself);
// undefined when there is no such file or the path leaves root.
export function staticPath(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const base = path.resolve(root);
  const full = path.resolve(base, "." + decoded);
  if (full !== base && !full.startsWith(base + path.sep)) return undefined;
  if (isFile(full)) return full;
  const index = path.join(base, "index.html");
  return !path.extname(decoded) && isFile(index) ? index : undefined;
}

export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const file = req.method === "GET" || req.method === "HEAD" ? staticPath(root, url.pathname) : undefined;
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Not found: ${url.pathname}`);
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}
