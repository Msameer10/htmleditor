import { compileToHtmlBody } from "./compiler/compile.js";

const presetSelect = document.getElementById("presetSelect");
const draftSelect = document.getElementById("draftSelect");
const newDraftBtn = document.getElementById("newDraftBtn");
const saveAsBtn = document.getElementById("saveAsBtn");
const deleteDraftBtn = document.getElementById("deleteDraftBtn");

const titleInput = document.getElementById("titleInput");
const filenameInput = document.getElementById("filenameInput");
const sourceInput = document.getElementById("sourceInput");
const previewFrame = document.getElementById("previewFrame");
const downloadBtn = document.getElementById("downloadBtn");

const saveChip = document.getElementById("saveChip");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const refList = document.getElementById("refList");
const themeIcon = document.getElementById("themeIcon");

// Collapsible reference (new)
const refBox = document.getElementById("refBox");
const refToggleBtn = document.getElementById("refToggleBtn");
const markerSuggest = document.getElementById("markerSuggest");


// Add presets here as you create more folders in /presets
const PRESET_PATHS = ["./presets/basair/preset.json"];

let currentPreset = null;
let currentTemplate = null;
let currentDraftId = null;

let autosaveTimer = null;
const AUTOSAVE_MS = 400;

// ---------- Storage helpers ----------
const APP_NS = "builderapp:v1";

function presetKey(presetId) {
  return `${APP_NS}:preset:${presetId}`;
}
function draftsIndexKey(presetId) {
  return `${presetKey(presetId)}:draftsIndex`;
}
function draftDocKey(presetId, draftId) {
  return `${presetKey(presetId)}:draft:${draftId}`;
}
function activeDraftKey(presetId) {
  return `${presetKey(presetId)}:activeDraft`;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function makeDraftDoc({ id, name, title, filename, source }) {
  const now = new Date().toISOString();
  return {
    id,
    name: name ?? "Untitled",
    title: title ?? "",
    filename: filename ?? "",
    source: source ?? "",
    createdAt: now,
    updatedAt: now,
  };
}

function generateId() {
  return `d_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ---------- Save chip ----------
function setChip(state, text) {
  if (!saveChip) return;
  saveChip.classList.remove("chip--idle", "chip--dirty", "chip--saved");
  saveChip.classList.add(state);
  saveChip.textContent = text;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------- App init ----------
init();

async function init() {
  // Editor UX
  enablePairAutocomplete(sourceInput);

  // Theme
  initTheme();
  themeToggleBtn?.addEventListener("click", toggleTheme);

  // Reference drawer
  initReferenceToggle();

  // Populate preset dropdown
  const presets = await Promise.all(PRESET_PATHS.map(loadPreset));
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.value = p.path;
    opt.textContent = p.data.name ?? p.data.id ?? p.path;
    presetSelect.appendChild(opt);
  }

  presetSelect.addEventListener("change", async () => {
    await setPreset(presetSelect.value);
    closeMarkerSuggest();
    renderReference();
    await initDraftsForPreset();
    render();
  });

  // Default preset
  await setPreset(presets[0].path);
  renderReference();
  await initDraftsForPreset();

  enableMarkerSuggestions(sourceInput);

  // Wire up rendering + autosave
  for (const el of [titleInput, filenameInput, sourceInput]) {
    el.addEventListener("input", () => {
      render();
      setChip("chip--dirty", "Editing…");
      queueAutosave();
    });
  }

  downloadBtn.addEventListener("click", downloadHtml);

  // Draft controls
  draftSelect.addEventListener("change", async () => {
    const id = draftSelect.value;
    if (!id) return;
    await loadDraft(id);
  });

  newDraftBtn.addEventListener("click", async () => {
    await newDraft();
  });

  saveAsBtn.addEventListener("click", async () => {
    await saveAsDraft();
  });

  deleteDraftBtn.addEventListener("click", async () => {
    await deleteCurrentDraft();
  });

  setChip("chip--idle", "Saved");
  render();
}

async function loadPreset(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load preset: ${path}`);
  const data = await res.json();
  return { path, data };
}

