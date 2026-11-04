// Pictures and PDFs for Muse Spark: files the student picks, and what's on screen right now. Everything stays a
// data: URL in the browser until it's sent, through the server, which holds the key.
import type { Attachment } from "./fuel";

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
const MAX_BYTES = 20 * 1024 * 1024;
const BACKGROUND = "#0f0e0e";

export function attachmentFromFile(file: File): Promise<Attachment> {
  if (!ACCEPTED.has(file.type)) return Promise.reject(new Error(`${file.name}: use a PNG, JPEG, WebP or GIF picture, or a PDF.`));
  if (file.size > MAX_BYTES) return Promise.reject(new Error(`${file.name} is larger than 20 MB.`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.onload = () => resolve({ name: file.name || "pasted-picture.png", mime: file.type, url: String(reader.result) });
    reader.readAsDataURL(file);
  });
}

// A canvas with a transparent background, on the app's dark one, as a PNG.
export function canvasPicture(canvas: HTMLCanvasElement): string {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d")!;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat.toDataURL("image/png");
}

const SVG_STYLES = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline"];

// An SVG's look comes from the page's CSS, which a picture of it doesn't have, so each element's computed style is
// copied onto it first.
function svgImage(svg: SVGSVGElement): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  const { width, height } = svg.getBoundingClientRect();
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((element, i) => {
    const style = getComputedStyle(element);
    for (const name of SVG_STYLES) (to[i] as SVGElement).style.setProperty(name, style.getPropertyValue(name));
  });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, width, height });
    image.onerror = () => reject(new Error("Couldn't draw that view."));
    image.src = url;
  });
}

async function svgsPicture(svgs: SVGSVGElement[]): Promise<string> {
  const images = await Promise.all(svgs.map(svgImage));
  const scale = Math.min(2, window.devicePixelRatio * 2 || 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(Math.max(...images.map((i) => i.width)) * scale);
  canvas.height = Math.ceil(images.reduce((sum, i) => sum + i.height, 0) * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const { image, width, height } of images) {
    ctx.drawImage(image, 0, y, width * scale, height * scale);
    y += height * scale;
  }
  return canvas.toDataURL("image/png");
}

// What the student has open: the layout, the plots or the schematic. Nothing, on any other page.
export async function captureView(): Promise<Attachment | undefined> {
  const layout = document.querySelector<HTMLCanvasElement>(".layout-canvas canvas");
  if (layout) return { name: "layout-view.png", mime: "image/png", url: canvasPicture(layout) };
  const plots = [...document.querySelectorAll<SVGSVGElement>("svg.plot")].slice(0, 4);
  if (plots.length) return { name: "plots-view.png", mime: "image/png", url: await svgsPicture(plots) };
  const schematic = [...document.querySelectorAll<SVGSVGElement>(".schematic-canvas svg")].sort(
    (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width,
  )[0];
  if (schematic) return { name: "schematic-view.png", mime: "image/png", url: await svgsPicture([schematic]) };
  return undefined;
}

export type FoundBox = { id: number; x1: number; y1: number; x2: number; y2: number; w: number; h: number };

export async function segmentView(image: string, prompt: string): Promise<{ boxes: FoundBox[] }> {
  const response = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, prompt }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Find failed: ${response.status}`);
  return body;
}
