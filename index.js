const { Dialog, Menu, Plugin, confirm, fetchPost, getFrontend, showMessage } = require("siyuan");
const fs = require("fs");
const { execFile } = require("child_process");

const PLUGIN_NAME = "siyuan-pandoc-pdf-exporter";
const SETTINGS_FILE = "settings.json";

const PAPER_SIZES = {
  a3: { label: "A3", widthMm: 297, heightMm: 420 },
  a4: { label: "A4", widthMm: 210, heightMm: 297 },
  letter: { label: "Letter", widthMm: 215.9, heightMm: 279.4 },
  hd: { label: "HD screen", widthMm: 254, heightMm: 142.875 },
  fhd: { label: "FHD screen", widthMm: 338.667, heightMm: 190.5 },
};

const DEFAULT_SETTINGS = {
  paperSize: "a4",
  orientation: "portrait",
  marginTop: 2,
  marginBottom: 2,
  marginLeft: 2,
  marginRight: 2,
  pageNumber: true,
  headerEnabled: true,
  footerEnabled: true,
  headerLeft: "",
  headerCenter: "",
  headerRight: "",
  footerLeft: "",
  footerCenter: "%page/%pages",
  footerRight: "",
  fontFamily: "",
  contentFontSize: 12,
  titleFontSize: 22,
  paragraphSpacing: 0.35,
  includeTitle: true,
  titleAlign: "center",
  textAlign: "left",
  imageWidth: 65,
};

