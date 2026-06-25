const { Dialog, Menu, Plugin, confirm, fetchPost, getFrontend, showMessage } = require("siyuan");
const fs = require("fs");
let execFile = null;
try { execFile = require("child_process").execFile; } catch (e) { /* web mode — child_process unavailable */ }

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
  separateImageSizes: false,
  imageAlign: "right",
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

function buildMarginBoxCss(settings) {
  const tokens = nowTokens();
  const lines = [];
  const marginSlots = [
    { kind: "header", vpos: "top", slot: "Left" },
    { kind: "header", vpos: "top", slot: "Center" },
    { kind: "header", vpos: "top", slot: "Right" },
    { kind: "footer", vpos: "bottom", slot: "Left" },
    { kind: "footer", vpos: "bottom", slot: "Center" },
    { kind: "footer", vpos: "bottom", slot: "Right" },
  ];
  for (const { kind, vpos, slot } of marginSlots) {
    const enabled = kind === "header" ? settings.headerEnabled : settings.footerEnabled;
    if (!enabled) continue;
    const prefix = kind === "header" ? "header" : "footer";
    const field = settings[`${prefix}${slot}`] || "";
    if (!field.trim()) continue;
    let t = field
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\$date\$/gi, tokens.date)
      .replace(/\$time\$/gi, tokens.hour)
      .replace(/\$hour\$/gi, tokens.hour)
      .replace(/\$title\$/gi, settings.title || "")
      .replace(/%date/gi, tokens.date)
      .replace(/%hour/gi, tokens.hour)
      .replace(/%time/gi, tokens.hour)
      .replace(/%title/gi, settings.title || "");
    if (!settings.pageNumber) {
      t = t.replace(/\$pages\$|\$page\$|%pages|%page|\{NUMPAGES\}|\{PAGE\}/gi, "");
    }
    let cssContent = "";
    let remaining = t;
    while (remaining.length > 0) {
      const pageMatch = remaining.match(/^(\$pages\$|\$page\$|%pages|%page|\{NUMPAGES\}|\{PAGE\})\s*/i);
      if (pageMatch) {
        const m = pageMatch[1].replace(/\s/g, "");
        if (/^\$pages\$$|^%pages$|^\{NUMPAGES\}$/i.test(m)) cssContent += " counter(pages) ";
        else cssContent += " counter(page) ";
        remaining = remaining.slice(pageMatch[0].length);
      } else {
        const nextToken = remaining.search(/\$pages\$|\$page\$|%pages|%page|\{NUMPAGES\}|\{PAGE\}/i);
        const segment = nextToken === -1 ? remaining : remaining.slice(0, nextToken);
        remaining = nextToken === -1 ? "" : remaining.slice(nextToken);
        cssContent += `"${segment.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" `;
      }
    }
    const align = slot === "Left" ? "left" : slot === "Right" ? "right" : "center";
    lines.push(`      @${vpos}-${slot.toLowerCase()} {
        content: ${cssContent.trim()};
        font-size: 9pt;
        color: #69707a;
        font-family: sans-serif;
        text-align: ${align};
      }`);
  }
  return lines.join("\n");
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

