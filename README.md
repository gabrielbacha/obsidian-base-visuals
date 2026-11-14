# Bases Visuals

Bases Visuals adds compact, Notion-inspired pill colors and conditional formatting to Obsidian Base tables.

<div align="center">
  <h3>Made by <a href="https://mindfulapps.xyz/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=bases_visuals_readme_header">Mindful Apps</a></h3>
  <p>
    <a href="https://mindfulapps.xyz/bases-visuals/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=bases_visuals_readme_header"><strong>Plugin page</strong></a>
    &nbsp;·&nbsp;
    <a href="https://mindfulapps.xyz/obsidian/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=bases_visuals_readme_header"><strong>More Obsidian plugins</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/gabrielbacha/obsidian-base-visuals/issues/new?template=feature_request.yml"><strong>Request a feature</strong></a>
  </p>
</div>

## Features

- Stable automatic colors scoped by property and value
- Named presets plus custom hex colors
- Eight switchable palette templates with full live previews: Default · Bases Visuals plus Sunset spectrum, Desert coast, Editorial, Ocean depth, Ember, Citrus grove, and Electric bloom. Changing a template updates automatic and preset colors per Base while preserving custom colors.
- A centralized manager for every discovered pill color
- Searchable settings manager grouped by property
- Collapsible property categories whose state is remembered across Obsidian reloads
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
- A compact group-heading button that creates a new note with the clicked list value already assigned
- Inline filename editing from Base tables without opening or context-clicking the note
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
- Group a table by a colored list property to carry each value's pill color into its group heading. Use the **+** button beside a group to open Obsidian's new-note prompt with that list value already assigned.
- In a `file.name` column, click the empty area of a filename cell to rename that file in place; the filename link itself still opens the note. Press **Enter** or leave the field to save, or press **Escape** to cancel. The file stays in its current folder with its original extension, and duplicate or invalid names are rejected safely.
- Right-click a column header and choose **Column appearance** to de-emphasize, recolor, or bold that field in the current view or every view in the Base.
- For list columns, right-click the header and choose **Pill appearance** to change its color strategy and Soft, Solid, or Outline style without opening the full manager.
- Enable **Wrap pills** there to flow multiple list pills onto additional lines within the column.
- Choose **Format** in the Base toolbar to manage conditional formatting and every discovered property value for that Base.
- In Conditional formatting, choose a property from the current Base and start typing to select a value from Obsidian's suggestion menu. New rules start without a visual treatment. Choose an optional **Background** and its tint percentage, optional **Text** color, Bold or Strikethrough, and whether that background should override pill colors. Explicit text colors render exactly as selected; leave Text on **Automatic** when you want accessible contrast against the background.
- Reorder conditional-formatting rules by dragging their grip, with Move up/down buttons and **Alt+Arrow** retained for keyboard and mobile use.

Pill colors are scoped to the current Base and shared by its views. Base-wide choices are stored once in a sparse top-level `basesVisuals` block, while automatic values are discovered in memory and never written. Unknown extension fields and newer schema versions are preserved so another compatible editor can safely share the same block. Concurrent edits to different fields are merged; incompatible edits to the same field are left unsaved and reported instead of being overwritten. Friendly column names are display-only: settings remain attached to the underlying note property even when a Base renames the column. Conditional-formatting rules can target only the current view or every view in the Base, remain case-insensitive, and are evaluated top-to-bottom. Color and conditional-formatting changes never modify existing note properties; the group **+** action creates a new note with the selected list value. Layout actions use Obsidian's native Base view configuration. Shared appearance lives in `basesVisuals`; view-only rules and column appearance live in `basesVisualsView`. Column appearance is shared across every view in the Base by default; turn off **All views in this base** to create a view-specific override. The explicit **Remove from row** action delegates that one list edit to Obsidian.

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
- It observes rendered Base tables and stores only explicit visual preferences in sparse, namespaced Base configuration.
- Visual settings do not modify note Markdown or frontmatter. The group **+** action explicitly creates a new note with the selected list value, inline filename editing renames the selected file through Obsidian, and **Remove from row** invokes Obsidian's native list-value removal control. Base-wide choices are saved once at the top level of the `.base` file; view-specific choices remain with that view.
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

---

<div align="center">
  <h3>Made by <a href="https://mindfulapps.xyz/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=bases_visuals_readme_footer">Mindful Apps</a></h3>
  <p>
    <a href="https://mindfulapps.xyz/bases-visuals/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=bases_visuals_readme_footer"><strong>Plugin page</strong></a>
    &nbsp;·&nbsp;
    <a href="https://mindfulapps.xyz/obsidian/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=bases_visuals_readme_footer"><strong>More Obsidian plugins</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/gabrielbacha/obsidian-base-visuals/issues/new?template=feature_request.yml"><strong>Request a feature</strong></a>
  </p>
</div>

## Filename helper ownership and isolated checks

`src/generated/portable-names.ts` is a compatibility copy of canonical contract v2 `Applications-GB/_Supporting/bases-contract-NPM/src/names.ts`. The normal plugin build imports this file for rename behavior; other contract imports retain the registry dependency. Run `node scripts/filename-contract.mjs --update` after validating a canonical change. The build checks the pinned SHA-256, and checks canonical drift when that checkout is present. A standalone clone can build using its checksum-pinned copy. Do not hand-edit the generated helper.

`BPC_BUILD_DIR` directs a development bundle to an isolated output folder. The native acceptance test uses the existing strict Obsidian harness with a generated vault/profile, the installed executable and code-only ASAR. It verifies artifact, user-data and vault ownership and closes only its owned processes. The supplemental source-rule layout fixture uses SDK test stubs; the ordinary plugin and real popout are loaded normally. No installed plugin, existing profile or personal vault is changed.

Clean unused checks cached Markdown note properties across the vault, which includes notes hidden by another Base filter. It keeps declared options and uncertain properties, lists the proposed removals and checks their usage again at confirmation. Unindexed notes prevent removal. A failed close-time save keeps its dirty data for retry; it is not silently discarded. The Obsidian void unload hook cannot delay operating-system application exit.

The immutable source files in `tests/baseline/` are the performance reference recorded by `provenance.json`; they are not maintained as a second implementation. Comparisons use named synthetic sizes and the same host. They do not establish a maximum supported table or an absolute response-time target.

Scoped settings capture the Base file and native view when an edit starts. If Obsidian reuses a pane for another file or view, the old store completes its queued write against the original target and a new store reads the new target. Save results belong to their store, so a late result cannot overwrite the new pane's feedback.
