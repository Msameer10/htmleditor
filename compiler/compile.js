export function compileToHtmlBody(raw, rules = {}) {
  const text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const blocks = text.split(/\n\s*\n/g);
  const out = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (rules.headings !== false && trimmed.startsWith("# ")) {
      const title = trimmed.slice(2).trim();
      out.push(`<h2>${escapeHtml(title)}</h2>`);
      continue;
    }

    const oneLine = trimmed.replace(/\n+/g, " ");
    const escaped = escapeHtml(oneLine);
    out.push(`<p>${applyMarkers(escaped, rules.markers)}</p>`);
  }

  return out.join("\n");
}

function applyMarkers(escapedText, markerMap) {
  if (!markerMap || typeof markerMap !== "object") return escapedText;

  let html = escapedText;

  // For each marker key like "arabic", "b", "i":
  // Replace {key: ... } with configured tag/class
  for (const [key, cfg] of Object.entries(markerMap)) {
    const tag = cfg.tag ?? "span";
    const cls = cfg.class ? ` class="${cfg.class}"` : "";

    // {key:...} pattern; keep it simple for MVP (no nested braces)
    const re = new RegExp(`\\{${escapeRegExp(key)}:([^}]+)\\}`, "g");

    html = html.replace(re, (_, t) => {
      const inner = escapeHtml(t.trim());
      return `<${tag}${cls}>${inner}</${tag}>`;
    });
  }

  return html;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