function post(endpoint, payload) {
  return new Promise((resolve, reject) => {
    fetchPost(endpoint, payload || {}, (response) => {
      if (!response || response.code !== 0) {
        reject(new Error(response && response.msg ? response.msg : `SiYuan API failed: ${endpoint}`));
        return;
      }
      resolve(response);
    });
  });
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugFileName(value) {
  const safe = String(value || "siyuan-page")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return safe || "siyuan-page";
}

function mmToPx(mm) {
  return (Number(mm) || 0) * 96 / 25.4;
}

function getPaper(settings) {
  const base = PAPER_SIZES[settings.paperSize] || PAPER_SIZES.a4;
  if (settings.orientation === "landscape") {
    return { widthMm: base.heightMm, heightMm: base.widthMm, label: `${base.label} landscape` };
  }
  return { widthMm: base.widthMm, heightMm: base.heightMm, label: `${base.label} portrait` };
}

function nowTokens() {
  const date = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`,
    hour: `${two(date.getHours())}:${two(date.getMinutes())}`,
  };
}

function markdownLinks(text) {
  return String(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function expandTokens(template, context) {
  const tokens = nowTokens();
  return String(template || "")
    .replace(/\{\s*NUMPAGES\s*\}/gi, String(context.pages || ""))
    .replace(/\{\s*PAGE\s*\}/gi, String(context.page || ""))
    .replace(/\$pages\$/gi, String(context.pages || ""))
    .replace(/\$page\$/gi, String(context.page || ""))
    .replace(/\$date\$/gi, tokens.date)
    .replace(/\$time\$/gi, tokens.hour)
    .replace(/\$hour\$/gi, tokens.hour)
    .replace(/\$title\$/gi, context.title || "")
    .replace(/%pages/g, String(context.pages || ""))
    .replace(/%page/g, String(context.page || ""))
    .replace(/%date/g, tokens.date)
    .replace(/%hour/g, tokens.hour)
    .replace(/%time/g, tokens.hour)
    .replace(/%title/g, context.title || "");
}

function getActiveDocument() {
  const candidates = Array.from(document.querySelectorAll(".protyle-wysiwyg"));
  const visible = candidates.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 80 && rect.height > 80 && node.offsetParent !== null;
  });
  if (!visible) {
    throw new Error("No active SiYuan editor was found. Open a document first.");
  }

  const protyle = visible.closest(".protyle");
  const titleInput = protyle && protyle.querySelector(".protyle-title__input");
  const title = (titleInput && (titleInput.textContent || titleInput.value || titleInput.getAttribute("data-tip"))) ||
    document.title.replace(/\s+-\s+SiYuan.*$/i, "") ||
    "SiYuan page";

  const clone = visible.cloneNode(true);
  clone.querySelectorAll(".protyle-action, .protyle-attr, .protyle-icons, .block__icons").forEach((node) => node.remove());
  clone.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
  clone.querySelectorAll("[spellcheck]").forEach((node) => node.removeAttribute("spellcheck"));
  clone.querySelectorAll("[data-node-id]").forEach((node) => node.removeAttribute("data-node-id"));
  clone.querySelectorAll(".protyle-cursor, .protyle-wysiwyg--hl").forEach((node) => node.remove());

  return {
    title: title.trim(),
    html: clone.innerHTML,
  };
}

function cleanPreviewHtml(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  wrapper.querySelectorAll("script, style").forEach((node) => node.remove());
  wrapper.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    });
  });
  cleanupImageRows(wrapper);
  return wrapper.innerHTML;
}

function cleanupImageRows(root) {
  root.querySelectorAll("p, div, figure").forEach((node) => {
    if (!node.querySelector("img")) return;
    const text = (node.textContent || "").replace(/\u00a0/g, " ").trim();
    const mediaChildren = Array.from(node.children).filter((child) => {
      return child.matches("img, picture, span, a") && child.querySelectorAll("img").length > 0 || child.matches("img, picture");
    });
    if (!text && mediaChildren.length > 0 && node.querySelectorAll("img").length > 0) {
      node.classList.add("pp-image-row");
    }
  });
  root.querySelectorAll("p, div").forEach((node) => {
    if (node.querySelector("img, table, pre, blockquote, ul, ol, h1, h2, h3, h4, h5, h6")) return;
    const text = (node.textContent || "").replace(/\u00a0/g, " ").trim();
    if (!text && node.children.length === 0) node.remove();
  });
}

function normalizeSettings(raw) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  if (raw && raw.fontSize && !raw.contentFontSize) {
    settings.contentFontSize = raw.fontSize;
  }
  if (raw && raw.headerFooterText && !raw.headerLeft && !raw.headerCenter && !raw.headerRight && !raw.footerLeft && !raw.footerCenter && !raw.footerRight) {
    settings.footerCenter = raw.headerFooterText;
  }
  if (raw && typeof raw.headerFooterEnabled === "boolean") {
    settings.headerEnabled = raw.headerFooterEnabled;
    settings.footerEnabled = raw.headerFooterEnabled;
  }
  return settings;
}

function buildStyle(settings, forExport) {
  const paper = getPaper(settings);
  const fontFamily = settings.fontFamily ? `"${settings.fontFamily.replace(/"/g, '\\"')}", sans-serif` : "var(--b3-font-family-protyle, var(--b3-font-family), sans-serif)";
  const contentFontSize = Number(settings.contentFontSize) || DEFAULT_SETTINGS.contentFontSize;
  const titleFontSize = Number(settings.titleFontSize) || DEFAULT_SETTINGS.titleFontSize;
  const imageWidth = Math.max(10, Math.min(100, Number(settings.imageWidth) || 100));
  const floatRule = imageWidth < 100
    ? `float: right; clear: right; margin: 0 0 0.55cm 0.75cm; width: ${imageWidth}%; max-width: ${imageWidth}%;`
    : "display: block; width: 100%; max-width: 100%; margin: 0.35cm auto;";

  return `
    :root {
      --pp-page-width: ${paper.widthMm}mm;
      --pp-page-height: ${paper.heightMm}mm;
      --pp-margin-top: ${settings.marginTop}cm;
      --pp-margin-right: ${settings.marginRight}cm;
      --pp-margin-bottom: ${settings.marginBottom}cm;
      --pp-margin-left: ${settings.marginLeft}cm;
      --pp-font-family: ${fontFamily};
      --pp-content-font-size: ${contentFontSize}pt;
      --pp-title-font-size: ${titleFontSize}pt;
      --pp-paragraph-spacing: ${settings.paragraphSpacing}em;
      --pp-text-align: ${settings.textAlign === "justify" ? "justify" : "left"};
      --pp-title-align: ${settings.titleAlign || "center"};
    }
    ${forExport ? `@page {
      size: ${paper.widthMm}mm ${paper.heightMm}mm;
      margin: 0;
    }` : `@page {
      size: ${paper.widthMm}mm ${paper.heightMm}mm;
      margin: ${settings.marginTop}cm ${settings.marginRight}cm ${settings.marginBottom}cm ${settings.marginLeft}cm;
    }`}
    ${forExport ? `body {
      margin: 0;
      font-family: var(--pp-font-family);
      font-size: var(--pp-content-font-size);
      color: #1f1f1f;
      background: #fff;
    }` : ""}
    .pp-export-page {
      ${forExport ? "break-after: page;" : ""}
      box-sizing: border-box;
      width: var(--pp-page-width);
      min-height: var(--pp-page-height);
      padding: var(--pp-margin-top) var(--pp-margin-right) var(--pp-margin-bottom) var(--pp-margin-left);
      position: relative;
      background: #fff;
    }
    .pp-export-page:last-child { break-after: auto; }
    .pp-page-body {
      box-sizing: border-box;
      font-family: var(--pp-font-family);
      font-size: var(--pp-content-font-size);
      color: #1f1f1f;
      line-height: 1.55;
      text-align: var(--pp-text-align);
    }
    .pp-page-body :where(p, div, span, li, td, th, blockquote) {
      font-size: inherit !important;
      font-family: inherit !important;
    }
    .pp-page-body > :where(p, div, section, article, blockquote, ul, ol, pre, table, figure):not(.pp-image-row):not(.pp-document-title) {
      margin-top: 0 !important;
      margin-bottom: var(--pp-paragraph-spacing) !important;
    }
    .pp-document-title {
      margin: 0 0 0.55cm;
      text-align: var(--pp-title-align);
      font-size: var(--pp-title-font-size) !important;
      line-height: 1.2;
      font-weight: 650;
    }
    .pp-page-body :where(h1, h2, h3, h4, h5, h6):not(.pp-document-title) { line-height: 1.25; page-break-after: avoid; text-align: left; }
    .pp-page-body h1 { font-size: calc(var(--pp-content-font-size) * 1.75); }
    .pp-page-body h2 { font-size: calc(var(--pp-content-font-size) * 1.45); }
    .pp-page-body h3 { font-size: calc(var(--pp-content-font-size) * 1.25); }
    .pp-page-body h4 { font-size: calc(var(--pp-content-font-size) * 1.12); }
    .pp-page-body p {
      margin-top: 0;
      margin-bottom: var(--pp-paragraph-spacing);
      overflow-wrap: anywhere;
    }
    .pp-page-body :where(li, blockquote) { overflow-wrap: anywhere; }
    .pp-page-body img {
      ${floatRule}
      height: auto;
      object-fit: contain;
      page-break-inside: avoid;
    }
    .pp-image-row {
      display: contents;
      margin: 0;
      padding: 0;
      min-height: 0;
    }
    .pp-page-body figure { margin: 0.35cm 0; }
    .pp-page-body table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
    .pp-page-body :where(th, td) { border: 1px solid #d0d7de; padding: 0.12cm 0.18cm; vertical-align: top; }
    .pp-page-body :where(pre, code) { font-family: var(--b3-font-family-code, Consolas, monospace); }
    .pp-page-body pre { white-space: pre-wrap; background: #f6f8fa; padding: 0.25cm; border-radius: 4px; }
    .pp-page-body blockquote { margin-left: 0; padding-left: 0.35cm; border-left: 3px solid #c8ccd0; color: #4c5560; }
    .pp-page-mark {
      ${forExport ? "position: fixed;" : "position: absolute;"}
      left: var(--pp-margin-left);
      right: var(--pp-margin-right);
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.25cm;
      font-size: 9pt;
      color: #69707a;
      line-height: 1.25;
      pointer-events: none;
    }
    .pp-page-mark[data-vpos="top"] { top: 0.52cm; }
    .pp-page-mark[data-vpos="bottom"] { bottom: 0.52cm; }
    .pp-page-mark__left { text-align: left; }
    .pp-page-mark__center { text-align: center; }
    .pp-page-mark__right { text-align: right; }
    ${forExport ? `.pp-page-num::after { content: counter(page); }` : ""}
  `;
}

