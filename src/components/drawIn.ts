// Makes an SVG draw itself, mark by mark. It uses the browser's animation API on elements already in the page, so nothing
// about the drawing changes once it's finished, and anyone who prefers reduced motion just sees the result.
const SHAPES = "path, line, polyline, polygon, rect, circle, ellipse, text";

export function drawIn(svg: SVGSVGElement, { duration = 2600, shapesFirst = false }: { duration?: number; shapesFirst?: boolean } = {}): number {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  const found = [...svg.querySelectorAll<SVGGraphicsElement>(SHAPES)].filter((element) => !element.closest("defs, marker, clipPath, pattern, title"));
  // In a block diagram the blocks come first, then the wires that join them.
  const shapes = shapesFirst ? [...found.filter((element) => element.tagName !== "path"), ...found.filter((element) => element.tagName === "path")] : found;
  if (!shapes.length) return 0;
  const step = duration / shapes.length;
  const each = Math.min(700, Math.max(160, step * 5));
  shapes.forEach((shape, index) => {
    const style = getComputedStyle(shape);
    const delay = index * step;
    const options: KeyframeAnimationOptions = { duration: each, delay, easing: "cubic-bezier(.3,.7,.3,1)", fill: "backwards" };
    const stroked = style.stroke !== "none" && parseFloat(style.strokeWidth) > 0 && shape.tagName !== "text";
    if (stroked && "getTotalLength" in shape) {
      const length = (shape as unknown as SVGGeometryElement).getTotalLength();
      if (length > 0) {
        shape.animate(
          [
            { strokeDasharray: `${length} ${length}`, strokeDashoffset: length, fillOpacity: 0 },
            { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0, fillOpacity: Number(style.fillOpacity) || 1 },
          ],
          options,
        );
        return;
      }
    }
    shape.animate([{ opacity: 0 }, { opacity: Number(style.opacity) || 1 }], options);
  });
  return duration + each;
}

const SAFE_TAGS = new Set(["svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse", "text", "tspan", "defs", "marker", "lineargradient", "radialgradient", "stop", "title", "desc", "clippath", "use"]);
const SAFE_ATTRIBUTE = /^(xmlns(:xlink)?|viewbox|width|height|x[12]?|y[12]?|cx|cy|r|rx|ry|d|points|fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-opacity|stroke-dasharray|stroke-linecap|stroke-linejoin|opacity|transform|font-family|font-size|font-weight|font-style|text-anchor|dominant-baseline|dx|dy|id|class|marker-(start|mid|end)|markerwidth|markerheight|markerunits|refx|refy|orient|offset|stop-color|stop-opacity|gradientunits|gradienttransform|clip-path|preserveaspectratio)$/i;

function copySafe(node: Element, target: Document): Element | undefined {
  if (!SAFE_TAGS.has(node.tagName.toLowerCase())) return undefined;
  const copy = target.createElementNS("http://www.w3.org/2000/svg", node.tagName);
  for (const attribute of [...node.attributes]) {
    if (SAFE_ATTRIBUTE.test(attribute.name) && !/url\(\s*['"]?(?!#)|javascript:/i.test(attribute.value)) copy.setAttribute(attribute.name, attribute.value);
    if (/^(xlink:)?href$/i.test(attribute.name) && attribute.value.startsWith("#")) copy.setAttribute("href", attribute.value);
  }
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) copy.appendChild(target.createTextNode(child.textContent ?? ""));
    else if (child.nodeType === Node.ELEMENT_NODE) {
      const kept = copySafe(child as Element, target);
      if (kept) copy.appendChild(kept);
    }
  }
  return copy;
}

// The assistant's SVG, rebuilt from an allowlist: only drawing elements and attributes survive, so it can't run anything
// or fetch anything, and can be drawn in place.
export function safeSvg(source: string): SVGSVGElement | undefined {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) return undefined;
  const copy = copySafe(root, document) as SVGSVGElement | undefined;
  if (!copy) return undefined;
  if (!copy.getAttribute("viewBox")) {
    const [width, height] = [parseFloat(root.getAttribute("width") ?? ""), parseFloat(root.getAttribute("height") ?? "")];
    if (width > 0 && height > 0) copy.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  copy.removeAttribute("width");
  copy.removeAttribute("height");
  return copy;
}