function cleanPreviewHtml(html, annotateImages) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  wrapper.querySelectorAll("script, style").forEach((node) => node.remove());
  wrapper.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    });
  });
  cleanupImageRows(wrapper);
  // Strip SiYuan image UI wrappers, leaving only the <img>
  wrapper.querySelectorAll('.protyle-action, .protyle-action__drag, .protyle-action__title').forEach((el) => el.remove());
  wrapper.querySelectorAll('span[data-type="img"]').forEach((span) => {
    const img = span.querySelector("img");
    if (img) {
      img.removeAttribute("data-src");
      span.replaceWith(img);
    } else {
      span.remove();
    }
  });
  // Strip float/margin/width inline styles from images inside table cells
  wrapper.querySelectorAll("th img, td img").forEach((img) => {
    img.style.float = "";
    img.style.margin = "";
    img.style.width = "";
    img.style.maxWidth = "";
    img.closest("th, td")?.classList.add("pp-img-cell");
  });
  // Flatten tables: remove filler rows (fn__none), rowspan/colspan, and outer UI wrappers
  wrapper.querySelectorAll('[data-type="NodeTable"]').forEach((node) => {
    const table = node.querySelector(":scope > div > table, table");
    if (!table) return;
    table.querySelectorAll("thead tr, tbody tr").forEach((tr) => {
      if (tr.querySelector(".fn__none")) { tr.remove(); }
    });
    table.querySelectorAll("[rowspan]").forEach((el) => el.removeAttribute("rowspan"));
    table.querySelectorAll("[colspan]").forEach((el) => el.removeAttribute("colspan"));
    node.replaceWith(table);
  });
  // Convert SiYuan link nodes to real <a> tags
  wrapper.querySelectorAll('[data-href]').forEach((node) => {
    const href = node.getAttribute("data-href") || "";
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    while (node.firstChild) a.appendChild(node.firstChild);
    node.replaceWith(a);
  });
  // Remove any leftover data-type~="a" wrappers without href
  wrapper.querySelectorAll('[data-type~="a"]').forEach((node) => {
    if (node.nodeName !== "A" && node.parentNode) {
      while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
      node.remove();
    }
  });
  // Convert newlines in text nodes to <br> (SiYuan uses \n for Shift+Enter)
  wrapper.querySelectorAll("*").forEach((node) => {
    if (node.closest("pre, code")) return;
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE && /\r?\n/.test(child.textContent)) {
        const parts = child.textContent.split(/\r?\n/);
        const fragment = document.createDocumentFragment();
        parts.forEach((part, i) => {
          if (part) fragment.appendChild(document.createTextNode(part));
          if (i < parts.length - 1) fragment.appendChild(document.createElement("br"));
        });
        node.replaceChild(fragment, child);
      }
    });
  });
  // Annotate images with indices for per-image size control
  if (annotateImages) {
    let idx = 0;
    let tableIdx = 0;
    wrapper.querySelectorAll("img").forEach((img) => {
      if (img.closest("th, td")) {
        img.dataset.ppImageTableIndex = String(tableIdx++);
      } else {
        img.dataset.ppImageIndex = String(idx++);
      }
    });
  }
  return wrapper.innerHTML;
}

function hasVisibleText(node) {
  return /[^\s\u00a0\u200b\u200c\u200d\ufeff\u2028\u2029]/.test(node.textContent || "");
}

function cleanupImageRows(root) {
  root.querySelectorAll("p, div, figure").forEach((node) => {
    if (!node.querySelector("img")) return;
    if (hasVisibleText(node)) return;
    const mediaChildren = Array.from(node.children).filter((child) => {
      return child.matches("img, picture, span, a") && child.querySelectorAll("img").length > 0 || child.matches("img, picture");
    });
    if (mediaChildren.length > 0 && node.querySelectorAll("img").length > 0) {
      node.classList.add("pp-image-row");
    }
  });
  root.querySelectorAll("p, div").forEach((node) => {
    if (node.querySelector("img, table, pre, blockquote, ul, ol, h1, h2, h3, h4, h5, h6")) return;
    if (hasVisibleText(node)) return;
    if (node.children.length === 0) node.remove();
  });
  // Third pass: unwrap empty placeholder blocks containing only floated images.
  // SiYuan image blocks (e.g. <div><div>​<img>​</div></div>) leave an empty
  // wrapper behind when the image is floated; removing the wrapper eliminates
  // the extra blank line in the PDF.
  root.querySelectorAll("p, div").forEach((node) => {
    if (node.closest("th, td")) return;
    if (!node.querySelector("img")) return;
    if (hasVisibleText(node)) return;
    const children = Array.from(node.children);
    if (children.length === 0) return;
    const allMedia = children.every((child) =>
      child.matches("img, picture") ||
      (child.matches("span, a") && child.querySelector("img"))
    );
    if (!allMedia) return;
    const parent = node.parentNode;
    if (!parent) return;
    children.forEach((child) => parent.insertBefore(child, node));
    parent.removeChild(node);
  });
}