function resolveImagePaths(html, dataDir) {
  const dir = dataDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return html.replace(/<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
    if (/^(https?:\/\/|file:\/\/)/i.test(src)) return match;
    let abs;
    if (src.startsWith("/")) {
      // /data/assets/foo.png or /assets/foo.png → resolve against workspace data dir
      abs = dir + "/" + src.replace(/^\/data\//, "").replace(/^\//, "");
    } else {
      abs = dir + "/" + src.replace(/^\.\//, "");
    }
    return match.replace(src, "file:///" + abs);
  });
}

function buildExportPageMark(settings, kind, context) {
  const enabled = kind === "header" ? settings.headerEnabled : settings.footerEnabled;
  if (!enabled) return "";
  const prefix = kind === "header" ? "header" : "footer";
  const fields = ["Left", "Center", "Right"].map((slot) => settings[`${prefix}${slot}`] || "");
  if (!fields.some((f) => f.trim())) return "";
  const ctx = Object.assign({}, context, {
    page: settings.pageNumber ? "counter(page)" : "",
    pages: settings.pageNumber ? String(context.pages) : "",
  });
  const expanded = fields.map((field) => {
    let t = expandTokens(field, ctx);
    // Replace literal "counter(page)" text with counter span
    t = t.replace(/counter\(page\)/g, '<span class="pp-page-num"></span>');
    return markdownLinks(normalizeMarkText(t));
  });
  if (!expanded.some((f) => f.trim())) return "";
  const vpos = kind === "header" ? "top" : "bottom";
  return `<div class="pp-page-mark" data-vpos="${vpos}">
    <span class="pp-page-mark__left">${expanded[0]}</span>
    <span class="pp-page-mark__center">${expanded[1]}</span>
    <span class="pp-page-mark__right">${expanded[2]}</span>
  </div>`;
}

function buildExportHtml(documentData, settings, pageCount, pageHtmls) {
  const cleaned = cleanPreviewHtml(documentData.html);
  const pages = (pageHtmls && pageHtmls.length ? pageHtmls : [
    `${settings.includeTitle ? `<h1 class="pp-document-title">${escapeHtml(documentData.title)}</h1>` : ""}${cleaned}`,
  ]).map((html) => ({ html }));
  const body = pages.map((page) => `
    <section class="pp-export-page">
      <div class="pp-page-body">${page.html}</div>
    </section>
  `).join("");
  const ctx = { title: documentData.title, pages: pageCount || 1 };
  const header = buildExportPageMark(settings, "header", ctx);
  const footer = buildExportPageMark(settings, "footer", ctx);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(documentData.title)}</title>
  <style>${buildStyle(settings, true)}</style>
</head>
<body>
  ${header}
  ${footer}
  ${body}
</body>
</html>`;
}

function buildPageMarkHtml(settings, kind, context) {
  const enabled = kind === "header" ? settings.headerEnabled : settings.footerEnabled;
  if (!enabled) return "";
  const prefix = kind === "header" ? "header" : "footer";
  const fields = ["Left", "Center", "Right"].map((slot) => settings[`${prefix}${slot}`] || "");
  if (!fields.some((field) => field.trim())) return "";
  const tokenContext = Object.assign({}, context, {
    page: settings.pageNumber ? context.page : "",
    pages: settings.pageNumber ? context.pages : "",
  });
  const expanded = fields.map((field) => markdownLinks(normalizeMarkText(expandTokens(field, tokenContext))));
  if (!expanded.some((field) => field.trim())) return "";
  const vpos = kind === "header" ? "top" : "bottom";
  return `<div class="pp-page-mark" data-vpos="${vpos}">
    <span class="pp-page-mark__left">${expanded[0]}</span>
    <span class="pp-page-mark__center">${expanded[1]}</span>
    <span class="pp-page-mark__right">${expanded[2]}</span>
  </div>`;
}

function normalizeMarkText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!text.replace(/[./\\|,;:()[\]{}\s-]/g, "")) return "";
  if (/^page\s*(of)?$/i.test(text)) return "";
  return text;
}

class PreviewController {
  constructor(plugin, root, dialog) {
    this.plugin = plugin;
    this.root = root;
    this.dialog = dialog;
    this.documentData = getActiveDocument();
    this.settings = normalizeSettings(plugin.settingsData || {});
    this.fonts = [];
    this.pageCount = 1;
    this.render();
    this.loadFonts();
    this.schedulePreview();
  }

  render() {
    this.root.className = "pp-shell";
    this.root.innerHTML = `
      <main class="pp-preview-area">
        <div class="pp-preview-toolbar">
          <div>
            <div class="pp-kicker">Print preview</div>
            <div class="pp-title">${escapeHtml(this.documentData.title)}</div>
          </div>
          <div class="pp-page-count"><span data-role="page-count">1</span> pages</div>
        </div>
        <div class="pp-pages" data-role="pages"></div>
      </main>
      <aside class="pp-sidebar">
        <div class="pp-sidebar-head">
          <div>
            <div class="pp-kicker">Export</div>
            <h2>PDF setup</h2>
          </div>
          <button class="pp-icon-button" data-action="close" title="Close">x</button>
        </div>
        <div class="pp-controls">
          ${this.renderControls()}
        </div>
      </aside>
    `;
    this.bindEvents();
  }

  renderControls() {
    return `
      <label class="pp-field"><span>Page size</span><select data-setting="paperSize">
        ${Object.keys(PAPER_SIZES).map((key) => `<option value="${key}" ${this.settings.paperSize === key ? "selected" : ""}>${PAPER_SIZES[key].label}</option>`).join("")}
      </select></label>
      <div class="pp-field"><span>Orientation</span><div class="pp-segment">
        <button data-setting-button="orientation" data-value="portrait" class="${this.settings.orientation === "portrait" ? "active" : ""}">Vertical</button>
        <button data-setting-button="orientation" data-value="landscape" class="${this.settings.orientation === "landscape" ? "active" : ""}">Horizontal</button>
      </div></div>
      <section class="pp-group"><h3>Margins, cm</h3>
        <div class="pp-grid-2">
          ${this.numberInput("Top", "marginTop", 0, 8, 0.1)}
          ${this.numberInput("Bottom", "marginBottom", 0, 8, 0.1)}
          ${this.numberInput("Left", "marginLeft", 0, 8, 0.1)}
          ${this.numberInput("Right", "marginRight", 0, 8, 0.1)}
        </div>
      </section>
      <section class="pp-group"><h3>Header and footer</h3>
        ${this.toggle("Page number", "pageNumber")}
        ${this.toggle("Header text", "headerEnabled")}
        <div class="pp-mark-grid">
          <input data-setting="headerLeft" value="${escapeHtml(this.settings.headerLeft)}" placeholder="Left">
          <input data-setting="headerCenter" value="${escapeHtml(this.settings.headerCenter)}" placeholder="Center">
          <input data-setting="headerRight" value="${escapeHtml(this.settings.headerRight)}" placeholder="Right">
        </div>
        ${this.toggle("Footer text", "footerEnabled")}
        <div class="pp-mark-grid">
          <input data-setting="footerLeft" value="${escapeHtml(this.settings.footerLeft)}" placeholder="Left">
          <input data-setting="footerCenter" value="${escapeHtml(this.settings.footerCenter)}" placeholder="Center">
          <input data-setting="footerRight" value="${escapeHtml(this.settings.footerRight)}" placeholder="Right">
        </div>
        <div class="pp-hint">Fields: %title, %date, %hour, %time, %page, %pages, {PAGE}, {NUMPAGES}, $title$, $date$. Empty boxes print nothing.</div>
      </section>
      <section class="pp-group"><h3>Typography</h3>
        <label class="pp-field"><span>Font style</span><select data-setting="fontFamily" data-role="font-list">
          <option value="">SiYuan default</option>
          ${this.fonts.map((font) => `<option value="${escapeHtml(font)}" ${this.settings.fontFamily === font ? "selected" : ""}>${escapeHtml(font)}</option>`).join("")}
        </select></label>
        ${this.numberInput("Content font size, pt", "contentFontSize", 8, 28, 1)}
        ${this.numberInput("Title font size, pt", "titleFontSize", 12, 48, 1)}
        ${this.numberInput("Space between blocks, em", "paragraphSpacing", 0, 2.5, 0.05)}
        ${this.toggle("Add page title", "includeTitle")}
        ${this.settings.includeTitle ? `<div class="pp-field"><span>Title align</span><div class="pp-segment">
          <button data-setting-button="titleAlign" data-value="center" class="${this.settings.titleAlign === "center" ? "active" : ""}">Center</button>
          <button data-setting-button="titleAlign" data-value="left" class="${this.settings.titleAlign === "left" ? "active" : ""}">Left</button>
        </div></div>` : ""}
        <div class="pp-field"><span>Text alignment</span><div class="pp-segment">
          <button data-setting-button="textAlign" data-value="left" class="${this.settings.textAlign === "left" ? "active" : ""}">Left</button>
          <button data-setting-button="textAlign" data-value="justify" class="${this.settings.textAlign === "justify" ? "active" : ""}">Justify</button>
        </div></div>
      </section>
      <section class="pp-group"><h3>Images</h3>
        <label class="pp-field"><span>Image width: <b data-role="image-width-label">${this.settings.imageWidth}%</b></span>
          <input type="range" min="20" max="100" step="5" data-setting="imageWidth" value="${this.settings.imageWidth}">
        </label>
      </section>
      <div class="pp-button-row">
        <button class="pp-export-button" data-action="export">Export</button>
        <button class="pp-export-button pp-print-button" data-action="print">Print Preview as PDF</button>
      </div>
    `;
  }

  numberInput(label, key, min, max, step) {
    return `<label class="pp-field"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" data-setting="${key}" value="${escapeHtml(this.settings[key])}"></label>`;
  }

  toggle(label, key) {
    return `<label class="pp-toggle"><span>${label}</span><input type="checkbox" data-setting="${key}" ${this.settings[key] ? "checked" : ""}></label>`;
  }

  bindEvents() {
    this.root.querySelectorAll("[data-setting]").forEach((input) => {
      input.addEventListener("input", () => this.handleInput(input));
      input.addEventListener("change", () => this.handleInput(input));
    });
    this.root.querySelectorAll("[data-setting-button]").forEach((button) => {
      button.addEventListener("click", () => {
        this.settings[button.dataset.settingButton] = button.dataset.value;
        this.plugin.saveSettings(this.settings);
        this.render();
        this.schedulePreview();
      });
    });
    const close = this.root.querySelector('[data-action="close"]');
    if (close) close.addEventListener("click", () => this.dialog.destroy());
    const exportButton = this.root.querySelector('[data-action="export"]');
    if (exportButton) exportButton.addEventListener("click", () => this.exportPdf(exportButton));
    const printButton = this.root.querySelector('[data-action="print"]');
    if (printButton) printButton.addEventListener("click", () => this.printPreviewPdf(printButton));
  }

  handleInput(input) {
    const key = input.dataset.setting;
    if (!key) return;
    if (input.type === "checkbox") {
      this.settings[key] = input.checked;
    } else if (input.type === "number" || input.type === "range") {
      this.settings[key] = Number(input.value);
    } else {
      this.settings[key] = input.value;
    }
    const imageLabel = this.root.querySelector('[data-role="image-width-label"]');
    if (imageLabel) imageLabel.textContent = `${this.settings.imageWidth}%`;
    this.plugin.saveSettings(this.settings);
    this.schedulePreview();
  }

  async loadFonts() {
    const fonts = new Set(["Arial", "Calibri", "Cambria", "Times New Roman", "Microsoft YaHei", "Noto Sans", "Noto Serif"]);
    try {
      const response = await post("/api/system/getSysFonts", {});
      (response.data || []).forEach((font) => fonts.add(font));
    } catch (err) {
      console.warn(`[${PLUGIN_NAME}] getSysFonts failed`, err);
    }
    try {
      if (window.queryLocalFonts) {
        const localFonts = await window.queryLocalFonts();
        localFonts.forEach((font) => font.family && fonts.add(font.family));
      }
    } catch (err) {
      console.warn(`[${PLUGIN_NAME}] queryLocalFonts failed`, err);
    }
    this.fonts = Array.from(fonts).sort((a, b) => a.localeCompare(b));
    const select = this.root.querySelector('[data-role="font-list"]');
    if (select) {
      select.innerHTML = `<option value="">SiYuan default</option>` + this.fonts.map((font) => `<option value="${escapeHtml(font)}">${escapeHtml(font)}</option>`).join("");
      select.value = this.settings.fontFamily || "";
    }
  }

  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.updatePreview(), 80);
  }

  updatePreview() {
    const target = this.root.querySelector('[data-role="pages"]');
    if (!target) return;
    target.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = buildStyle(this.settings, false);
    target.appendChild(style);

    const paper = getPaper(this.settings);
    const pageWidth = mmToPx(paper.widthMm);
    const pageHeight = mmToPx(paper.heightMm);
    const bodyHeight = pageHeight - mmToPx(this.settings.marginTop * 10) - mmToPx(this.settings.marginBottom * 10);
    const source = document.createElement("div");
    source.className = "pp-source";
    source.innerHTML = `${this.settings.includeTitle ? `<h1 class="pp-document-title">${escapeHtml(this.documentData.title)}</h1>` : ""}${cleanPreviewHtml(this.documentData.html)}`;

    let pages = [];
    let page = this.createPage(pageWidth, pageHeight);
    target.appendChild(page.outer);
    pages.push(page);

    Array.from(source.children).forEach((child) => {
      const clone = child.cloneNode(true);
      page.body.appendChild(clone);
      if (page.body.scrollHeight > bodyHeight && page.body.children.length > 1) {
        clone.remove();
        page = this.createPage(pageWidth, pageHeight);
        target.appendChild(page.outer);
        pages.push(page);
        page.body.appendChild(clone);
      }
    });

    this.pageCount = pages.length || 1;
    pages.forEach((item, index) => this.renderHeaderFooter(item.outer, index + 1, this.pageCount));
    const pageCount = this.root.querySelector('[data-role="page-count"]');
    if (pageCount) pageCount.textContent = String(this.pageCount);

    target.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", () => this.schedulePreview(), { once: true });
    });
  }

  createPage(width, height) {
    const outer = document.createElement("section");
    outer.className = "pp-page pp-export-page";
    outer.style.width = `${width}px`;
    outer.style.minHeight = `${height}px`;
    const body = document.createElement("div");
    body.className = "pp-page-body";
    outer.appendChild(body);
    return { outer, body };
  }

  renderHeaderFooter(page, pageNumber, pageCount) {
    const context = {
      title: this.documentData.title,
      page: pageNumber,
      pages: pageCount,
    };
    ["header", "footer"].forEach((kind) => {
      const html = buildPageMarkHtml(this.settings, kind, context);
      if (!html) return;
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      page.appendChild(wrapper.firstElementChild);
    });
  }

  getPreviewPageHtml() {
    return Array.from(this.root.querySelectorAll(".pp-page .pp-page-body"))
      .map((node) => node.innerHTML)
      .filter((html) => html.trim().length > 0);
  }

  async printPreviewPdf(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Opening in browser...";
    try {
      await this.plugin.saveSettings(this.settings);
      let html = buildExportHtml(this.documentData, this.settings, this.pageCount, this.getPreviewPageHtml());
      const ws = window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.workspaceDir;
      if (!ws) throw new Error("Cannot resolve workspace directory");
      const base = ws.replace(/\\/g, "/").replace(/\/+$/, "") + "/data";
      html = resolveImagePaths(html, base);
      const tmpDir = base + "/temp/pandoc-pdf-exporter";
      const absHtml = tmpDir + "/print.html";
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(absHtml, html, "utf-8");
      // Open in the user's default browser (Ctrl+P → Save as PDF works there)
      const { exec } = require("child_process");
      exec(`start "" "${absHtml}"`, (err) => {
        if (err) throw err;
        showMessage("Opened in your browser. Press Ctrl+P → Save as PDF.", 8000, "info");
      });
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] print failed`, err);
      showMessage("Print failed: " + err.message, 5000, "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async exportPdf(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Exporting...";
    try {
      await this.plugin.saveSettings(this.settings);
      let html = buildExportHtml(this.documentData, this.settings, this.pageCount, this.getPreviewPageHtml());
      const ws = window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.workspaceDir;
      if (!ws) throw new Error("Cannot resolve workspace directory");
      const base = ws.replace(/\\/g, "/").replace(/\/+$/, "") + "/data";
      html = resolveImagePaths(html, base);
      const tmpDir = base + "/temp/pandoc-pdf-exporter";
      const absHtml = tmpDir + "/export.html";
      const absPdf = tmpDir + "/export.pdf";
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(absHtml, html, "utf-8");

      // Try direct WeasyPrint first (bypasses pandoc → preserves CSS fidelity)
      let lastErr = null;
      try {
        await new Promise((resolve, reject) => {
          execFile("weasyprint", [absHtml, absPdf], { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
          });
        });
      } catch (err) {
        console.warn(`[${PLUGIN_NAME}] direct weasyprint failed, falling back to pandoc`, err);
        lastErr = err;
        // Fallback: try pandoc with various PDF engines
        const engines = ["weasyprint", "wkhtmltopdf", "pdfroff", "xelatex", "lualatex", "pdflatex"];
        let succeeded = false;
        for (const engine of engines) {
          try {
            await post("/api/convert/pandoc", {
              args: ["--from", "html", absHtml, "-o", absPdf, "--pdf-engine=" + engine, "--standalone"],
            });
            succeeded = true;
            break;
          } catch (e) {
            console.warn(`[${PLUGIN_NAME}] pandoc+${engine} failed`, e);
            lastErr = e;
          }
        }
        if (!succeeded) {
          throw new Error("No PDF engine found. Tried direct weasyprint and pandoc engines.\n" + (lastErr ? lastErr.message : "Install WeasyPrint correctly."));
        }
      }
      const pdfBuf = fs.readFileSync(absPdf);
      const blob = new Blob([pdfBuf], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugFileName(this.documentData.title)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showMessage("PDF exported.", 3000, "info");
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] export failed`, err);
      confirm("Pandoc PDF export failed", escapeHtml(err.message || err), () => {});
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