async function setPreset(presetJsonPath) {
  const presetRes = await fetch(presetJsonPath);
  if (!presetRes.ok)
    throw new Error(`Failed to load preset json: ${presetJsonPath}`);
  const preset = await presetRes.json();

  const baseDir = presetJsonPath.split("/").slice(0, -1).join("/");
  const templatePath = `${baseDir}/${preset.template}`;

  const templateRes = await fetch(templatePath);
  if (!templateRes.ok) throw new Error(`Failed to load template: ${templatePath}`);
  const template = await templateRes.text();

  currentPreset = { ...preset, baseDir, presetJsonPath };
  currentTemplate = template;
}

// ---------- Reference drawer ----------
function initReferenceToggle() {
  if (!refBox || !refToggleBtn) return;

  const saved = localStorage.getItem("builderapp:refCollapsed");
  const collapsed = saved === "1";
  setReferenceCollapsed(collapsed);

  refToggleBtn.addEventListener("click", () => {
    const isCollapsed = refBox.classList.contains("is-collapsed");
    const next = !isCollapsed;
    setReferenceCollapsed(next);
    localStorage.setItem("builderapp:refCollapsed", next ? "1" : "0");
  });
}

function setReferenceCollapsed(collapsed) {
  if (!refBox || !refToggleBtn) return;
  refBox.classList.toggle("is-collapsed", collapsed);
  refToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

// ---------- Reference sheet ----------
function renderReference() {
  if (!refList) return;

  const items = currentPreset?.reference ?? [];

  if (!items.length) {
    // fallback: auto-generate from markers if reference not provided
    const markers = currentPreset?.rules?.markers;
    if (markers && typeof markers === "object") {
      const auto = Object.keys(markers).map((k) => ({
        syntax: `{${k}:...}`,
        meaning: k === "arabic" ? "Arabic text" : `${k} marker`,
      }));
      refList.innerHTML = auto.map(renderRefItem).join("");
      return;
    }

    refList.innerHTML = `<div class="muted">No reference items defined for this preset.</div>`;
    return;
  }

  refList.innerHTML = items.map(renderRefItem).join("");
}

function renderRefItem(it) {
  const syntax = escapeHtml(it.syntax ?? "");
  const meaning = escapeHtml(it.meaning ?? "");
  return `
    <div class="refitem">
      <div><code>${syntax}</code></div>
      <div>${meaning}</div>
    </div>
  `;
}

// ---------- Draft system ----------
async function initDraftsForPreset() {
  const presetId = currentPreset.id ?? "default";

  // Ensure drafts index exists
  let index = loadJson(draftsIndexKey(presetId), null);
  if (!index) {
    index = { order: [], meta: {} }; // meta[draftId] = { name, updatedAt }
    saveJson(draftsIndexKey(presetId), index);
  }

  // Ensure at least one draft exists
  if (index.order.length === 0) {
    const starter = makeDraftDoc({
      id: generateId(),
      name: "Draft 1",
      title: currentPreset.defaultTitle ?? "Page",
      filename: `${presetId}-page.html`,
      source: currentPreset.defaultContent ?? "",
    });

    persistDraft(presetId, starter);
    index.order.unshift(starter.id);
    index.meta[starter.id] = { name: starter.name, updatedAt: starter.updatedAt };
    saveJson(draftsIndexKey(presetId), index);
    saveJson(activeDraftKey(presetId), starter.id);
  }

  // Load last active draft for this preset
  const active = loadJson(activeDraftKey(presetId), index.order[0]);
  await loadDraft(active);

  refreshDraftDropdown();
}

function refreshDraftDropdown() {
  const presetId = currentPreset.id ?? "default";
  const index = loadJson(draftsIndexKey(presetId), { order: [], meta: {} });

  draftSelect.innerHTML = "";
  for (const id of index.order) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = index.meta[id]?.name ?? id;
    draftSelect.appendChild(opt);
  }

  if (currentDraftId) {
    draftSelect.value = currentDraftId;
  }
}