function collectCssVars() {
  const vars = [];
  const rootStyles = getComputedStyle(document.documentElement);
  for (let i = 0; i < rootStyles.length; i++) {
    const prop = rootStyles[i];
    if (prop.startsWith("--")) {
      const val = rootStyles.getPropertyValue(prop);
      if (val) vars.push(`  ${prop}: ${val};`);
    }
  }
  return vars.length ? `:root {\n${vars.join("\n")}\n}` : "";
}

function collectLinkTags() {
  const tags = [];
  document.querySelectorAll("head link[rel=stylesheet]").forEach((el) => {
    const href = el.getAttribute("href");
    if (href) {
      try { tags.push(`<link rel="stylesheet" href="${new URL(href, window.location.href).href}">`); }
      catch (e) { tags.push(`<link rel="stylesheet" href="${href}">`); }
    }
  });
  return tags;
}

function collectAllCss() {
  const parts = [];
  const seen = new Set();
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      Array.from(sheet.cssRules || []).forEach((rule) => {
        const text = rule.cssText;
        if (!text || seen.has(text)) return;
        if (/^@page\b/i.test(text.trim())) return;
        if (/^@media\b[\s\S]*?\bprint\b/i.test(text.trim())) return;
        seen.add(text);
        parts.push(text);
      });
    } catch (e) { /* cross-origin or restricted — skip */ }
  });
  document.querySelectorAll("head style").forEach((el) => {
    let text = el.textContent;
    if (!text || seen.has(text)) return;
    text = text.replace(/@page[^{]*\{[^}]*\}/gi, "").trim();
    if (text) { seen.add(text); parts.push(text); }
  });
  return parts.join("\n");
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

function imageCss(width, align) {
  const w = Math.max(10, Math.min(100, Number(width) || 100));
  if (align === "center" || w >= 100) {
    return `display: block; margin: 0.35cm auto; width: ${w}%; max-width: ${w}%;`;
  }
  if (align === "left") {
    return `float: left; clear: left; margin: 0 0.75cm 0.55cm 0; width: ${w}%; max-width: ${w}%;`;
  }
  return `float: right; clear: right; margin: 0 0 0.55cm 0.75cm; width: ${w}%; max-width: ${w}%;`;
}