module.exports = class PandocPdfExporterPlugin extends Plugin {
  constructor(options) {
    super(options);
    this.settingsData = normalizeSettings();
    this.isMobile = ["mobile", "browser-mobile"].includes(getFrontend());
  }

  async onload() {
    this.addIcons(`<symbol id="iconPandocPdfExport" viewBox="0 0 24 24">
      <path d="M6 2h9l5 5v6h-2V8h-4V4H6v7H4V4a2 2 0 0 1 2-2zm10 2.4V6h1.6L16 4.4zM5 13h14a2 2 0 0 1 2 2v4h-4v3H7v-3H3v-4a2 2 0 0 1 2-2zm4 5v2h6v-2H9zm9-2a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"></path>
    </symbol>`);
    await this.loadSettings();
    const button = this.addTopBar({
      icon: "iconPandocPdfExport",
      title: "Export current page to PDF",
      position: "right",
      callback: () => this.openPreview(),
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = new Menu("pandocPdfExportMenu");
      menu.addItem({
        icon: "iconRefresh",
        label: "Reset print settings",
        click: async () => {
          this.settingsData = normalizeSettings();
          await this.saveSettings(this.settingsData);
          showMessage("Print settings reset.", 2000, "info");
        },
      });
      menu.open({ x: event.clientX, y: event.clientY, isLeft: true });
    });
    console.log(`[${PLUGIN_NAME}] loaded`);
  }

  onunload() {
    clearTimeout(this.previewTimer);
    console.log(`[${PLUGIN_NAME}] unloaded`);
  }

  uninstall() {
    this.removeData(SETTINGS_FILE);
  }

  async loadSettings() {
    try {
      const data = await this.loadData(SETTINGS_FILE);
      this.settingsData = normalizeSettings(data || {});
    } catch (err) {
      this.settingsData = normalizeSettings();
    }
  }

  async saveSettings(settings) {
    this.settingsData = normalizeSettings(settings || {});
    await this.saveData(SETTINGS_FILE, this.settingsData);
  }

  openPreview() {
    if (this.isMobile) {
      showMessage("Pandoc PDF Exporter currently targets desktop preview.", 4000, "error");
      return;
    }
    const id = "pandoc-pdf-exporter-dialog";
    const dialog = new Dialog({
      title: "Pandoc PDF Exporter",
      content: `<div id="${id}"></div>`,
      width: "96vw",
      height: "92vh",
    });
    const root = dialog.element.querySelector(`#${id}`);
    try {
      new PreviewController(this, root, dialog);
    } catch (err) {
      dialog.destroy();
      confirm("Cannot open PDF preview", escapeHtml(err.message || err), () => {});
    }
  }
};