async function loadDraft(draftId) {
  const presetId = currentPreset.id ?? "default";
  const doc = loadJson(draftDocKey(presetId, draftId), null);

  if (!doc) {
    // fallback to first if missing
    const index = loadJson(draftsIndexKey(presetId), { order: [], meta: {} });
    const fallback = index.order[0];
    if (fallback && fallback !== draftId) return loadDraft(fallback);
    return;
  }

  currentDraftId = draftId;
  saveJson(activeDraftKey(presetId), draftId);

  titleInput.value = doc.title ?? "";
  filenameInput.value = doc.filename ?? "";
  sourceInput.value = doc.source ?? "";

  refreshDraftDropdown();
  render();

  if (doc.updatedAt) setChip("chip--saved", `Saved ✓ ${formatTime(doc.updatedAt)}`);
  else setChip("chip--idle", "Saved");
}

async function newDraft() {
  const presetId = currentPreset.id ?? "default";
  const index = loadJson(draftsIndexKey(presetId), { order: [], meta: {} });

  const name = prompt("Name this new draft:", `Draft ${index.order.length + 1}`);
  if (!name) return;

  const doc = makeDraftDoc({
    id: generateId(),
    name,
    title: currentPreset.defaultTitle ?? "Page",
    filename: `${presetId}-page.html`,
    source: currentPreset.defaultContent ?? "",
  });

  persistDraft(presetId, doc);

  index.order.unshift(doc.id);
  index.meta[doc.id] = { name: doc.name, updatedAt: doc.updatedAt };
  saveJson(draftsIndexKey(presetId), index);

  await loadDraft(doc.id);
  setChip("chip--saved", `Saved ✓ ${formatTime(doc.updatedAt)}`);
}

async function saveAsDraft() {
  const presetId = currentPreset.id ?? "default";
  const index = loadJson(draftsIndexKey(presetId), { order: [], meta: {} });

  const name = prompt("Save As (draft name):", "Copy of draft");
  if (!name) return;

  const doc = makeDraftDoc({
    id: generateId(),
    name,
    title: titleInput.value,
    filename: filenameInput.value,
    source: sourceInput.value,
  });

  persistDraft(presetId, doc);

  index.order.unshift(doc.id);
  index.meta[doc.id] = { name: doc.name, updatedAt: doc.updatedAt };
  saveJson(draftsIndexKey(presetId), index);

  await loadDraft(doc.id);
  setChip("chip--saved", `Saved ✓ ${formatTime(doc.updatedAt)}`);
}

async function deleteCurrentDraft() {
  const presetId = currentPreset.id ?? "default";
  const index = loadJson(draftsIndexKey(presetId), { order: [], meta: {} });

  if (!currentDraftId) return;

  if (index.order.length <= 1) {
    alert("You must keep at least one draft.");
    return;
  }

  const name = index.meta[currentDraftId]?.name ?? "this draft";
  const ok = confirm(`Delete "${name}"? This cannot be undone.`);
  if (!ok) return;

  localStorage.removeItem(draftDocKey(presetId, currentDraftId));
  index.order = index.order.filter((id) => id !== currentDraftId);
  delete index.meta[currentDraftId];
  saveJson(draftsIndexKey(presetId), index);

  const nextId = index.order[0];
  await loadDraft(nextId);
}

function persistDraft(presetId, doc) {
  doc.updatedAt = new Date().toISOString();
  saveJson(draftDocKey(presetId, doc.id), doc);
}

function queueAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveNow();
  }, AUTOSAVE_MS);
}

