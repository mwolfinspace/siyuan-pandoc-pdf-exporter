# Pandoc PDF Exporter

Office-style print preview and PDF export for the current SiYuan page.

## Features

- **Live print preview** — scrollable, paginated preview inside SiYuan
- **Custom page size** — A3, A4, Letter, HD screen, FHD screen
- **Orientation** — portrait or landscape
- **Adjustable margins** — top, bottom, left, right (centimeters)
- **Headers & footers** — independent left/center/right text on each page with dynamic tokens, hyperlinks support
- **Page numbers** — toggle on/off, auto-numbering
- **Font control** — system font picker, content font size, title font size
- **Text alignment** — left or justify
- **Paragraph spacing** — adjustable gap between blocks
- **Image width** — slider from 20% to 100%; below 100% images float right with text wrapping
- **Two export methods**:
  - **Export** — generates PDF via WeasyPrint (direct, no HTML transformation, preserves CSS)
  - **Print via Browser** — opens in your default browser, press Ctrl+P → Save as PDF (pixel-perfect, uses Chromium renderer)

## Installation

1. Copy the `siyuan-pandoc-pdf-exporter` folder into SiYuan's `data/plugins/` directory.
2. Enable the plugin in SiYuan: Settings → Plugins → Pandoc PDF Exporter → Enable.
3. (Optional) Install WeasyPrint for the Export button:

```
pip install weasyprint
```

On Windows, also install the GTK3 runtime:
https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases

4. Restart SiYuan.

## Usage

1. Open a document in SiYuan.
2. Click the printer icon in the top bar.
3. The preview dialog opens with your document rendered in print layout.
4. Adjust settings in the right sidebar (page size, margins, font, etc.). The preview updates automatically.
5. Click **Export** to generate a PDF via WeasyPrint, or **Print via Browser** to open in your browser for native print-to-PDF.

## Settings Reference

### Page

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Page size | select | A4 | A3, A4, Letter, HD screen, FHD screen |
| Orientation | toggle | Vertical | Portrait or landscape |
| Margin Top | number (cm) | 2 | Top margin (0–8 cm) |
| Margin Bottom | number (cm) | 2 | Bottom margin (0–8 cm) |
| Margin Left | number (cm) | 2 | Left margin (0–8 cm) |
| Margin Right | number (cm) | 2 | Right margin (0–8 cm) |

### Header and Footer

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Page number | toggle | on | Show page numbers in footer |
| Header text | toggle | off | Enable header zone |
| Header Left | text | | Text for left header slot |
| Header Center | text | | Text for center header slot |
| Header Right | text | | Text for right header slot |
| Footer text | toggle | off | Enable footer zone |
| Footer Left | text | | Text for left footer slot |
| Footer Center | text | | Text for center footer slot |
| Footer Right | text | | Text for right footer slot |

### Typography

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Font style | select | SiYuan default | System font for the document body |
| Content font size | number (pt) | 11 | Base text size (8–28 pt) |
| Title font size | number (pt) | 20 | Document title size (12–48 pt) |
| Space between blocks | number (em) | 0.35 | Vertical gap after paragraphs, headings, lists, etc. |
| Add page title | toggle | on | Include the document title at the top of the first page |
| Text alignment | toggle | Left | Left align or Justify body text |

### Images

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Image width | slider | 100% | Scale images from 20% to 100% of content width. Below 100%, images float right with text wrapping around them. |

## Tokens for Header and Footer

You can use the following dynamic tokens in any header/footer text field. They are replaced with live values when the PDF is generated.

| Token | Replaced with | Example output |
|-------|---------------|----------------|
| `%title` or `$title$` | Document title | "My Document" |
| `%page` or `$page$` or `{PAGE}` | Current page number | "1" |
| `%pages` or `$pages$` or `{NUMPAGES}` | Total page count | "5" |
| `%date` or `$date$` | Current date (YYYY-MM-DD) | "2026-05-22" |
| `%time` or `%hour` or `$time$` or `$hour$` | Current time (HH:mm) | "14:30" |

### Token examples

| Field content | Result on page 3 of 10 |
|---------------|------------------------|
| `Page %page of %pages` | Page 3 of 10 |
| `%title` | My Document |
| `Printed: %date at %hour` | Printed: 2026-05-22 at 14:30 |
| `$title$ — $date$` | My Document — 2026-05-22 |
| `{PAGE}/{NUMPAGES}` | 3/10 |

## Hyperlinks in Header and Footer

You can add clickable links using Markdown-style syntax:

```
[Visit our website](https://example.com)
[Page %page](https://example.com/page=%page)
```

HTML syntax also works:

```
Visit <a href="https://example.com">our website</a>
```

Both the preview and the exported PDF will render links. Tokens like `%page` work inside link text and URLs.

**Note:** hyperlinks are clickable in the PDF only when opened in a PDF reader that supports links (Adobe Acrobat, Edge PDF, Chrome PDF viewer, etc.).

## Export Methods

### Export (WeasyPrint)

Runs WeasyPrint directly on the generated HTML. Bypasses Pandoc's AST transformation so all CSS is preserved. The generated PDF closely matches the preview, including custom properties, CSS Grid, `object-fit`, etc.

Requires:
- Python 3.x
- `pip install weasyprint`
- Windows: GTK3 runtime (see Installation above)

### Print via Browser

Opens the export HTML in your default web browser. Press **Ctrl+P** (or Cmd+P on Mac) and select **Save as PDF** as the destination printer.

This produces a **pixel-perfect** PDF because it uses your browser's native Chromium rendering engine — exactly what you see in the preview.

No additional software required.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **Export fails: "cannot load library libgobject-2.0-0"** | Install GTK3 runtime on Windows (see Installation) |
| **WeasyPrint not found** | Run `pip install weasyprint` and ensure Python Scripts folder is in your system PATH |
| **Images missing in PDF** | Asset paths are resolved automatically. If images still don't appear, check that files exist in `{workspace}/data/assets/` |
| **Preview doesn't match export** | Use the **Print via Browser** button (browser-native rendering is identical to preview) |
| **Header/footer not showing** | Enable "Header text" or "Footer text" toggle in settings; ensure at least one text field is non-empty |
| **Plugin doesn't appear** | Restart SiYuan after installing the plugin |
| **Chinese characters garbled** | Select a Chinese font (e.g., Microsoft YaHei, Noto Sans SC) in the Font style setting |

## Compatibility

- **SiYuan version**: 2.9.0+
- **Frontends**: Desktop (Electron), Browser desktop
- **Backends**: All

## License

MIT
