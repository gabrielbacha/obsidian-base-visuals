# Changelog

All notable changes to Bases Visuals are documented here.

## 0.5.0 — 2026-08-14

- Color grouped table headings with the same property/value color as their matching pills.
- Remove the native gray gap between colored group headings and their rows.
- Add a native **Column appearance** entry to column-header context menus.
- Add view-specific Default, Muted, Faint, and custom text colors for column body cells.
- Add an independent Bold column control that combines with every text treatment.
- Preserve semantic pill colors while gently reducing their prominence in muted or faint columns.
- Open Column appearance as a hoverable, keyboard-accessible submenu beside the native menu.
- Keep column headers unchanged when applying body-cell appearance.
- Display the full author name, Gabriel Bacha, in Obsidian.

## 0.4.0 — 2026-08-13

- Add a native **Layout** toolbar control beside **Format** for Base tables.
- Expose Obsidian's Short, Medium, Tall, and Extra tall row-height settings directly in Layout.
- Add Compact, Standard, Wide, and Maximum column-width presets with **Unset only** and confirmed **All columns** scopes.
- Keep the Layout popover open while testing widths and make its toolbar button toggle the popover closed.
- Add temporary column-header indicators showing which columns match or will change with the selected width.
- Add named saved-layout presets that restore row height, column width, and width scope together.
- Add confirmed column-width reset and confirmation before every operation that overwrites all column widths.
- Add a subtle Base header tint and bold the first configured visible column.
- Persist and validate layout presets through settings schema version 3.

## 0.3.0 — 2026-08-06

- Add an intent-first pill menu with separate color and column-manager views plus native-backed removal from the current row.
- Show column search only for larger value sets and highlight the originally clicked value.
- Refine pill menus with native icons, compact swatches, clearer focus states, and confirmation before removing a value.
- Make conditional-formatting rule fields horizontally scrollable in narrow manager windows.
- Match the Base toolbar with a transparent, compact palette + Format control.
- Add a unified Bases Visuals modal with Pill colors and Conditional formatting tabs.
- Reuse the searchable, property-grouped pill color manager in both the modal and settings.

## 0.2.2

- Match the native two-level Base toolbar item structure.
- Remove the oversized filled appearance from the Conditional formatting action.

## 0.2.1

- Fix the Conditional formatting toolbar button in native Base file views.
- Match Obsidian's current sibling `.bases-header` and `.bases-view` structure.

## 0.2.0

Initial public release.

- Add deterministic Notion-inspired colors for list-property pills.
- Add preset, custom, automatic, and disabled color states.
- Add conditional formatting for matching cells and entire rows.
- Add a native-style Conditional formatting action to Base table toolbars.
- Support native and embedded Base tables, virtualized rows, and pop-out windows.
- Preserve Obsidian's native list editor without modifying notes or Base definitions.
