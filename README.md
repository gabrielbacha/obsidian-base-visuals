# Bases Visuals

Bases Visuals adds compact, Notion-inspired pill colors and conditional formatting to Obsidian Base tables.

## Features

- Stable automatic colors scoped by property and value
- Named presets plus custom hex colors
- Eight switchable palette templates with full live previews: Default · Bases Visuals plus Sunset spectrum, Desert coast, Editorial, Ocean depth, Ember, Citrus grove, and Electric bloom. Changing a template updates automatic and preset colors per Base while preserving custom colors.
- A centralized manager for every discovered pill color
- Searchable settings manager grouped by property
- Long labels stay compact with ellipsis and a full-value tooltip
- Native and embedded Base table support
- Light and dark theme-aware colors
- Ordered conditional-formatting rules for text, lists, checkboxes, inputs, and numbers
- Drag, button, and keyboard ordering for conditional-formatting rules
- Responsive, Base-scoped conditional-formatting cards with value autocomplete
- Balanced treatment controls with a dedicated pill-override row and clean truncation for long color summaries
- Independent background and exact text colors, including a permanent light Muted treatment
- Optional bold and strikethrough conditional formatting
- Per-rule background tint strength from 0–100%, with a slightly stronger hover state
- A native-looking palette button in Base table toolbars
- A compact Layout popover for native row heights and reusable column widths
- Named layout presets that restore row height, width, and application scope together
- Temporary header indicators showing which columns match the selected width
- Subtle table-header tinting and emphasis for the first visible column
- Grouped row headings that automatically mirror the grouped value's pill color
- View-specific column appearance with muted, faint, custom-color, and bold treatments
- Keyboard-accessible layout, width-scope, and column-tone controls
- Guarded native pill removal that never lets Delete or Backspace clear the whole cell

## Usage

Open a Base table containing a list property. Values receive stable automatic colors as they appear.

- **Left-click** a cell to keep using Obsidian's native value editor.
- Hover or focus a pill to reveal its **×** control. When an individual pill is active, **Delete** or **Backspace** removes only that value rather than clearing the cell.
- **Right-click** a pill for a compact action menu. Open its palette only when changing color, manage every encountered value in that table column, or remove the clicked value from its row.
- Click **Format** in a Base table toolbar to open the Base-scoped manager directly on Pill colors; Conditional formatting remains available in its second tab.
- Click **Layout** to adjust row height, test column-width presets, reset widths, or save the current combination as a reusable layout.
- Use **Unset only** to preserve unrelated manual widths. Header indicators show which columns will change. **All columns** always asks for confirmation.
- Group a table by a colored list property to carry each value's pill color into its group heading.
- Right-click a column header and choose **Column appearance** to de-emphasize, recolor, or bold that field in the current view or every view in the Base.
- For list columns, right-click the header and choose **Pill appearance** to change its color strategy and Soft, Solid, or Outline style without opening the full manager.
- Choose **Format** in the Base toolbar to manage conditional formatting and every discovered property value for that Base.
- In Conditional formatting, choose a property from the current Base and start typing to select a value from Obsidian's suggestion menu. New rules start without a visual treatment. Choose an optional **Background** and its tint percentage, optional **Text** color, Bold or Strikethrough, and whether that background should override pill colors. Explicit text colors render exactly as selected; leave Text on **Automatic** when you want accessible contrast against the background.
- Reorder conditional-formatting rules by dragging their grip, with Move up/down buttons and **Alt+Arrow** retained for keyboard and mobile use.

Pill colors are scoped to the current Base and shared by its views. Friendly column names are display-only: settings remain attached to the underlying note property even when a Base renames the column. Conditional-formatting rules can target only the current view or every view in the Base, remain case-insensitive, and are evaluated top-to-bottom. Color and conditional-formatting changes never modify note properties. Layout and column-appearance actions use Obsidian's native Base view configuration. Column appearance can also be shared across every view in the Base. The explicit **Remove from row** action delegates that one list edit to Obsidian.

Smart strategies recognize common property families such as `status`, `state`, `workflow`, `phase`, `priority`, `severity`, and suffixed forms such as `status_todo` or `sprint_priority`. Ordered labels and explanatory suffixes are normalized, so values such as `2. In Progress`, `3.Waiting (for a dependency)`, and `1.P0` retain their semantic colors.

## Installation

### Community plugins

Bases Visuals is being prepared for the Obsidian Community Plugins directory. Once accepted, install it from **Settings → Community plugins → Browse**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Place them in `<vault>/.obsidian/plugins/bases-pill-colors/`.
3. Reload Obsidian and enable **Bases Visuals** under **Community plugins**.

## Privacy and data access

- Bases Visuals works entirely offline and makes no network requests.
- It observes rendered Base tables and stores visual preferences in namespaced Base view configuration.
- It does not modify note Markdown or frontmatter. Pill colors, conditional formatting, layout, and column appearance are saved as namespaced Base view configuration; **Remove from row** invokes Obsidian's native list-value removal control.
- It includes no telemetry or analytics.

## Development

```bash
npm install
npm run dev
```

Use `npm run build`, `npm test`, and `npm run lint` before releasing.

## Support

Report bugs and request features through [GitHub Issues](https://github.com/gabrielbacha/obsidian-base-visuals/issues).

## License

[MIT](LICENSE)