function autosaveNow() {
  const presetId = currentPreset.id ?? "default";
  if (!currentDraftId) return;

  const doc = loadJson(draftDocKey(presetId, currentDraftId), null);
  if (!doc) return;

  doc.title = titleInput.value;
  doc.filename = filenameInput.value;
  doc.source = sourceInput.value;
  doc.updatedAt = new Date().toISOString();

  persistDraft(presetId, doc);

  const index = loadJson(draftsIndexKey(presetId), { order: [], meta: {} });
  if (!index.meta[currentDraftId])
    index.meta[currentDraftId] = { name: doc.name, updatedAt: doc.updatedAt };
  index.meta[currentDraftId].updatedAt = doc.updatedAt;
  saveJson(draftsIndexKey(presetId), index);

  setChip("chip--saved", `Saved ✓ ${formatTime(doc.updatedAt)}`);
}

// ---------- Render + download ----------
function render() {
  if (!currentPreset || !currentTemplate) return;

  const title = titleInput.value.trim() || (currentPreset.defaultTitle ?? "Page");
  const rules = currentPreset.rules ?? {};
  const bodyHtml = compileToHtmlBody(sourceInput.value, rules);

  const finalHtml = applyTemplate(currentTemplate, {
    title,
    content: bodyHtml,
  });

  const doc = previewFrame.contentDocument;
  doc.open();
  doc.write(finalHtml);
  doc.close();
}

function applyTemplate(template, vars) {
  return template
    .replaceAll("{{title}}", vars.title ?? "")
    .replaceAll("{{content}}", vars.content ?? "");
}

