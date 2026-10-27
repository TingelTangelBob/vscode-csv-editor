# User guide

## Open and save

Open a `.csv` or `.tsv` file in VS Code. The first record becomes the column names. Comma, semicolon, tab, and pipe delimiters are detected automatically. Normal saves preserve the chosen delimiter, BOM, and line endings.

Use **Ctrl+S / Cmd+S** to save and VS Code's normal Undo command to undo edits. **Open as Text** in the editor title bar returns to the source. Turn off **Open CSV/TSV in table by default** in settings if you prefer to choose the editor yourself.

## Sort, filter, and find

Hover over a heading, then click its top arrow to sort ascending or its bottom arrow to sort descending. Only the small arrow areas sort; clicking the title selects the column. The filter icon and column grip appear on the right. Filters combine a case-insensitive text search with checked exact values; multiple column filters work together. Other active filters determine the available choices. **Show more values** expands long lists; searching covers the full list.

Filter changes apply immediately. Escape closes the popup and keeps your filter. Use **Clear filter**, or clear all filters and sorting from settings. **Ctrl+F / Cmd+F** uses VS Code's Find across table rows.

## Select, edit, and move

- Drag across cells to select a range, row numbers to select rows, or headings to select columns.
- Hold **Ctrl / Cmd** when selecting row or column headings to add or remove them.
- Copy with **Ctrl+C / Cmd+C**; Escape clears the selection. Context menus also copy rows or columns.
- Edit with a double-click, Enter, or F2. Use the column grip or its context menu to reorder columns; the grip also supports arrow keys.
- Use the toolbar or context menus to insert or delete rows and columns. **Replace values** replaces case-sensitive text in the whole table or selected columns and leaves headings unchanged.

## Column widths and appearance

Drag a column's right edge to resize it. Double-click that edge to restore automatic sizing, or use **Reset column widths** in settings. Large tables measure up to 2,048 rows spread across the file. Truncated values remain intact; hover to read them or widen the column.

**Fit columns to available width** distributes spare editor space. Settings also offer gridlines, theme-based column colors, ten languages, and System / Light / Dark appearance. Preferences persist across files and sessions; display colors are not written into CSV data.

Enable **Remember view for this file** in settings to save its manual column widths, filters (including selected values and search text), and sorting locally in VS Code. They return when you reopen the same file, including in another workspace. Settings are matched by unique column name, so renamed, missing, or duplicate names are skipped safely. Moving or renaming the file creates a separate view. Unsaved files need a path before this option is available. Column order is part of the CSV document itself and is saved with the file.

Turn the option off to remove the saved view while keeping the current on-screen view. **Reset saved view** removes it, turns the option off, and clears the current widths, filters, and sorting. Neither operation changes the CSV contents.

## Import and export

Paste into an empty file to create a table. For an existing table, the import preview lets you append or replace rows, select the delimiter, choose whether headings are present, skip empty rows, and remove exact duplicate rows.

When appending with headings, columns match by name regardless of order, surrounding whitespace, or letter case. Invalid quotes, inconsistent row widths, and missing, unknown, or ambiguous headings block the import. The information icon explains problems. Imports apply to the complete table and clear filters and sorting.

The toolbar export menu saves every matching row in the current sort and column order, including rows outside the viewport. The current cell selection does not limit the export. CSV preserves the configured delimiter, BOM, and line endings. PDF uses searchable text, embedded fonts, wrapped cells, repeated headings, and A4 pagination. Unsupported characters produce an error; exceptionally long PDF headings are shortened after eight lines. All data processing and exports work offline.
