# Changelog

## 1.2.6

- Simplified the icon to a bold table symbol on a subtle sage green gradient, with an editable SVG source and clear shapes at small sizes.
- Moved the logo into a discreet "Buy me a coffee" row in the tools menu that opens the project on GitHub.
- Refined the toolbar, table headers, row shading, menus, and light, dark, and high contrast styling.
- Added arrow-key navigation between cells and a partial-selection state for the select-all checkbox.
- Made column filter buttons accessible from the keyboard.
- Preserved clicks on cells and headers when leaving a cell edit, and improved keyboard focus in popovers.
- Preserved quoted empty records, empty single-column rows, and record line endings when cells contain multiline text.
- Kept workspace editor associations out of user settings when changing the default CSV editor.
- Added dependency-free CSV and extension regression tests.

## 1.2.5

- Added a setting to choose whether CSV and TSV files open in the table or the standard text editor by default.

## 1.2.4

- Added an optional table gridlines setting.
- Aligned the select-all checkbox, sort indicator, and filter button within the column header row.

## 1.2.3

- Added adjustable column widths with saved overrides and a reset action.
- Added optional theme-based column colors in table settings.
- Added column selection and copy-as-list actions for row and column headings.

## 1.2.2

- Updated the editor interface, Marketplace description, and documentation to English.
- Added a Marketplace screenshot to the extension page.

## 1.2.1

- Prepared filter queries once per input and rebuilt the table after a short pause.
- Recalculated only affected column widths after cell or header edits.
- Avoided a full column-width recalculation when adding an empty row.

## 1.2.0

- Simplified the interface and sized the table to its contents.
- Moved row and column counts to the left of the compact toolbar.
- Added sorting and filtering from column headers and context menus.
- Added cell and row copy actions.
- Kept original row numbers visible when sorting.
- Added switching between table and text views in the same editor tab.
- Added a CSV icon for the table view.
