# Bases Visuals

Bases Visuals adds compact, Notion-inspired pill colors and conditional formatting to Obsidian Base tables.

## Features

- Stable automatic colors scoped by property and value
- Named presets plus custom hex colors
- Right-click color editing without replacing Obsidian's list editor
- Searchable settings manager grouped by property
- Long labels stay compact with ellipsis and a full-value tooltip
- Native and embedded Base table support
- Light and dark theme-aware colors
- Ordered conditional-formatting rules for text, lists, checkboxes, inputs, and numbers
- Soft cell or entire-row highlighting with preset and custom colors
- A native-looking palette button in Base table toolbars

## Usage

Open a Base table containing a list property. Values receive stable automatic colors as they appear.

- **Left-click** a cell to keep using Obsidian's native value editor.
- **Right-click** a pill to choose a preset, enter a custom color, reset it to automatic, or turn coloring off.
- Click the **palette icon** in a Base table toolbar to add and reorder formatting rules for visible properties.
- Open **Settings → Bases Visuals** to manage conditional formatting and every discovered property value.

Rules are global by property ID, case-insensitive, and evaluated top-to-bottom. The plugin never modifies note properties or `.base` files.

## Installation

### Community plugins

Bases Visuals is being prepared for the Obsidian Community Plugins directory. Once accepted, install it from **Settings → Community plugins → Browse**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Place them in `<vault>/.obsidian/plugins/bases-pill-colors/`.
3. Reload Obsidian and enable **Bases Visuals** under **Community plugins**.

## Privacy and data access

- Bases Visuals works entirely offline and makes no network requests.
- It observes rendered Base tables and stores color preferences through Obsidian's plugin settings API.
- It does not read or modify Markdown content, frontmatter, or `.base` files.
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
