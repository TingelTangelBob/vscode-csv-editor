# Changelog

## 1.4.4

- Close the add-column dialog when clicking outside it and bring the sort arrows closer to the column header edges.

## 1.4.3

- Hide import validation messages until data is pasted. Show import errors and warnings in a hoverable information icon with neutral, warning, and error states.
- Hide scrollbar arrow buttons and place sort indicators at the top and bottom edge of each column header.
- Refresh the Marketplace description and import documentation.

## 1.4.2

- Refine selected and hover colors, add an icon-based appearance switch, inset the row and column count, and use Codicon small up/down arrows for sorting.
- Show the custom editor as "CSV Simple Editor" in VS Code.
- Put the column filter count and its clear, cancel, and apply icon buttons in one compact row.

## 1.4.1

- Open the tools and settings menus without automatically focusing a dropdown. Tab still enters the menu controls, and Escape restores focus to the toolbar button.
- Size both menus and their dropdowns to their contents rather than fixed pixel widths, while keeping menus within narrow viewports.

## 1.4.0

- Fix row hover colors in dark mode, replace the appearance selector with a full-width icon switch, inset the row and column count, and refine the sort arrows.
- Remove inherited webview padding so the table uses the full editor surface.
- Keep row and column counts readable by using CSS toolbar alignment instead of calculated margins. Move the status onto its own line in very narrow views.
- Add a persistent responsive column setting, enabled by default: automatic columns fill available space, shrink only to their measured content widths, then scroll horizontally. Manual widths remain explicit user choices.
- Add persistent VS Code theme, Light, and Dark appearance settings, including menus, dialogs, inputs, gridlines and selection controls.

## 1.3.4

- Reserve separate header areas for sorting and filtering so their controls remain distinct even in narrow columns.
- Refined sort arrows with smaller rounded heads, finer outlines, and shorter stems.
- Automatically size columns to measured header and cell text widths, including filter space, padding, and gridlines. Inspect every row, including values beyond the first 1,000 rows, and avoid clipping long automatic widths.
- Keep manual sizing independent, remove the 640px width cap, and preserve the current width when clicking a resize edge without moving it.

## 1.3.3

- Refined sort arrows with narrower heads and finer outlines while preserving their filled active state.
- Hide filter icons during column resizing and match the full-height resize boundary to the table gridline color.
- Use the native Codicon clipboard symbol for the Paste table toolbar action.

## 1.3.2

- Use explicit table and column widths so dragging resizes only the chosen column, including below the width of its content. Truncated headers and values show an ellipsis without changing the data.
- Update widths continuously during dragging, retain pointer capture, and allow widths down to 40px. Preserve manual widths across edits, sorting, filtering, and view reloads.
- Fixed the column selection menu overwriting its icon instead of its label, which caused overlapping text. Select/deselect labels now remain correct when changing the interface language.

## 1.3.1

- Added Excel-style column filter lists with distinct values, checkboxes, occurrence counts, a blank-cell entry, and select-all controls.
- Search values, combine selections across columns, and apply or cancel changes. Available values respect the other active column filters.
- Load long value lists in batches without limiting which values can be selected or searched.
- Context-menu filtering now matches the exact cell value and also supports blank cells.

## 1.3.0

- Paste CSV or TSV into an empty document with Ctrl+V, or use the new Paste table toolbar action.
- Preview imports into existing tables before replacing the table or appending rows. Choose the delimiter, header handling, empty-row skipping, and optional duplicate-row removal.
- Match reordered columns by name and block imports with missing, unknown, duplicate or empty column names, inconsistent row widths, or malformed quotes.
- Keep column widths and header text space unchanged on hover. Place outlined/filled sort arrows above and below the label and overlay the filter in the top-right corner.
- Refined the add-row and add-column toolbar icons with smaller plus signs and theme-aware blue highlights.

## 1.2.9

- Replaced custom toolbar and sort-direction drawings with the VS Code Codicon font for sharper, consistent icons.
- Limited the toolbar divider to the visible table width so it no longer sticks out into empty editor space.
- Matched menu and context-menu actions to the same Codicon style and saved language and table display preferences across files and sessions.
- Avoided reloading already open views and removed the extra initial table render while preferences load.
- Virtualized large tables so opening and scrolling only builds nearby rows, and bounded automatic width sampling for faster initial layout.
- Reused the parsed row array for the initial unfiltered view and skipped the empty selection scan on open.
- Parse large CSV and TSV files in a reusable web worker while keeping small files on the fast synchronous path.
- Refined header sorting and filtering with Codicons, overlay filter buttons, and visible row/column counts.
- Extended the table to the full available width, moved project support into table settings, and shortened the default table-editor option.

## 1.2.8

- Aligned the toolbar actions with the table edge when the table is narrower than the editor.
- Repositioned the ascending and descending controls as clear, stacked SVG arrows in each column header.
- Kept sorting separate from column selection so sorting no longer highlights the entire column.
- Refreshed the Marketplace screenshot without a preselected column.

## 1.2.7

- Removed the filename header and side padding, and made the toolbar and column headings more compact.
- Added separate ascending and descending sort controls, visible on hover or while sorting.
- Redrew the toolbar icons on a crisp 16px grid and aligned menu icons and labels consistently.
- Added English, German, and French interface languages and removed explanatory subtitles from table settings.
- Fixed missing hidden status markup that could stop the table from rendering, and made the default-editor setting apply before it is confirmed in the UI.

## 1.2.6

- Renamed the table editor to "CSV Table" so VS Code shows a distinct name from the extension.
- Simplified the editor toolbar icon to a clear "CSV" label for small sizes.
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