function buildStyle(settings, forExport, marginBoxCss, fontFallback, imageWidths, imageAligns) {
  const paper = getPaper(settings);
  const fontFamily = settings.fontFamily ? `"${settings.fontFamily.replace(/"/g, '\\"')}", sans-serif` : (forExport ? ((fontFallback || "sans-serif").replace(/"/g, "'")) : "var(--b3-font-family-protyle, var(--b3-font-family), sans-serif)");
  const contentFontSize = Number(settings.contentFontSize) || DEFAULT_SETTINGS.contentFontSize;
  const titleFontSize = Number(settings.titleFontSize) || DEFAULT_SETTINGS.titleFontSize;

  const perImageCss = imageWidths && Object.keys(imageWidths).length > 0
    ? Object.entries(imageWidths).map(([index, width]) => {
        const align = imageAligns && imageAligns[index];
        return `    .pp-page-body img[data-pp-image-index="${index}"] {\n      ${imageCss(width, align)}\n      height: auto;\n      object-fit: contain;\n      page-break-inside: avoid;\n    }`;
      }).join("\n")
    : null;

  const imageWidth = Math.max(10, Math.min(100, Number(settings.imageWidth) || 100));
  const floatRule = imageCss(imageWidth, settings.imageAlign || "right");

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
    ${forExport ? (marginBoxCss ? `@page {
      size: ${paper.widthMm}mm ${paper.heightMm}mm;
      margin: ${settings.marginTop}cm ${settings.marginRight}cm ${settings.marginBottom}cm ${settings.marginLeft}cm;
${marginBoxCss}
    }` : `@page {
      size: ${paper.widthMm}mm ${paper.heightMm}mm;
      margin: 0;
    }`) : `@page {
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
      white-space: normal;
    }
    .pp-page-body a { color: #175199; text-decoration: underline; word-break: break-all; }
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
    .pp-page-body strong, .pp-page-body b,
    .pp-page-body [data-type~="strong"], .pp-page-body [data-type~="b"],
    .pp-page-body [style*="font-weight: bold"], .pp-page-body [style*="font-weight:bold"],
    .pp-page-body [style*="font-weight: 700"], .pp-page-body [style*="font-weight:700"] { font-weight: 700 !important; }
    .pp-page-body em, .pp-page-body i,
    .pp-page-body [data-type~="em"], .pp-page-body [data-type~="i"],
    .pp-page-body [style*="font-style: italic"], .pp-page-body [style*="font-style:italic"] { font-style: italic !important; }
    .pp-page-body u,
    .pp-page-body [data-type~="u"],
    .pp-page-body [style*="text-decoration: underline"], .pp-page-body [style*="text-decoration:underline"] { text-decoration: underline !important; }
    .pp-page-body p {
      margin-top: 0;
      margin-bottom: var(--pp-paragraph-spacing);
      overflow-wrap: anywhere;
    }
    .pp-page-body :where(li, blockquote) { overflow-wrap: anywhere; }
    ${perImageCss || `.pp-page-body img {
      ${floatRule}
      height: auto;
      object-fit: contain;
      page-break-inside: avoid;
    }`}
    .pp-page-body :where(th, td) img {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      float: none !important;
      margin: 0 auto !important;
    }
    .pp-image-row {
      display: contents;
      margin: 0;
      padding: 0;
      min-height: 0;
    }
    .pp-page-body figure { margin: 0.35cm 0; }
    .pp-page-body table { width: 100%; table-layout: fixed; border-collapse: collapse; page-break-inside: auto; }
    .pp-page-body :where(th, td) { border: 1px solid #d0d7de; padding: 0.12cm 0.18cm; vertical-align: top; }
    .pp-page-body .pp-img-cell { padding: 0.02cm 0.18cm; }
    .pp-page-body :where(pre, code) { font-family: ${forExport ? "Consolas, \"Courier New\", monospace" : "var(--b3-font-family-code, Consolas, monospace)"}; }
    .pp-page-body pre { white-space: pre-wrap; background: #f6f8fa; padding: 0.25cm; border-radius: 4px; }
    .pp-page-body blockquote { margin-left: 0; padding-left: 0.35cm; border-left: 3px solid #c8ccd0; color: #4c5560; }
    .pp-page-mark {
      position: absolute;
      left: var(--pp-margin-left);
      right: var(--pp-margin-right);
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.25cm;
      font-family: var(--pp-font-family, sans-serif);
      font-size: 9pt;
      color: #69707a;
      line-height: 1.25;
      pointer-events: none;
      z-index: 10;
    }
    .pp-page-mark a { pointer-events: auto; }
    .pp-page-mark[data-vpos="top"] { top: 0.52cm; }
    .pp-page-mark[data-vpos="bottom"] { bottom: 0.52cm; }
    .pp-page-mark__left { text-align: left; }
    .pp-page-mark__center { text-align: center; }
    .pp-page-mark__right { text-align: right; }
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

function stripSiYuanStyles(html) {
  // With collectCss() injecting --b3-* variables, keep all var() references.
  // Only remove empty/whitespace declarations.
  return html.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (match, value) => {
    const cleaned = value.split(";").filter((decl) => decl.trim()).join(";").trim();
    return cleaned ? ` style="${cleaned}"` : "";
  });
}

function buildExportHtml(documentData, settings, pageCount, pageHtmls, forPdfEngine, fontFallback, imageWidths, imageAligns) {
  const annotate = !!((imageWidths && Object.keys(imageWidths).length > 0) || (imageAligns && Object.keys(imageAligns).length > 0));
  const cleaned = stripSiYuanStyles(cleanPreviewHtml(documentData.html, annotate));
  const totalPages = pageCount || (pageHtmls ? pageHtmls.length : 1);
  const pageContents = (pageHtmls && pageHtmls.length ? pageHtmls.map(stripSiYuanStyles) : [
    `${settings.includeTitle ? `<h1 class="pp-document-title">${escapeHtml(documentData.title)}</h1>` : ""}${cleaned}`,
  ]);

  // Collect <link> stylesheets from the document head (e.g. KaTeX CSS).
  // Resolve to absolute URLs so they work when the exported HTML is opened standalone.
  const linkTags = collectLinkTags();

  if (forPdfEngine) {
    // WeasyPrint path — full CSS is safe (W3C-compliant engine handles it correctly)
    const themeCss = collectCssVars() + "\n" + collectAllCss();

    // WeasyPrint path: @page margin boxes for headers/footers
    const mbox = buildMarginBoxCss(Object.assign({}, settings, { title: documentData.title }));
    const marginBoxCss = mbox.trim() || null;
    const body = marginBoxCss
      ? `<div class="pp-page-body">${pageContents.join("")}</div>`
      : pageContents.map((html, index) => {
        const pageNum = index + 1;
        const ctx = { title: documentData.title, page: pageNum, pages: totalPages };
        return `
    <section class="pp-export-page">
      ${buildPageMarkHtml(settings, "header", ctx)}
      <div class="pp-page-body">${html}</div>
      ${buildPageMarkHtml(settings, "footer", ctx)}
    </section>`;
      }).join("");

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(documentData.title)}</title>
  ${linkTags.join("\n  ")}
  <style>${themeCss}\n${buildStyle(settings, true, marginBoxCss || undefined, fontFallback, imageWidths, imageAligns)}</style>
</head>
<body>
  ${body}
</body>
</html>`;
  }

  // Browser print path — Chrome's print engine chokes on editor/theme layout CSS.
  // Only inject CSS variables (theme colors) and KaTeX <link> tags.
  // Style rules from SiYuan's editor are NOT included to avoid breaking page flow.
  const cssVars = collectCssVars();

  // Browser print path: per-page sections (matches preview layout exactly)
  // Reduce top padding 0.3cm to compensate for browser print dialog extra top margin;
  // reduce bottom padding 0.5mm to give content breathing room vs screen rendering.
  const browserCss = `
    html, body { overflow: visible !important; min-height: 0 !important; }
    .pp-export-page {
      break-after: page !important;
      overflow: visible !important;
      padding-top: max(0cm, calc(var(--pp-margin-top) - 0.3cm)) !important;
      padding-bottom: max(0.2cm, calc(var(--pp-margin-bottom) - 0.5mm)) !important;
    }
    .pp-page-body { overflow: visible !important; }
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(documentData.title)}</title>
  ${linkTags.join("\n  ")}
  <style>${cssVars}\n${buildStyle(settings, true, null, fontFallback, imageWidths, imageAligns)}${browserCss}</style>
</head>
<body>
  ${pageContents.map((html, index) => {
    const pageNum = index + 1;
    const ctx = { title: documentData.title, page: pageNum, pages: totalPages };
    return `
  <section class="pp-export-page">
    ${buildPageMarkHtml(settings, "header", ctx)}
    <div class="pp-page-body">${html}</div>
    ${buildPageMarkHtml(settings, "footer", ctx)}
  </section>`;
  }).join("")}
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
  constructor(plugin, root, dialog, isWeb) {
    this.plugin = plugin;
    this.root = root;
    this.dialog = dialog;
    this.isWeb = isWeb;
    this.documentData = getActiveDocument();
    this.settings = normalizeSettings(plugin.settingsData || {});
    this.fonts = [];
    this.pageCount = 1;
    this.imageWidths = {};
    this.imageAligns = {};
    this.separateCounts = { regular: 0, table: 0 };
    this.render();
    this.loadFonts();
    this.schedulePreview();
  }

  render() {
    const pages = this.root.querySelector('[data-role="pages"]');
    if (pages) this._pendingScroll = pages.scrollTop;
    const controls = this.root.querySelector(".pp-controls");
    if (controls) this._pendingControlsScroll = controls.scrollTop;
    this.root.className = "pp-shell";
    this.root.innerHTML = `
      <main class="pp-preview-area">
        <div class="pp-preview-toolbar">
          <div>
            <div class="pp-kicker">${this.isWeb ? "Web access" : "Desktop"} — ${this.isWeb ? "use Print" : "Print via browser"}</div>
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
    if (this._pendingControlsScroll !== undefined) {
      requestAnimationFrame(() => {
        const ctrl = this.root.querySelector(".pp-controls");
        if (ctrl) ctrl.scrollTop = this._pendingControlsScroll;
      });
    }
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
        ${this.toggle("Separate each image sizes", "separateImageSizes")}
        ${this.settings.separateImageSizes ? this.renderImageSliders() : `
        <label class="pp-field"><span>Image width: <b data-role="image-width-label">${this.settings.imageWidth}%</b></span>
          <input type="range" min="20" max="100" step="1" data-setting="imageWidth" value="${this.settings.imageWidth}">
        </label>
        <div class="pp-field"><span>Image alignment</span><div class="pp-segment pp-segment-3">
          <button data-setting-button="imageAlign" data-value="left" class="${this.settings.imageAlign === "left" ? "active" : ""}"><svg class="icon" viewBox="0 0 20 20" width="14" height="14"><use href="#iconAlignLeft"/></svg></button>
          <button data-setting-button="imageAlign" data-value="center" class="${this.settings.imageAlign === "center" ? "active" : ""}"><svg class="icon" viewBox="0 0 20 20" width="14" height="14"><use href="#iconAlignCenter"/></svg></button>
          <button data-setting-button="imageAlign" data-value="right" class="${this.settings.imageAlign === "right" ? "active" : ""}"><svg class="icon" viewBox="0 0 20 20" width="14" height="14"><use href="#iconAlignRight"/></svg></button>
        </div></div>`}
      </section>
      <div class="pp-button-row">
        <button class="pp-export-button ${this.isWeb ? "pp-export-disabled" : ""}" data-action="export">${this.isWeb ? "Export (desktop only)" : "Export"}</button>
        <button class="pp-export-button pp-print-button" data-action="print">${this.isWeb ? "Print" : "Print via Browser"}</button>
      </div>
    `;
  }

  renderImageSliders() {
    const temp = document.createElement("div");
    temp.innerHTML = cleanPreviewHtml(this.documentData.html, true);
    const regular = temp.querySelectorAll("img:not(th img):not(td img)");
    const table = temp.querySelectorAll("th img, td img");
    this.separateCounts = { regular: regular.length, table: table.length };
    // Initialize widths and aligns for any newly added images
    regular.forEach((img, i) => {
      if (this.imageWidths[i] === undefined) this.imageWidths[i] = this.settings.imageWidth;
      if (this.imageAligns[i] === undefined) this.imageAligns[i] = this.settings.imageAlign || "right";
    });
    let html = "";
    regular.forEach((img, i) => {
      const w = this.imageWidths[i];
      const a = this.imageAligns[i] || "right";
      html += `<label class="pp-field"><span>Image #${i + 1}: <b>${w}%</b></span>
        <input type="range" min="20" max="100" step="1" data-pp-image-width="${i}" value="${w}">
      </label>
      <div class="pp-segment pp-segment-3" style="margin-bottom:12px">
        <button data-pp-image-align="${i}" data-value="left" class="${a === "left" ? "active" : ""}"><svg class="icon" viewBox="0 0 20 20" width="14" height="14"><use href="#iconAlignLeft"/></svg></button>
        <button data-pp-image-align="${i}" data-value="center" class="${a === "center" ? "active" : ""}"><svg class="icon" viewBox="0 0 20 20" width="14" height="14"><use href="#iconAlignCenter"/></svg></button>
        <button data-pp-image-align="${i}" data-value="right" class="${a === "right" ? "active" : ""}"><svg class="icon" viewBox="0 0 20 20" width="14" height="14"><use href="#iconAlignRight"/></svg></button>
      </div>`;
    });
    table.forEach((img, i) => {
      html += `<div class="pp-toggle" style="justify-content:flex-start;gap:6px"><span>Image in table #${i + 1}</span></div>`;
    });
    return html;
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
    this.root.querySelectorAll("[data-pp-image-width]").forEach((input) => {
      input.addEventListener("input", () => this.handleImageWidthInput(input));
      input.addEventListener("change", () => this.handleImageWidthInput(input));
    });
    this.root.querySelectorAll("[data-pp-image-align]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = button.dataset.ppImageAlign;
        this.imageAligns[index] = button.dataset.value;
        this.render();
        this.schedulePreview();
      });
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
    if (exportButton) exportButton.addEventListener("click", () => {
      if (this.isWeb) {
        showMessage("Export is only supported in the desktop app. Use Print instead.", 5000, "info");
      } else {
        this.exportPdf(exportButton);
      }
    });
    const printButton = this.root.querySelector('[data-action="print"]');
    if (printButton) printButton.addEventListener("click", () => this.printPreviewPdf(printButton));
  }

  handleImageWidthInput(input) {
    const index = input.dataset.ppImageWidth;
    if (index === undefined) return;
    this.imageWidths[index] = Number(input.value);
    // Update the label text
    const label = input.closest(".pp-field")?.querySelector("b");
    if (label) label.textContent = `${input.value}%`;
    this.schedulePreview();
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
    if (key === "separateImageSizes") {
      this.plugin.saveSettings(this.settings);
      this.render();
      this.schedulePreview();
      return;
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
      (response.data || []).forEach((item) => {
        if (typeof item === "string") fonts.add(item);
        else if (item && item.family) fonts.add(item.family);
      });
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
    const scrollTop = this._pendingScroll !== undefined ? this._pendingScroll : target.scrollTop;
    this._pendingScroll = undefined;
    target.innerHTML = "";
    const separate = this.settings.separateImageSizes;
    const widths = separate ? this.imageWidths : null;
    const aligns = separate ? this.imageAligns : null;
    const style = document.createElement("style");
    style.textContent = buildStyle(this.settings, false, null, null, widths, aligns);
    target.appendChild(style);

    const paper = getPaper(this.settings);
    const pageWidth = mmToPx(paper.widthMm);
    const pageHeight = mmToPx(paper.heightMm);
    const bodyHeight = pageHeight - mmToPx(this.settings.marginTop * 10) - mmToPx(this.settings.marginBottom * 10);
    const source = document.createElement("div");
    source.className = "pp-source";
    source.innerHTML = `${this.settings.includeTitle ? `<h1 class="pp-document-title">${escapeHtml(this.documentData.title)}</h1>` : ""}${cleanPreviewHtml(this.documentData.html, separate)}`;

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
    requestAnimationFrame(() => { target.scrollTop = scrollTop; });
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
    button.textContent = "Opening...";
    try {
      await this.plugin.saveSettings(this.settings);
      const siYuanFont = getComputedStyle(document.body).fontFamily + ", sans-serif";
      const imgWidths = this.settings.separateImageSizes ? this.imageWidths : null;
      const imgAligns = this.settings.separateImageSizes ? this.imageAligns : null;
      let html = buildExportHtml(this.documentData, this.settings, this.pageCount, this.getPreviewPageHtml(), false, siYuanFont, imgWidths, imgAligns);
      if (this.isWeb) {
        // Print the preview pages directly — they already have the correct pagination.
        // Clone the pages container, inject minimal print CSS, and render in iframe.
        const pages = this.root.querySelector('[data-role="pages"]');
        const paper = getPaper(this.settings);
        const previewPages = pages ? Array.from(pages.querySelectorAll(".pp-page")) : [];
        const headHtml = pages ? pages.querySelector("style").outerHTML : "";
        const printStyle = `
    <style>
      @page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: 0; }
      body { margin: 0; padding: 0; background: #fff; }
      .pp-pages { padding: 0; display: block; }
      .pp-page {
        break-after: page !important;
        page-break-after: always !important;
        box-shadow: none !important;
        margin: 0 auto !important;
        min-height: var(--pp-page-height) !important;
      }
      .pp-page:last-child { break-after: auto; page-break-after: auto; }
      .pp-page-body { overflow: visible !important; }
      .pp-page-mark { font-family: var(--pp-font-family, sans-serif) !important; }
    </style>`;
        const autoPrint = `<script>window.onload=function(){setTimeout(function(){window.print()},800)};window.onafterprint=function(){setTimeout(function(){window.close()},1e3)};<\/script>`;
        const printHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(this.documentData.title)}</title>${headHtml}${printStyle}${autoPrint}</head><body>
  <div class="pp-pages">${previewPages.map(p => p.outerHTML).join("")}</div>
</body></html>`;
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "position:fixed;top:-9999px;left:0;width:1px;height:1px;border:none;";
        document.body.appendChild(iframe);
        const idoc = iframe.contentWindow.document;
        idoc.open();
        idoc.write(printHtml);
        idoc.close();
        showMessage("Opening print dialog...", 3000, "info");
        setTimeout(() => {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          setTimeout(() => iframe.remove(), 3000);
        }, 1000);
      } else {
        // Desktop mode: write to temp file, open in default browser
        const ws = window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.workspaceDir;
        if (!ws) throw new Error("Cannot resolve workspace directory");
        const base = ws.replace(/\\/g, "/").replace(/\/+$/, "") + "/data";
        html = resolveImagePaths(html, base);
        const tmpDir = base + "/temp/pandoc-pdf-exporter";
        const absHtml = tmpDir + "/print.html";
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(absHtml, html, "utf-8");
        const { exec } = require("child_process");
        exec(`start "" "${absHtml}"`, (err) => {
          if (err) throw err;
          showMessage("Opened in your browser. Press Ctrl+P → Save as PDF.", 8000, "info");
        });
      }
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] print failed`, err);
      showMessage("Print failed: " + err.message, 5000, "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async exportPdf(button) {
    if (this.isWeb) {
      showMessage("Export is only supported in the desktop app.", 5000, "info");
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Exporting...";
    try {
      await this.plugin.saveSettings(this.settings);
      const siYuanFont = getComputedStyle(document.body).fontFamily + ", sans-serif";
      const imgWidths = this.settings.separateImageSizes ? this.imageWidths : null;
      const imgAligns = this.settings.separateImageSizes ? this.imageAligns : null;
      let html = buildExportHtml(this.documentData, this.settings, this.pageCount, this.getPreviewPageHtml(), true, siYuanFont, imgWidths, imgAligns);
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
    this.isWeb = getFrontend() === "browser-desktop";
  }

  async onload() {
    this.addIcons(`<symbol id="iconPandocPdfExport" viewBox="0 0 24 24">
      <path d="M6 2h9l5 5v6h-2V8h-4V4H6v7H4V4a2 2 0 0 1 2-2zm10 2.4V6h1.6L16 4.4zM5 13h14a2 2 0 0 1 2 2v4h-4v3H7v-3H3v-4a2 2 0 0 1 2-2zm4 5v2h6v-2H9zm9-2a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"></path>
    </symbol>
    <symbol id="iconAlignLeft" viewBox="0 0 20 20">
      <path d="M3 3h14v2H3V3zm0 4h10v2H3V7zm0 4h14v2H3v-2zm0 4h10v2H3v-2z"></path>
    </symbol>
    <symbol id="iconAlignCenter" viewBox="0 0 20 20">
      <path d="M3 3h14v2H3V3zm2 4h10v2H5V7zm-2 4h14v2H3v-2zm2 4h10v2H5v-2z"></path>
    </symbol>
    <symbol id="iconAlignRight" viewBox="0 0 20 20">
      <path d="M3 3h14v2H3V3zm4 4h10v2H7V7zm-4 4h14v2H3v-2zm4 4h10v2H7v-2z"></path>
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
      new PreviewController(this, root, dialog, this.isWeb);
    } catch (err) {
      dialog.destroy();
      confirm("Cannot open PDF preview", escapeHtml(err.message || err), () => {});
    }
  }
};
