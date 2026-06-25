# Pandoc PDF Exporter — Working Context

## Overview
A full-featured SiYuan plugin that provides WYSIWYG print preview + PDF export with Pandoc/WeasyPrint backends.

## Files
- `index.js` (~1396 lines) — Main plugin + PreviewController class
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

#### Export Pipeline (three paths)
**A. Download PDF** (`downloadPdf`):
- Captures each preview `.pp-page` as a canvas at 3x scale (~288 DPI) using `html2canvas`.
- Assembles pages into a PDF using `jsPDF`.
- Triggers direct download — no browser print dialog.
- **Matches preview exactly** because it captures what's on screen.
- Requires CDN libraries (loaded dynamically from CDN).

**B. Print via Browser** (`printPreviewPdf`):
- Two sub-paths:
  - **Web mode**: Renders cloned preview pages in a hidden same-origin iframe with print CSS overrides, auto-triggers `window.print()`.
  - **Desktop**: Saves temp HTML to workspace `data/temp/pandoc-pdf-exporter/print.html`, opens in default browser for Ctrl+P.
- Prints or saves as PDF via the browser's print dialog.

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

## Lessons Learned: Preventing Preview/Export Page Mismatch

These rules MUST be followed to keep the print output matching the preview:

### 1. Images Must Be Loaded Before DOM Capture
- `updatePreview()` paginates immediately, but images may be 0×0 (not loaded).
- Image `load` events trigger `schedulePreview()` → re-pagination with correct sizes.
- **Always** wait for all incomplete `<img>` elements before calling `getPreviewPageHtml()` or cloning `.pp-page` DOM.
- After waiting, also wait ~150ms for the debounced `updatePreview()` to run.

### 2. Resolve CSS Variables Before Passing to Print Iframe
- `buildStyle(settings, false)` sets `--pp-font-family: var(--b3-font-family-protyle, ...)`.
- These `--b3-*` variables exist in SiYuan's document but NOT in the print iframe.
- **Always** resolve the computed font via `getComputedStyle(.pp-page-body).fontFamily` and inject it as `:root { --pp-font-family: <resolved> }` in the print CSS.
- Same for any other CSS variable that references SiYuan theme variables.

### 3. Content Renders ~1% Taller at Print Resolution
- Screen pagination at 96 DPI doesn't match print rendering (typically ~300 DPI).
- Font glyphs, line heights, and image scaling differ enough to cause overflow.
- **Always** reduce bottom padding by ~2mm (`calc(var(--pp-margin-bottom) - 2mm)`) in the print CSS to absorb most of the overflow. The minimum padding is 0.8cm to keep the footer (at `bottom: 0.52cm`) safely clear of content.
- Some documents (heavy text, complex layouts) may have >1% height difference. For these, `overflow: hidden` clips the remaining sub-mm overflow, or the user can set 99% scale in the print dialog.
- Without this, content that fits exactly in preview will overflow in print, creating blank pages.

### 4. overflow: hidden on Page Divs Prevents Blank Pages
- Chrome's print engine may create a new (mostly blank) page for content that overflows the page box, even by sub-pixel amounts.
- **Always** set `.pp-page { overflow: hidden !important }` in the print CSS to clip tiny overflow.
- WARNING: Chrome's print engine does NOT always honor `overflow: hidden` in paged media. It works for sub-pixel overflow but can fail for larger amounts (>1mm). The primary defense is the padding reduction in rule #3 — `overflow: hidden` is a backup.
- If blank pages still appear, the user should set 99% scale in the print dialog, which shrinks everything uniformly and prevents overflow entirely.

### 5. @page margin Must Be 0 in Print CSS
- `buildStyle(settings, false)` sets `@page` with user's margin values.
- The browser's print dialog also has its own margin setting (Default/Minimum/None).
- **Always** override with `@page { margin: 0 }` AFTER the buildStyle `<style>` block so CSS padding controls margins, not the browser dialog.
- The page divs already have `padding` matching the user's margin settings.

### 6. page-break-after: auto on :last-child Needs !important
- The generic `.pp-page { break-after: page !important }` rule (with !important) overrides `.pp-export-page:last-child { break-after: auto }` (no !important) from buildStyle.
- **Always** use `.pp-page:last-child { break-after: auto !important }` to ensure the last page doesn't create an extra blank page.

### 7. Headers/Footers Use pointer-events: none (Need Override in Print)
- `buildStyle` sets `.pp-page-mark { pointer-events: none }` for UI reasons.
- Chrome's PDF generator respects `pointer-events` — links in headers/footers become unclickable in the PDF.
- **Always** add `.pp-page-mark { pointer-events: auto !important }` in the print CSS.

