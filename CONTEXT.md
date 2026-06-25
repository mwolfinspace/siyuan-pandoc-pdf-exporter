# Pandoc PDF Exporter — Working Context

## Overview
A full-featured SiYuan plugin that provides WYSIWYG print preview + PDF export with Pandoc/WeasyPrint backends.

## Files
- `index.js` (1168 lines) — Main plugin + PreviewController class
- `index.css` (254 lines) — Preview dialog UI styles
- `plugin.json` — Metadata (name: siyuan-pandoc-pdf-exporter, author: Xedryk, v1.1.0)
- `README_EXPORT.md` — User-facing documentation
- `build.ps1` — Build/packaging script
- `i18n/en_US.json` — English locale strings
- `LICENSE` — MIT
- `icon.png` / `preview.png` — Plugin icons

## Architecture

### Plugin Lifecycle (`PandocPdfExporterPlugin` class, lines 1090-1168)
- `onload()`: Registers topbar icon, loads settings, opens preview dialog
- `openPreview()`: Creates a SiYuan Dialog → instantiates `PreviewController`
- Right-click on toolbar button: "Reset print settings" via Menu
- `loadSettings/saveSettings`: Persists settings.json via SiYuan Data API

### PreviewController (lines 679-1088)
Renders a split-pane dialog:
- Left: Live paginated preview (page-by-page with auto page breaks)
- Right: Settings sidebar (paper size, margins, typography, images, header/footer)

#### Preview Pipeline
1. `getActiveDocument()` — Clones current editor DOM, strips UI elements
2. `cleanPreviewHtml()` — Sanitizes HTML: strips onclick, flattens tables, converts SiYuan link nodes, annotates images for per-image sizing
3. `updatePreview()` — Paginates content into `.pp-page` sections, auto-splits overflow
4. Per-page headers/footers rendered via `buildPageMarkHtml()` with token expansion

#### Export Pipeline (two paths)
**A. Print via Browser** (`printPreviewPdf`):
- Builds export HTML for browser print (Ctrl+P → Save as PDF)
- Saves temp HTML to workspace `data/temp/pandoc-pdf-exporter/print.html`
- Opens in default browser via `start ""` command

**B. Export PDF** (`exportPdf`):
1. Builds export HTML with full CSS (`@page` with margin boxes)
2. **Primary**: Runs `weasyprint` directly (best CSS fidelity)
3. **Fallback**: SiYuan's Pandoc API with engines: weasyprint → wkhtmltopdf → pdfroff → xelatex → lualatex → pdflatex
4. Downloads resulting PDF blob via `<a download>`

### Settings (normalized via `normalizeSettings()`)
- Paper: A3/A4/Letter/HD/FHD, portrait/landscape
- Margins: top/bottom/left/right (cm)
- Header/Footer: 3 boxes each (Left/Center/Right), with tokens (`%page`, `%pages`, `%date`, `%hour`, `%title`, `$page$`, etc.)
- Typography: Font family (system fonts), content/title font sizes, paragraph spacing, text alignment
- Images: Global width slider OR per-image width (toggle `separateImageSizes`)
- Options: Page number toggle, include title, title alignment

### Key Functions
- `buildStyle()` — Generates complete CSS with `@page` rules, margin box CSS, typography
- `buildMarginBoxCss()` — Converts header/footer fields to `@top-left`/`@top-center`/etc. CSS (for WeasyPrint)
- `buildPageMarkHtml()` — Renders header/footer as positioned divs (for browser print)
- `buildExportHtml()` — Assembles full HTML document (two variants: WeasyPrint vs browser print)
- `resolveImagePaths()` — Converts SiYuan relative image paths to `file:///` URIs
- `cleanPreviewHtml()` — Deep cleanup: removes scripts, flattens tables, strips editor UI
- `collectCssVars()` / `collectAllCss()` / `collectLinkTags()` — Captures theme CSS for export fidelity

## CSS (index.css)
- `.pp-shell`: Main grid layout (1fr + 348px sidebar)
- `.pp-preview-toolbar`: Title + page count
- `.pp-pages`: Scrollable preview area with page boxes
- `.pp-sidebar`: Settings panel with fields, toggles, segments
- Responsive: hides sidebar below 900px

## Key Design Decisions
- Two export paths: direct WeasyPrint (CSS margin boxes) vs browser print (positioned divs)
- Per-image width sliders for fine-grained layout control
- Headers/footers support Markdown links (`[text](url)`)
- Font list from SiYuan API + `queryLocalFonts()` (Chrome only)
- Settings auto-saved on every change (debounced via `schedulePreview`)
- Mobile blocked with error message (desktop-only for now)

## Web Access Support (HTTP mode)

When SiYuan is accessed via a web browser (not the desktop app), `getFrontend()` returns `"browser-desktop"`. The plugin detects this via `isWeb`:

- **Export button** shows a notification: "Export is only supported in the desktop app. Use Print instead." — The button is also visually dimmed (`.pp-export-disabled`)
- **Print via Browser** in web mode clones the preview pages directly (which already have
  correct pagination), injects minimal print CSS with `break-after:page !important` and
  `page-break-after:always !important`, plus auto-print/auto-close script, and renders
  in a hidden same-origin iframe → `iframe.contentWindow.print()`.
- Top-left kicker shows "Web access" instead of "Desktop"
- `require("child_process")` is wrapped in try-catch so the plugin loads without error in browser context

## Next Steps / Ideas
- Mobile support (simplified UI / different export strategy)
- Save/load named presets for settings
- Custom CSS injection field for advanced users
- Add page break controls (before heading X, avoid widows/orphans)
- Support for table of contents generation
- Watch file / auto-export on save?
- Multi-document batch export