function downloadHtml() {
  if (!currentPreset || !currentTemplate) return;

  const title = titleInput.value.trim() || (currentPreset.defaultTitle ?? "Page");
  const rules = currentPreset.rules ?? {};
  const bodyHtml = compileToHtmlBody(sourceInput.value, rules);

  const finalHtml = applyTemplate(currentTemplate, { title, content: bodyHtml });
  const filename = (filenameInput.value.trim() || "page.html").replace(/[/\\]/g, "-");

  const blob = new Blob([finalHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// ---------- Editor pair autocomplete ----------
function enablePairAutocomplete(textarea) {
  const PAIRS = {
    "{": "}",
    "(": ")",
    "[": "]",
    "<": ">",
    '"': '"',
    "'": "'",
  };

  textarea.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const open = e.key;
    const close = PAIRS[open];

    // Wrap / insert pair
    if (close) {
      e.preventDefault();

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const selected = value.slice(start, end);

      textarea.value = value.slice(0, start) + open + selected + close + value.slice(end);

      if (selected.length > 0) {
        textarea.selectionStart = start + 1;
        textarea.selectionEnd = end + 1;
      } else {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      }

      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // Skip over an auto-inserted closing bracket/quote
    const isClosing = Object.values(PAIRS).includes(e.key);
    if (isClosing) {
      const pos = textarea.selectionStart;
      const pos2 = textarea.selectionEnd;
      if (pos === pos2) {
        const nextChar = textarea.value.slice(pos, pos + 1);
        if (nextChar === e.key) {
          e.preventDefault();
          textarea.selectionStart = textarea.selectionEnd = pos + 1;
        }
      }
    }
  });
}

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem("builderapp:theme");
  const initial = saved || "light";
  document.documentElement.setAttribute("data-theme", initial);
  setThemeBtnLabel(initial);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("builderapp:theme", next);
  setThemeBtnLabel(next);
}

function setThemeBtnLabel(theme) {
  if (!themeIcon) return;

  if (theme === "dark") {
    // Show sun (switching to light)
    themeIcon.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    `;
  } else {
    // Show moon (switching to dark)
    themeIcon.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12.79A9 9 0 1 1 11.21 3
                 7 7 0 0 0 21 12.79z"/>
      </svg>
    `;
  }
}


// ---------- Util ----------
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let markerSuggestState = {
  wired: false,
  open: false,
  items: [],
  activeIndex: 0,
  bracePos: -1,
};

function enableMarkerSuggestions(textarea) {
  if (!textarea || !markerSuggest) return;

  // Avoid double binding
  if (markerSuggestState.wired) {
    // just refresh markers list on preset change
    return;
  }
  markerSuggestState.wired = true;

  textarea.addEventListener("input", () => {
    updateMarkerSuggest(textarea);
  });

  textarea.addEventListener("keydown", (e) => {
    if (!markerSuggestState.open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      markerSuggestState.activeIndex = Math.min(
        markerSuggestState.activeIndex + 1,
        markerSuggestState.items.length - 1
      );
      renderMarkerSuggest();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      markerSuggestState.activeIndex = Math.max(markerSuggestState.activeIndex - 1, 0);
      renderMarkerSuggest();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeMarkerSuggest();
      return;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const chosen = markerSuggestState.items[markerSuggestState.activeIndex];
      if (chosen) applyMarkerSuggestion(textarea, chosen);
      return;
    }
  });

  // Click outside to close
  document.addEventListener("mousedown", (e) => {
    if (!markerSuggestState.open) return;
    if (e.target === markerSuggest || markerSuggest.contains(e.target)) return;
    if (e.target === textarea) return;
    closeMarkerSuggest();
  });

  markerSuggest.addEventListener("mousedown", (e) => {
    const itemEl = e.target.closest("[data-marker]");
    if (!itemEl) return;
    e.preventDefault(); // don't blur textarea
    const marker = itemEl.getAttribute("data-marker");
    if (!marker) return;
    applyMarkerSuggestion(textarea, marker);
  });
}

function updateMarkerSuggest(textarea) {
  const markersObj = currentPreset?.rules?.markers;
  const keys = markersObj && typeof markersObj === "object" ? Object.keys(markersObj) : [];
  if (keys.length === 0) {
    closeMarkerSuggest();
    return;
  }

  const pos = textarea.selectionStart;
  const text = textarea.value;

  // Find nearest unmatched '{' between line start and cursor
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const uptoCursor = text.slice(lineStart, pos);

  const bracePosInLine = uptoCursor.lastIndexOf("{");
  if (bracePosInLine === -1) {
    closeMarkerSuggest();
    return;
  }

  const absoluteBracePos = lineStart + bracePosInLine;

  // Don’t trigger if already closed or already has ':'
  const typed = text.slice(absoluteBracePos + 1, pos);
  if (typed.includes("}") || typed.includes(":")) {
    closeMarkerSuggest();
    return;
  }

  // Only letters allowed in the typed part for suggestion
  if (!/^[a-zA-Z0-9_-]*$/.test(typed)) {
    closeMarkerSuggest();
    return;
  }

  const query = typed.toLowerCase();

  const matches = keys
    .filter(k => k.toLowerCase().startsWith(query))
    .slice(0, 8);

  if (matches.length === 0) {
    closeMarkerSuggest();
    return;
  }

  markerSuggestState.items = matches;
  markerSuggestState.activeIndex = 0;
  markerSuggestState.bracePos = absoluteBracePos;

  openMarkerSuggestAtTextarea(textarea);
  renderMarkerSuggest();
}

function openMarkerSuggestAtTextarea(textarea) {
  const caret = getTextareaCaretXY(textarea, textarea.selectionStart);

  // caret is in page coords; convert to panel-relative coords (because dropdown is absolute in panel)
  const panel = textarea.closest(".panel");
  const panelRect = panel?.getBoundingClientRect();

  const top = panelRect ? (caret.top - panelRect.top + 22) : (caret.top + 22); // 22px below caret
  const left = panelRect ? (caret.left - panelRect.left) : caret.left;

  markerSuggest.style.top = `${top}px`;
  markerSuggest.style.left = `${left}px`;

  markerSuggest.classList.remove("hidden");
  markerSuggestState.open = true;
}


function renderMarkerSuggest() {
  const items = markerSuggestState.items;
  const active = markerSuggestState.activeIndex;

  // build meaning hints from preset reference (optional)
  const ref = currentPreset?.reference ?? [];
  const meaningMap = new Map();
  for (const r of ref) {
    // r.key is optional; we’ll infer from syntax {key:...}
    if (r.key) meaningMap.set(r.key, r.meaning);
    else if (typeof r.syntax === "string") {
      const m = r.syntax.match(/^\{([^:]+):/);
      if (m) meaningMap.set(m[1], r.meaning);
    }
  }

  markerSuggest.innerHTML = items.map((k, idx) => {
    const meaning = meaningMap.get(k) ?? "";
    return `
      <div class="msuggest__item ${idx === active ? "is-active" : ""}" data-marker="${escapeHtml(k)}" role="option" aria-selected="${idx === active}">
        <div class="msuggest__key">${escapeHtml(k)}</div>
        <div class="msuggest__hint">${escapeHtml(meaning)}</div>
      </div>
    `;
  }).join("");
}

function applyMarkerSuggestion(textarea, markerKey) {
  const bracePos = markerSuggestState.bracePos;
  if (bracePos < 0) return;

  const pos = textarea.selectionStart;
  const text = textarea.value;

  // text between '{' and cursor (what user typed, e.g. "a")
  const typed = text.slice(bracePos + 1, pos);

  // If pair-autocomplete already inserted a closing '}' right after cursor, reuse it
  const nextChar = text.slice(pos, pos + 1);
  const hasAutoClose = nextChar === "}";

  // Replace "{<typed>" with "{marker:" and then:
  // - if we already have '}' next, do NOT add another '}'
  // - else add '}'
  const before = text.slice(0, bracePos);     // before '{'
  const after = text.slice(pos);             // from cursor onwards (includes possible auto '}')

  const insert = hasAutoClose ? `{${markerKey}:` : `{${markerKey}:}`;
  textarea.value = before + insert + after;

  // Place cursor right after the colon
  const newCursor = before.length + (`{${markerKey}:`).length;
  textarea.selectionStart = textarea.selectionEnd = newCursor;

  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  closeMarkerSuggest();
}


function closeMarkerSuggest() {
  if (!markerSuggest) return;
  markerSuggest.classList.add("hidden");
  markerSuggestState.open = false;
  markerSuggestState.items = [];
  markerSuggestState.activeIndex = 0;
  markerSuggestState.bracePos = -1;
}

function getTextareaCaretXY(textarea, pos) {
  const style = window.getComputedStyle(textarea);

  // Mirror div
  const div = document.createElement("div");
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";

  // Copy key textarea styles so wrapping matches exactly
  div.style.font = style.font;
  div.style.fontSize = style.fontSize;
  div.style.fontFamily = style.fontFamily;
  div.style.lineHeight = style.lineHeight;
  div.style.letterSpacing = style.letterSpacing;

  div.style.padding = style.padding;
  div.style.border = style.border;
  div.style.boxSizing = style.boxSizing;

  div.style.width = style.width;

  // Account for textarea scroll
  const text = textarea.value.substring(0, pos);
  div.textContent = text;

  // Caret marker
  const span = document.createElement("span");
  span.textContent = "\u200b"; // zero-width space
  div.appendChild(span);

  document.body.appendChild(div);

  // Place mirror on top of textarea (page coords)
  const rect = textarea.getBoundingClientRect();
  div.style.left = `${rect.left}px`;
  div.style.top = `${rect.top}px`;

  // Now compute caret position
  const spanRect = span.getBoundingClientRect();

  document.body.removeChild(div);

  // Adjust for textarea scrollTop/scrollLeft
  return {
    left: spanRect.left - textarea.scrollLeft,
    top: spanRect.top - textarea.scrollTop,
  };
}