### 8. Clone Preview DOM (Not rebuildExportHtml) for Web Print
- `buildExportHtml()` with `forPdfEngine=false` generates HTML with `break-after: page`, but the resulting HTML only renders page 1 in the iframe print context (Chrome bug/behavior).
- **Always** clone `.pp-page` elements from the live preview DOM for the web print iframe — they already have correct pagination, images, and headers/footers.
- Use `buildExportHtml()` only for the desktop file-based print path.

### 9. Reset html,body Styles in Print CSS
- Default browser styles on `<html>` and `<body>` can interfere with CSS page breaking.
- **Always** include `html, body { margin:0; padding:0; background:#fff; overflow:visible !important; min-height:0 !important; }` in the print CSS.

### 10. Chrome Print Dialog Overrides @page Size
- `@page { size: 210mm 297mm }` in CSS does NOT auto-select the paper in Chrome's print dialog.
- Chrome defaults to the last-used paper (often US Letter in US regions, A4 in EU).
- **Always** instruct the user to manually select the correct paper in the dialog.
- Similarly, the print dialog's "Margins" setting (Default/Minimum/None) overrides `@page { margin: 0 }`. The user must set margins to "None" in the dialog for the CSS padding to control margins.
- The print dialog's "Scale" setting defaults to 100 (fit to page). If blank pages still appear, 99% scale shrinks content uniformly and often fixes print-resolution overflow that padding reduction + `overflow: hidden` cannot fully address.

## Known Browser Limitations

1. **`overflow: hidden` in paged media**: Chrome's print engine may ignore `overflow: hidden` on page-breaking elements. This causes content overflow to create new pages instead of being clipped. Workaround: padding reduction + user setting 99% scale.
2. **Print resolution rendering difference**: Screen (96 DPI) and print (300 DPI) render fonts and images differently. Content can be 1-3% taller in print depending on content mix (text-heavy has larger difference). The ~2mm padding reduction covers ~1%; for heavier documents, 99% scale is needed.
3. **`@page size` ignored by dialog**: Chrome's print dialog doesn't auto-select the paper size from CSS. Must be set manually.
4. **Dialog margins override CSS**: Chrome's print dialog "Margins" setting overrides `@page { margin }`. Must be set to "None" for CSS padding to work correctly.

## Download PDF (Direct Generation)

The **Download PDF** button bypasses the browser print dialog entirely by capturing preview pages as canvas images and assembling them into a PDF file:

1. Waits for all preview images to load.
2. Loads `html2canvas` and `jsPDF` from CDN (cloudflare) on demand.
3. For each `.pp-page`, removes preview-only styling (shadow, rounded corners) and captures at 3x scale (~288 DPI) using `html2canvas`.
4. Embeds each canvas as a JPEG image in a jsPDF document with the correct paper dimensions.
5. Triggers a file download (no print dialog, no user settings).

**Benefits**:
- Matches preview exactly (captures screen rendering, not print rendering)
- No print dialog (no scale/margin/paper settings to configure)
- Works identically in web and desktop mode
- No blank pages (no print-resolution overflow issue)

**Limitations**:
- Requires internet access for first use (CDN library loading)
- Text is rasterized (not selectable in the PDF, since it's embedded as images)
- ~288 DPI resolution (adequate for screen viewing but below true 300 DPI print)

## Web Access Support (HTTP mode)

When SiYuan is accessed via a web browser (not the desktop app), `getFrontend()` returns `"browser-desktop"`. The plugin detects this via `isWeb`:

- **Export button** disabled — shows notification: "Export is only supported in the desktop app. Use Print instead." (`.pp-export-disabled` CSS class dims the button).
- **Print via Browser** in web mode:
  1. Waits for all preview images to load (ensures pagination is settled).
  2. Clones the `.pp-page` elements from the live preview DOM.
  3. Captures the `<style>` from the preview for base CSS.
  4. Wraps in an iframe with an injected `printStyle` that applies all the fixes from the Lessons Learned section (resolved font, `@page margin:0`, `overflow:hidden`, 2mm padding relief with 0.8cm minimum, `:last-child` override, `pointer-events`, html/body reset).
  5. Auto-triggers print via a polling script that waits for all iframe images to load, then calls `window.print()`.
  6. Cleans up the iframe after 120s.
- Top-left kicker shows "Web access" instead of "Desktop".
- `require("child_process")` is wrapped in try-catch so the plugin loads without error in browser context.

## Next Steps / Ideas
- Mobile support (simplified UI / different export strategy)
- Save/load named presets for settings
- Custom CSS injection field for advanced users
- Add page break controls (before heading X, avoid widows/orphans)
- Support for table of contents generation
- Watch file / auto-export on save?
- Multi-document batch export
