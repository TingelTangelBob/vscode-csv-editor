# CSV Simple Editor

**A CSV and TSV table editor for Visual Studio Code.** View, edit, sort, and filter your data in a spreadsheet-style grid, then export CSV or searchable PDF. Your data stays local; editing and exports work offline.

[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=tingeltangelbob.csv-simple-editor) · [Download VSIX](https://github.com/TingelTangelBob/vscode-csv-editor/releases/latest) · [Report an issue](https://github.com/TingelTangelBob/vscode-csv-editor/issues)

## See it in action

**Light**

![CSV and TSV table editor in VS Code: light theme with sortable columns](media/marketplace-light.png)

**Dark**

![CSV Simple Editor in VS Code: dark theme with the same table](media/marketplace-dark.png)

## What you can do

- **Open CSV or TSV:** automatically detect commas, semicolons, tabs, and pipes.
- **Edit your table:** change cells, add or delete rows and columns, and move columns.
- **Find and clean data:** sort columns, combine value filters, search, and replace text.
- **Select and copy:** drag across cells, row numbers, or column headings; copy to a spreadsheet.
- **Import clipboard data:** preview before appending or replacing rows; validate columns and remove exact duplicates.
- **Export CSV or PDF:** save the filtered and sorted result, including rows outside the viewport. PDF text stays selectable and searchable.
- **Make it yours:** resize columns, toggle gridlines and column colors, and choose light, dark, or your VS Code theme. Ten interface languages are included.
- **Remember a file's view:** optionally restore its column widths, filters, and sorting when you reopen it.
- **Browse large files:** background parsing and visible-row rendering keep the table responsive; automatic widths use a sample of larger tables.

## Get started

1. Install **CSV Simple Editor** and open a `.csv` or `.tsv` file. The first row supplies the column names.
2. Double-click a cell to edit. Hover over a heading and use its top or bottom arrow to sort; the filter and column grip appear on the right.
3. Save with **Ctrl+S** / **Cmd+S**. Use the toolbar to paste data, replace text, export, or change settings.

To choose the editor manually, right-click the file tab → **Reopen Editor With…** → **CSV Simple Editor**. Use **Open as Text** in the editor title bar to return to the source.

| Action | Shortcut |
| --- | --- |
| Edit cell | `Enter`, `F2`, or double-click |
| Navigate | Arrow keys; `Tab` for the next cell |
| Find | `Ctrl+F` / `Cmd+F` |
| Copy selection | `Ctrl+C` / `Cmd+C` |
| Clear selection | `Escape` |

## Help and feedback

[User guide](docs/GUIDE.md) · [Troubleshooting](SUPPORT.md) · [Changelog](CHANGELOG.md) · [Development](docs/DEVELOPMENT.md)

Have an idea or found a bug? [Open an issue](https://github.com/TingelTangelBob/vscode-csv-editor/issues/new/choose). If the editor helps you, a Marketplace review or GitHub star helps other users find it.
