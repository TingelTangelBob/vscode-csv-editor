# CSV Simple Editor

View and edit CSV and TSV files as tables in Visual Studio Code. CSV Simple Editor detects delimiters, keeps your data in the same editor tab, and makes sorting, filtering, editing, and importing rows quick.

![CSV Simple Editor showing a table and toolbar](https://raw.githubusercontent.com/TingelTangelBob/vscode-csv-editor/main/media/marketplace-screenshot.png)

![CSV Simple Editor settings with CSV options, tools, language, and appearance controls](https://raw.githubusercontent.com/TingelTangelBob/vscode-csv-editor/main/media/settings-screenshot.png)

## Features

- Automatically detects commas, semicolons, tabs, and pipes, and preserves the delimiter when saving.
- Opens CSV and TSV files in a table in the same editor tab.
- Sizes columns to their contents; drag a column edge to resize it, or double-click the edge to restore automatic sizing.
- Sorts columns from the header or context menu; filter each column from its header icon.
- Selects a column from its context menu and highlights it in the table.
- Keeps original row numbers visible when the table is sorted.
- Uses VS Code's native Find (`Ctrl+F` / `Cmd+F`) across table rows.
- Edits cells with a double-click, `Enter`, or `F2`; `Tab` moves to the next cell.
- Moves between cells with the arrow keys; `Home` and `End` jump to the first and last cell in a row.
- Copies individual cells or rows as tab-separated values; copy a row or the visible column as a newline-separated list from its heading.
- Optionally colorizes columns with colors from the active VS Code theme. CSV files do not store cell colors.
- Optionally shows subtle gridlines between table rows and columns.
- Lets you choose whether CSV and TSV files open in the table by default from the table settings or VS Code's extension settings.
- Adds rows and columns; the column menu can insert before or after selected columns or append at the end. Deletes selected rows or individual columns.
- Replaces exact cell values across the table or selected columns from the toolbar menu.
- Offers ten interface languages and System, Light, or Dark appearance settings.
- Syncs edits with the regular VS Code document. Save with `Ctrl+S` / `Cmd+S`.
- Changes the delimiter and clears filters or sorting from the Tools menu. CSV options, language, and appearance are grouped in settings.
- Shows import validation details on demand, with distinct subtle colors for warnings and errors.

## Usage

Responsive columns are enabled by default. Automatically sized columns use available editor space and shrink only until every value and header still fits; narrower views scroll horizontally. Disable Fit columns to available width in settings to keep natural content widths. Manual widths are preserved; use Reset column widths to return to automatic sizing. The Appearance setting follows the VS Code theme by default, or lets you choose Light or Dark independently. These preferences are shared across files and sessions.

Automatic column widths fit the header, filter control, and the widest cell value using the actual display font. Drag a column's right header edge to resize it independently, down to 40px. Headers and values that no longer fit end in an ellipsis; their full contents remain intact. Manual widths persist across edits and view reloads. Double-click the header edge to restore automatic sizing for that column, or use Reset column widths in settings to reset them all.

Column filters list the distinct values with checkboxes and occurrence counts, including blank cells. Search narrows the list and applies a case-insensitive contains condition; the checked values further restrict the result by exact value. Search and selection changes apply immediately, and Escape or clicking outside closes the filter without undoing them. Other active column filters determine the available values. Long lists load in batches via Show more values, and search covers the entire list. Use Clear filter to reset a column, or Clear filters in Table settings to reset every column.

Use the Replace values toolbar menu to choose the whole table or selected columns, then replace an exact cell value. Matching is case-sensitive, and column headers are left unchanged. The operation updates the CSV document as one edit, which can be undone with VS Code's Undo command.

Paste CSV or tab-separated data into an empty file with `Ctrl+V` / `Cmd+V` to create a table immediately (the first row becomes the column names). The clipboard toolbar button also reads the clipboard. With an existing table, a preview lets you append rows or replace the table, select a delimiter, import with or without column names, skip empty rows, and remove exact duplicate rows across the resulting table.

When appending with column names, columns are matched by name, ignoring surrounding whitespace and letter case, so reordered columns are placed correctly. Missing, unknown, empty or duplicate column names, inconsistent record widths, and malformed quoted fields block the import until corrected. Validation details appear on the information icon when you hover or focus it; warnings use a subtle yellow state and errors a subtle red state. The preview shows the first five incoming rows and the resulting row count. Imports include all rows, regardless of active filters; importing clears sorting and filters. Undo the import with VS Code's normal Undo command.

Open a `.csv` or `.tsv` file to start in table view. Click a column heading to sort; click its filter icon to filter. Right-click a cell or heading for more actions. Use the editor title action to switch back to the text view.

The table follows the active VS Code color theme and keeps the toolbar compact. Settings group tools, CSV options, file handling, and interface preferences. The toolbar provides quick access to value replacement. The project section links to change requests and shows the installed extension version.

## Development

The extension has no runtime dependencies. Run `npm test` for the CSV and extension regression tests, and `npm run package` on Windows to build the VSIX. The editable logo is in `media/csv-simple-editor-favicon.svg`; `media/extension-icon.png` is the raster version used by the Marketplace.
