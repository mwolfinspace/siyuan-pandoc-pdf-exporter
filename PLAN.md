# Pandoc PDF Exporter Plan

## Goal

Build a SiYuan plugin that exports the active document to a polished PDF through SiYuan's bundled Pandoc, with a modern Office 365 style print-preview dialog.

## Current Implementation State

- Plugin folder: `siyuan-pandoc-pdf-exporter`
- Entry files: `plugin.json`, `index.js`, `index.css`
- UI opens from a topbar printer button.
- Preview is rendered in a full-screen dialog with:
  - scrollable paged preview
  - right settings rail
  - page size: A3, A4, Letter, HD screen, FHD screen
  - orientation: vertical or horizontal
  - margin controls in centimeters
  - page number toggle
  - independent header/footer left, center, and right text fields
  - field tokens: `%title`, `%date`, `%hour`, `%time`, `%page`, `%pages`, `{PAGE}`, `{NUMPAGES}`, `$title$`, `$date$`
  - font family list from `/api/system/getSysFonts` and `queryLocalFonts` fallback
  - separate content font size and document title font size
  - spacing between SiYuan content blocks
  - document title toggle
  - left align / justify switch
  - image width percentage and smart right-float wrapping when below 100%
  - export button
- Options are saved with `this.saveData("settings.json", settings)`.
- PDF export writes a temporary HTML file to `/temp/pandoc-pdf-exporter/export.html` and calls `/api/convert/pandoc`.
- Export reuses the preview's generated page HTML, so manual preview page breaks are carried into the PDF input.

## Architecture

1. `PandocPdfExporterPlugin`
   - Registers icon and topbar button.
   - Loads/saves settings.
   - Opens the print dialog.
   - Wraps kernel APIs: `fetchPost`, `/api/file/putFile`, `/api/convert/pandoc`, `/api/file/getFile`.

2. Active document capture
   - First reads the visible `.protyle-wysiwyg` DOM.
   - Clones the DOM, removes editing-only attributes, and uses that HTML for preview/export.
   - Gets title from `.protyle-title__input` or browser title fallback.

3. Preview pagination
   - Converts paper size from mm to pixels for 96 DPI preview.
   - Clones cleaned document children into pages.
   - Measures each child and starts a new page when content exceeds available page body height.
   - Very large blocks currently overflow one page rather than splitting internally.
   - Image-only rows are marked as `pp-image-row` so floated images wrap into nearby text without leaving an empty paragraph row.
   - Preview/export typography CSS is scoped to `.pp-page-body` so export font choices do not change the plugin dialog or SiYuan UI.

4. Export
   - Builds a complete HTML document with print CSS and `@page`.
   - **Desktop**: saves to temp file, opens in browser for Ctrl+P → Save as PDF.
   - **Web**: renders in hidden same-origin iframe, auto-triggers `window.print()`.
   - PDF export via Pandoc/WeasyPrint (desktop only):
     - input: `/temp/pandoc-pdf-exporter/export.html`
     - output: `/temp/pandoc-pdf-exporter/export.pdf`
     - first tries direct WeasyPrint (best CSS fidelity)
     - falls back to SiYuan's Pandoc API with engines: weasyprint → wkhtmltopdf → pdfroff → xelatex → lualatex → pdflatex

## Known Risks / Follow-Up Work

1. **True pagination**
   - Current paginator splits at block level. Continue by splitting long paragraphs, code blocks, and tables across pages.
   - ~~Add a page count recalculation pass after all images finish loading.~~ (Done: `updatePreview()` re-runs on image load events.)
   - **CRITICAL**: Print resolution renders content ~1% taller than screen. Apply 3mm padding relief and `overflow:hidden` in the print CSS to prevent blank pages (see `CONTEXT.md` "Lessons Learned").

2. **SiYuan source fidelity**
   - DOM capture is practical but may miss some internal rendering details.
   - Investigate kernel endpoints for active block kramdown/markdown or document export in the target SiYuan version.
   - If available, add a mode: `exportMdContent -> pandoc -> preview HTML`.

3. **Pandoc PDF engine**
   - `wkhtmltopdf` is best for CSS fidelity, but may be unavailable on some installs.
   - `xelatex` fallback is available for many Pandoc installs, but will not honor every CSS rule.
   - ~~Add `weasyprint` or a custom LaTeX template fallback with useful error messages.~~ (Done: direct WeasyPrint is the primary path, with Pandoc API as fallback.)

4. **Header/footer fidelity**
   - HTML preview shows header/footer per page.
   - Pandoc/LaTeX page headers need a generated template or variables for exact parity.
   - Next agent should add a custom Pandoc template with `fancyhdr` and convert `%date`, `%hour`, `%title`, `%page`, `%pages` tokens.

5. **Image wrapping**
   - Preview uses CSS `float: right` when image width is below 100%.
   - Export HTML contains the same CSS, but Pandoc PDF engines differ in float support.
   - For LaTeX, consider emitting raw LaTeX wrapfigure blocks for images when `imageWidth < 100`.

6. **Asset paths**
   - Images cloned from the editor may use relative or workspace asset URLs.
   - If an export misses images, normalize `src` to accessible file URLs or copy assets to the temp folder before Pandoc.

7. **Font list**
   - System fonts are loaded from `/api/system/getSysFonts`; browser local fonts are added when supported.
   - Add a manual font input for platforms where neither API is available.

8. **UX polish**
   - Add preset buttons for common margins.
   - Add zoom controls and fit-to-width.
   - Add page thumbnails like Word's print panel.
   - Add progress states for conversion and file download.

9. **Web mode print (completed)**
   - Web access (HTTP mode) detected via `getFrontend() === "browser-desktop"`.
   - Export button disabled with notification in web mode.
   - Print via Browser uses preview DOM cloning + same-origin iframe.
   - See `CONTEXT.md` "Lessons Learned" for all the fixes required to match preview.
   - Key issues solved:
     - `@page margin: 0` to prevent browser dialog margins from overriding CSS padding.
     - `overflow: hidden` + 2mm padding relief (min 0.8cm) to absorb print-resolution rendering differences.
     - Resolved fonts via `getComputedStyle(.pp-page-body).fontFamily` (CSS variables don't work in iframe).
     - Image pre-loading before DOM capture (prevents stale pagination).
     - `:last-child { break-after: auto !important }` (prevent blank last page).
     - `pointer-events: auto` on headers/footers (links work in PDF).
     - `html,body` style reset for proper page breaking.
   - Remaining: auto-close iframe after print (browser-dependent).

## Suggested Next Steps For Another Agent

1. Test loading the plugin in SiYuan desktop and confirm the topbar button appears.
2. Open a page with headings, paragraphs, images, tables, and code blocks.
3. Verify preview pagination and CSS against A4 portrait and landscape.
4. Run an export and inspect Pandoc errors in the console if PDF generation fails.
5. Implement a Pandoc LaTeX template for reliable margins, fonts, headers, footers, and page numbers.
6. Improve image path normalization and wrapfigure generation.
