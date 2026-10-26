Bundled PDF export assets

pdf-lib 1.17.1 (MIT): PDF-LIB-LICENSE.txt
@pdf-lib/fontkit 1.1.1 (MIT): FONTKIT-LICENSE.txt and FONTKIT-UPSTREAM-README.txt
Noto Sans Regular (SIL Open Font License): NOTO-LICENSE.txt
Droid Sans Fallback from Android 14 (Apache License 2.0): DROID-NOTICE.txt

Exact download locations, sizes and SHA-256 checksums are in sources.json.
Fonts are stored as .ttf.gz and decompressed on demand using built-in gzip
support. Checksums refer to the original, decompressed upstream bytes.
The libraries load only on the first PDF export. The fallback font loads only
when a character is missing from Noto Sans. Noto Sans embeds only used glyphs;
the fallback font embeds intact for compatibility with CJK/Korean readers.
All export resources are local; user data is never uploaded.
