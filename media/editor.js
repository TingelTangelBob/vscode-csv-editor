'use strict';

const vscode = acquireVsCodeApi();
const { createEmptySheet, parseCsv, escapeCell, serializeCsv, planCsvImport,
  isColumnFilterActive, filterRows, getColumnFilterValues } = CsvData;
const csvWorkerSourceUri = document.currentScript?.dataset.csvWorkerSrc;
const WORKER_PARSE_THRESHOLD = 256 * 1024;
let csvWorkerPromise = null;
let csvWorker = null;
let nextParseRequestId = 1;
const pendingParseRequests = new Map();
let collator = new Intl.Collator(navigator.language, { numeric: true, sensitivity: 'base' });
const TRANSLATIONS = {
  en: {},
  de: {
    'Import information':'Importinformationen',
    'Fit columns to available width':'Spalten an Fensterbreite anpassen',
    'Appearance':'Darstellung','VS Code theme':'VS-Code-Design','Light':'Hell','Dark':'Dunkel',
    'General':'Allgemein','Display':'Darstellung','File handling':'Dateiverhalten','Tools':'Werkzeuge','Project':'Projekt',
    'Suggest a change':'Änderungswunsch vorschlagen',
    'Search values…':'Werte suchen …','Select all matches':'Alle Suchtreffer auswählen',
    'Select all values':'Alle Werte auswählen','(Blanks)':'(Leere)',
    'No matching values':'Keine passenden Werte','Show more values':'Weitere Werte anzeigen',
    'Values selected':'Werte ausgewählt','Column values':'Spaltenwerte',
    'Paste table':'Tabelle einfügen','CSV or tab-separated data':'CSV- oder tabulatorgetrennte Daten',
    'Insert mode':'Einfügeart','Append rows':'Daten unten anfügen','Replace table':'Tabelle ersetzen',
    'Detect automatically':'Automatisch erkennen','First row contains column names':'Erste Zeile enthält Spaltennamen',
    'Remove duplicate rows from the resulting table':'Doppelte Zeilen aus der resultierenden Tabelle entfernen',
    'Skip empty rows':'Leere Zeilen überspringen','Preview: first 5 incoming rows':'Vorschau: erste 5 einzufügende Zeilen',
    'All existing rows and column names will be replaced.':'Alle vorhandenen Zeilen und Spaltennamen werden ersetzt.',
    'Incoming rows':'Einzufügende Zeilen','Result rows':'Ergebniszeilen','Duplicate rows':'Doppelte Zeilen',
    'Empty rows skipped':'Übersprungene Leerzeilen','Record':'Datensatz','Further issues':'Weitere Probleme',
    'Invalid quotes':'Ungültige Anführungszeichen','Unclosed quoted field':'Nicht geschlossenes Anführungszeichen',
    'No data to import':'Keine Daten zum Einfügen','Empty column names':'Leere Spaltennamen',
    'Duplicate column names':'Doppelte Spaltennamen','Wrong number of columns':'Falsche Spaltenanzahl (vorhanden / erwartet)',
    'Ambiguous target column names':'Vorhandene Spaltennamen sind nicht eindeutig',
    'Missing columns':'Fehlende Spalten','Unknown columns':'Unbekannte Spalten',
    'Columns reordered by name':'Vertauschte Spalten werden anhand ihrer Namen zugeordnet',
    'Columns matched by position':'Spalten werden anhand ihrer Position zugeordnet',
    'Add row':'Zeile hinzufügen','Add column':'Spalte hinzufügen','Delete selected rows':'Ausgewählte Zeilen löschen',
    'Table settings':'Tabelleneinstellungen','More tools':'Weitere Optionen','Delimiter':'Trennzeichen','CSV delimiter':'CSV-Trennzeichen',
    'Comma ,':'Komma ,','Semicolon ;':'Semikolon ;','Tab':'Tabulator','Pipe |':'Pipe |','Clear filters':'Filter zurücksetzen',
    'Clear sorting':'Sortierung zurücksetzen','Open as text':'Als Text öffnen','Buy me a coffee':'Unterstütze das Projekt',
    'Language':'Sprache','Colorize columns':'Spaltenfarben anzeigen','Show table gridlines':'Tabellenlinien anzeigen',
    'Open CSVs as tables':'CSV als Tabelle öffnen','Reset column widths':'Spaltenbreiten zurücksetzen',
    'Filter column':'Spalte filtern','Contains…':'Enthält …','Clear filter':'Filter löschen','Copy cell':'Zelle kopieren',
    'Copy row':'Zeile kopieren','Copy row as list':'Zeile als Liste kopieren','Open column filter':'Spaltenfilter öffnen',
    'Filter by this value':'Nach diesem Wert filtern','Sort ascending':'Aufsteigend sortieren','Sort descending':'Absteigend sortieren',
    'Select column':'Spalte auswählen','Deselect column':'Spalte abwählen','Fit column to contents':'Spaltenbreite an Inhalt anpassen','Copy visible column as list (with header)':'Sichtbare Spalte samt Kopfzeile kopieren',
    'Rename column':'Spalte umbenennen','Delete column':'Spalte löschen','Add column':'Spalte hinzufügen','Column name':'Spaltenname',
    'e.g. Product ID':'z. B. Produktnummer','Apply':'Übernehmen','Cancel':'Abbrechen',
    'Confirm deletion':'Löschen bestätigen','Delete':'Löschen','No data rows yet. Add a row to get started.':'Noch keine Datenzeilen. Füge eine Zeile hinzu, um zu beginnen.',
    'No matching rows. Clear or adjust your column filters.':'Keine passenden Zeilen. Setze die Spaltenfilter zurück oder passe sie an.',
    'Select all visible rows':'Alle sichtbaren Zeilen auswählen','Drag to resize column':'Ziehen, um die Spalte zu verbreitern',
    'Double-click to edit':'Doppelklicken zum Bearbeiten','Edit filter':'Filter bearbeiten','Sort by':'Sortieren nach',
    'Resize':'Breite ändern','row':'Zeile','rows':'Zeilen','column':'Spalte','columns':'Spalten','of':'von','filter':'Filter','filters':'Filter',
    'Column':'Spalte','Select row':'Zeile auswählen','Original row number':'Ursprüngliche Zeilennummer',
  },
  fr: {
    'Import information':'Informations sur l’importation',
    'Fit columns to available width':'Adapter les colonnes à la largeur disponible',
    'Appearance':'Apparence','VS Code theme':'Thème VS Code','Light':'Clair','Dark':'Sombre',
    'General':'Général','Display':'Affichage','File handling':'Gestion des fichiers','Tools':'Outils','Project':'Projet',
    'Suggest a change':'Suggérer une modification',
    'Search values…':'Rechercher des valeurs…','Select all matches':'Sélectionner tous les résultats',
    'Select all values':'Sélectionner toutes les valeurs','(Blanks)':'(Vides)',
    'No matching values':'Aucune valeur correspondante','Show more values':'Afficher plus de valeurs',
    'Values selected':'Valeurs sélectionnées','Column values':'Valeurs de la colonne',
    'Paste table':'Coller un tableau','CSV or tab-separated data':'Données CSV ou séparées par tabulations',
    'Insert mode':'Mode d’insertion','Append rows':'Ajouter les lignes à la fin','Replace table':'Remplacer le tableau',
    'Detect automatically':'Détecter automatiquement','First row contains column names':'La première ligne contient les noms de colonnes',
    'Remove duplicate rows from the resulting table':'Supprimer les lignes en double du tableau résultant',
    'Skip empty rows':'Ignorer les lignes vides','Preview: first 5 incoming rows':'Aperçu : 5 premières lignes à insérer',
    'All existing rows and column names will be replaced.':'Toutes les lignes et tous les noms de colonnes existants seront remplacés.',
    'Incoming rows':'Lignes à insérer','Result rows':'Lignes résultantes','Duplicate rows':'Lignes en double',
    'Empty rows skipped':'Lignes vides ignorées','Record':'Enregistrement','Further issues':'Autres problèmes',
    'Invalid quotes':'Guillemets invalides','Unclosed quoted field':'Champ entre guillemets non fermé',
    'No data to import':'Aucune donnée à insérer','Empty column names':'Noms de colonnes vides',
    'Duplicate column names':'Noms de colonnes en double','Wrong number of columns':'Nombre de colonnes incorrect (reçu / attendu)',
    'Ambiguous target column names':'Noms de colonnes existants ambigus',
    'Missing columns':'Colonnes manquantes','Unknown columns':'Colonnes inconnues',
    'Columns reordered by name':'Colonnes réordonnées selon leur nom',
    'Columns matched by position':'Colonnes associées selon leur position',
    'Add row':'Ajouter une ligne','Add column':'Ajouter une colonne','Delete selected rows':'Supprimer les lignes sélectionnées',
    'Table settings':'Paramètres du tableau','More tools':'Plus d’outils','Delimiter':'Séparateur','CSV delimiter':'Séparateur CSV',
    'Comma ,':'Virgule ,','Semicolon ;':'Point-virgule ;','Tab':'Tabulation','Pipe |':'Barre verticale |','Clear filters':'Effacer les filtres',
    'Clear sorting':'Effacer le tri','Open as text':'Ouvrir en texte','Buy me a coffee':'Soutenir le projet',
    'Language':'Langue','Colorize columns':'Colorer les colonnes','Show table gridlines':'Afficher le quadrillage',
    'Open CSVs as tables':'Ouvrir les CSV en tableau','Reset column widths':'Réinitialiser la largeur des colonnes',
    'Filter column':'Filtrer la colonne','Contains…':'Contient…','Clear filter':'Effacer le filtre','Copy cell':'Copier la cellule',
    'Copy row':'Copier la ligne','Copy row as list':'Copier la ligne sous forme de liste','Open column filter':'Ouvrir le filtre de colonne',
    'Filter by this value':'Filtrer par cette valeur','Sort ascending':'Trier par ordre croissant','Sort descending':'Trier par ordre décroissant',
    'Select column':'Sélectionner la colonne','Deselect column':'Désélectionner la colonne','Copy visible column as list (with header)':'Copier la colonne visible avec son en-tête',
    'Rename column':'Renommer la colonne','Delete column':'Supprimer la colonne','Column name':'Nom de la colonne',
    'e.g. Product ID':'p. ex. ID produit','Apply':'Appliquer','Cancel':'Annuler','Confirm deletion':'Confirmer la suppression',
    'Delete':'Supprimer','No data rows yet. Add a row to get started.':'Aucune ligne pour le moment. Ajoutez une ligne pour commencer.',
    'No matching rows. Clear or adjust your column filters.':'Aucun résultat. Effacez ou ajustez vos filtres.',
    'Select all visible rows':'Sélectionner toutes les lignes visibles','Drag to resize column':'Faites glisser pour redimensionner la colonne',
    'Double-click to edit':'Double-cliquez pour modifier','Edit filter':'Modifier le filtre','Sort by':'Trier par',
    'Resize':'Redimensionner','row':'ligne','rows':'lignes','column':'colonne','columns':'colonnes','of':'sur','filter':'filtre','filters':'filtres',
    'Column':'Colonne','Select row':'Sélectionner la ligne','Original row number':'Numéro de ligne d’origine',
  },
};
Object.assign(TRANSLATIONS.de, {
  'Drag to move column': 'Spalte durch Ziehen verschieben (Pfeiltasten: links/rechts)',
  'Move column left': 'Spalte nach links verschieben',
  'Move column right': 'Spalte nach rechts verschieben',
  'Export visible rows as CSV': 'Sichtbare Zeilen als CSV exportieren',
  'Export visible rows as PDF': 'Sichtbare Zeilen als PDF exportieren',
  'Export visible rows': 'Sichtbare Zeilen exportieren',
  'Exporting…': 'Export wird erstellt…',
  'General': 'Allgemein', 'Display': 'Darstellung', 'File handling': 'Dateiverhalten', 'Tools': 'Werkzeuge', 'Project': 'Projekt',
  'Suggest a change': '\u00c4nderungswunsch vorschlagen', 'Replace values': 'Werte ersetzen',
  'Find text': 'Text suchen', 'Replace with': 'Ersetzen durch', 'Scope': 'Bereich',
  'Whole table': 'Ganze Tabelle', 'Selected columns': 'Ausgew\u00e4hlte Spalten', 'Select columns': 'Spalten ausw\u00e4hlen',
  'Find text inside cell values, including letter case. Column headers are not changed.': 'Der Suchtext wird innerhalb des Zellinhalts gesucht. Gro\u00df-/Kleinschreibung wird beachtet; Spaltennamen bleiben unver\u00e4ndert.',
  'Replacement is the same as the search value.': 'Der Ersatzwert entspricht dem Suchwert.',
  'matching cells': 'passende Zellen', 'matching cell': 'passende Zelle', 'Replace': 'Ersetzen',
});
Object.assign(TRANSLATIONS.fr, {
  'General': 'G\u00e9n\u00e9ral', 'Display': 'Affichage', 'File handling': 'Gestion des fichiers', 'Tools': 'Outils', 'Project': 'Projet',
  'Suggest a change': 'Sugg\u00e9rer une modification', 'Replace values': 'Remplacer les valeurs',
  'Find text': 'Rechercher du texte', 'Replace with': 'Remplacer par', 'Scope': 'Port\u00e9e',
  'Whole table': 'Tout le tableau', 'Selected columns': 'Colonnes s\u00e9lectionn\u00e9es', 'Select columns': 'S\u00e9lectionner les colonnes',
  'Find text inside cell values, including letter case. Column headers are not changed.': 'Le texte est recherch\u00e9 dans le contenu des cellules, en respectant la casse. Les en-t\u00eates ne sont pas modifi\u00e9s.',
  'Replacement is the same as the search value.': 'La valeur de remplacement est identique \u00e0 la valeur recherch\u00e9e.',
  'matching cells': 'cellules correspondantes', 'matching cell': 'cellule correspondante', 'Replace': 'Remplacer',
});
Object.assign(TRANSLATIONS.de, { Interface: 'Oberfl\u00e4che', 'CSV settings': 'CSV-Einstellungen', Appearance: 'Oberfl\u00e4che' });
Object.assign(TRANSLATIONS.fr, { Interface: 'Interface', 'CSV settings': 'Param\u00e8tres CSV' });
const COMMON_UI_TRANSLATIONS = {
  es: { 'General':'General', 'Display':'Visualización', 'File handling':'Archivos', 'Tools':'Herramientas', 'Project':'Proyecto', 'Language':'Idioma', 'Colorize columns':'Colorear columnas', 'Fit columns to available width':'Ajustar columnas al ancho disponible', 'VS Code theme':'Tema de VS Code', 'Light':'Claro', 'Dark':'Oscuro', 'Show table gridlines':'Mostrar líneas de cuadrícula', 'Open CSVs as tables':'Abrir CSV como tablas', 'Delimiter':'Delimitador', 'Clear filters':'Borrar filtros', 'Clear sorting':'Borrar ordenación', 'Open as text':'Abrir como texto', 'Replace values':'Reemplazar valores', 'Suggest a change':'Sugerir un cambio', 'Buy me a coffee':'Apoya el proyecto', 'Add row':'Añadir fila', 'Add column':'Añadir columna', 'Delete selected rows':'Eliminar filas seleccionadas', 'Paste table':'Pegar tabla', 'Reset column widths':'Restablecer anchos de columna' },
  ja: { 'General':'一般', 'Display':'表示', 'File handling':'ファイル処理', 'Tools':'ツール', 'Project':'プロジェクト', 'Language':'言語', 'Colorize columns':'列に色を付ける', 'Fit columns to available width':'列を表示幅に合わせる', 'VS Code theme':'VS Code テーマ', 'Light':'ライト', 'Dark':'ダーク', 'Show table gridlines':'表のグリッド線を表示', 'Open CSVs as tables':'CSV を表として開く', 'Delimiter':'区切り文字', 'Clear filters':'フィルターをクリア', 'Clear sorting':'並べ替えをクリア', 'Open as text':'テキストとして開く', 'Replace values':'値を置換', 'Suggest a change':'変更を提案', 'Buy me a coffee':'プロジェクトを支援', 'Add row':'行を追加', 'Add column':'列を追加', 'Delete selected rows':'選択した行を削除', 'Paste table':'表を貼り付け', 'Reset column widths':'列幅をリセット' },
  'zh-cn': { 'General':'常规', 'Display':'显示', 'File handling':'文件处理', 'Tools':'工具', 'Project':'项目', 'Language':'语言', 'Colorize columns':'为列着色', 'Fit columns to available width':'列适应可用宽度', 'VS Code theme':'VS Code 主题', 'Light':'浅色', 'Dark':'深色', 'Show table gridlines':'显示表格网格线', 'Open CSVs as tables':'将 CSV 作为表格打开', 'Delimiter':'分隔符', 'Clear filters':'清除筛选', 'Clear sorting':'清除排序', 'Open as text':'作为文本打开', 'Replace values':'替换值', 'Suggest a change':'提出更改建议', 'Buy me a coffee':'支持此项目', 'Add row':'添加行', 'Add column':'添加列', 'Delete selected rows':'删除所选行', 'Paste table':'粘贴表格', 'Reset column widths':'重置列宽' },
  'pt-br': { 'General':'Geral', 'Display':'Exibição', 'File handling':'Arquivos', 'Tools':'Ferramentas', 'Project':'Projeto', 'Language':'Idioma', 'Colorize columns':'Colorir colunas', 'Fit columns to available width':'Ajustar colunas à largura disponível', 'VS Code theme':'Tema do VS Code', 'Light':'Claro', 'Dark':'Escuro', 'Show table gridlines':'Mostrar linhas da tabela', 'Open CSVs as tables':'Abrir CSVs como tabelas', 'Delimiter':'Delimitador', 'Clear filters':'Limpar filtros', 'Clear sorting':'Limpar ordenação', 'Open as text':'Abrir como texto', 'Replace values':'Substituir valores', 'Suggest a change':'Sugerir uma alteração', 'Buy me a coffee':'Apoie o projeto', 'Add row':'Adicionar linha', 'Add column':'Adicionar coluna', 'Delete selected rows':'Excluir linhas selecionadas', 'Paste table':'Colar tabela', 'Reset column widths':'Redefinir larguras das colunas' },
  ru: { 'General':'Общие', 'Display':'Отображение', 'File handling':'Файлы', 'Tools':'Инструменты', 'Project':'Проект', 'Language':'Язык', 'Colorize columns':'Раскрасить столбцы', 'Fit columns to available width':'Вписать столбцы по ширине', 'VS Code theme':'Тема VS Code', 'Light':'Светлая', 'Dark':'Тёмная', 'Show table gridlines':'Показать сетку таблицы', 'Open CSVs as tables':'Открывать CSV как таблицы', 'Delimiter':'Разделитель', 'Clear filters':'Сбросить фильтры', 'Clear sorting':'Сбросить сортировку', 'Open as text':'Открыть как текст', 'Replace values':'Заменить значения', 'Suggest a change':'Предложить изменение', 'Buy me a coffee':'Поддержать проект', 'Add row':'Добавить строку', 'Add column':'Добавить столбец', 'Delete selected rows':'Удалить выбранные строки', 'Paste table':'Вставить таблицу', 'Reset column widths':'Сбросить ширину столбцов' },
  ko: { 'General':'일반', 'Display':'표시', 'File handling':'파일 처리', 'Tools':'도구', 'Project':'프로젝트', 'Language':'언어', 'Colorize columns':'열 색상 표시', 'Fit columns to available width':'열 너비를 화면에 맞춤', 'VS Code theme':'VS Code 테마', 'Light':'라이트', 'Dark':'다크', 'Show table gridlines':'표 격자선 표시', 'Open CSVs as tables':'CSV를 표로 열기', 'Delimiter':'구분 기호', 'Clear filters':'필터 지우기', 'Clear sorting':'정렬 지우기', 'Open as text':'텍스트로 열기', 'Replace values':'값 바꾸기', 'Suggest a change':'변경 제안', 'Buy me a coffee':'프로젝트 후원', 'Add row':'행 추가', 'Add column':'열 추가', 'Delete selected rows':'선택한 행 삭제', 'Paste table':'표 붙여넣기', 'Reset column widths':'열 너비 초기화' },
  it: { 'General':'Generale', 'Display':'Visualizzazione', 'File handling':'Gestione file', 'Tools':'Strumenti', 'Project':'Progetto', 'Language':'Lingua', 'Colorize columns':'Colora colonne', 'Fit columns to available width':'Adatta colonne alla larghezza disponibile', 'VS Code theme':'Tema di VS Code', 'Light':'Chiaro', 'Dark':'Scuro', 'Show table gridlines':'Mostra griglia', 'Open CSVs as tables':'Apri CSV come tabelle', 'Delimiter':'Delimitatore', 'Clear filters':'Cancella filtri', 'Clear sorting':'Cancella ordinamento', 'Open as text':'Apri come testo', 'Replace values':'Sostituisci valori', 'Suggest a change':'Suggerisci una modifica', 'Buy me a coffee':'Sostieni il progetto', 'Add row':'Aggiungi riga', 'Add column':'Aggiungi colonna', 'Delete selected rows':'Elimina righe selezionate', 'Paste table':'Incolla tabella', 'Reset column widths':'Reimposta larghezza colonne' },
};
Object.assign(TRANSLATIONS, COMMON_UI_TRANSLATIONS);
Object.assign(TRANSLATIONS.de, {
  'Insert column before selection': 'Spalte vor Auswahl einf\u00fcgen',
  'Insert column after selection': 'Spalte nach Auswahl einf\u00fcgen',
  'Add column at end': 'Spalte am Ende hinzuf\u00fcgen',
  'Replace in whole table': 'In der ganzen Tabelle ersetzen',
  'Replace in selected columns': 'In ausgew\u00e4hlten Spalten ersetzen',
});
Object.assign(TRANSLATIONS.fr, {
  'Insert column before selection': 'Ins\u00e9rer une colonne avant la s\u00e9lection',
  'Insert column after selection': 'Ins\u00e9rer une colonne apr\u00e8s la s\u00e9lection',
  'Add column at end': 'Ajouter une colonne \u00e0 la fin',
  'Replace in whole table': 'Remplacer dans tout le tableau',
  'Replace in selected columns': 'Remplacer dans les colonnes s\u00e9lectionn\u00e9es',
});
Object.assign(TRANSLATIONS.es, {
  'Insert column before selection': 'Insertar columna antes de la selecci\u00f3n',
  'Insert column after selection': 'Insertar columna despu\u00e9s de la selecci\u00f3n',
  'Add column at end': 'A\u00f1adir columna al final',
  'Replace in whole table': 'Reemplazar en toda la tabla',
  'Replace in selected columns': 'Reemplazar en columnas seleccionadas',
});
Object.assign(TRANSLATIONS.it, {
  'Insert column before selection': 'Inserisci colonna prima della selezione',
  'Insert column after selection': 'Inserisci colonna dopo la selezione',
  'Add column at end': 'Aggiungi colonna alla fine',
  'Replace in whole table': 'Sostituisci nell’intera tabella',
  'Replace in selected columns': 'Sostituisci nelle colonne selezionate',
});
Object.assign(TRANSLATIONS['pt-br'], {
  'Insert column before selection': 'Inserir coluna antes da seleção',
  'Insert column after selection': 'Inserir coluna após a seleção',
  'Add column at end': 'Adicionar coluna ao final',
  'Replace in whole table': 'Substituir na tabela inteira',
  'Replace in selected columns': 'Substituir nas colunas selecionadas',
});
Object.assign(TRANSLATIONS.ru, {
  'Insert column before selection': 'Вставить столбец перед выбранными',
  'Insert column after selection': 'Вставить столбец после выбранных',
  'Add column at end': 'Добавить столбец в конец',
  'Replace in whole table': 'Заменить во всей таблице',
  'Replace in selected columns': 'Заменить в выбранных столбцах',
});
Object.assign(TRANSLATIONS.ko, {
  'Insert column before selection': '선택 항목 앞에 열 삽입',
  'Insert column after selection': '선택 항목 뒤에 열 삽입',
  'Add column at end': '끝에 열 추가',
  'Replace in whole table': '전체 표에서 바꾸기',
  'Replace in selected columns': '선택한 열에서 바꾸기',
});
Object.assign(TRANSLATIONS.ja, {
  'Insert column before selection': '選択範囲の前に列を挿入',
  'Insert column after selection': '選択範囲の後に列を挿入',
  'Add column at end': '末尾に列を追加',
  'Replace in whole table': '表全体で置換',
  'Replace in selected columns': '選択した列で置換',
});
Object.assign(TRANSLATIONS['zh-cn'], {
  'Insert column before selection': '在所选内容前插入列',
  'Insert column after selection': '在所选内容后插入列',
  'Add column at end': '在末尾添加列',
  'Replace in whole table': '替换整个表格中的内容',
  'Replace in selected columns': '替换所选列中的内容',
});

Object.assign(TRANSLATIONS.es, { Interface: 'Interfaz', 'CSV settings': 'Ajustes CSV' });
Object.assign(TRANSLATIONS.ja, { Interface: '\u30a4\u30f3\u30bf\u30fc\u30d5\u30a7\u30fc\u30b9', 'CSV settings': 'CSV \u8a2d\u5b9a' });
Object.assign(TRANSLATIONS['zh-cn'], { Interface: '\u754c\u9762', 'CSV settings': 'CSV \u8bbe\u7f6e' });
Object.assign(TRANSLATIONS['pt-br'], { Interface: 'Interface', 'CSV settings': 'Configura\u00e7\u00f5es de CSV' });
Object.assign(TRANSLATIONS.ru, { Interface: '\u0418\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441', 'CSV settings': '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 CSV' });
Object.assign(TRANSLATIONS.ko, { Interface: '\uc778\ud130\ud398\uc774\uc2a4', 'CSV settings': 'CSV \uc124\uc815' });
Object.assign(TRANSLATIONS.it, { Interface: 'Interfaccia', 'CSV settings': 'Impostazioni CSV' });
const LOCALES = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ja: 'ja-JP', 'zh-cn': 'zh-CN', 'pt-br': 'pt-BR', ru: 'ru-RU', ko: 'ko-KR', it: 'it-IT' };
const savedState = vscode.getState() ?? {};
const browserLanguage = navigator.language.toLowerCase();
const systemLanguage = browserLanguage.startsWith('zh') ? 'zh-cn' : browserLanguage.startsWith('pt') ? 'pt-br' : browserLanguage.slice(0, 2);
let language = savedState.language in TRANSLATIONS ? savedState.language : (systemLanguage in TRANSLATIONS ? systemLanguage : 'en');

function t(key) {
  if (key === 'Loading CSV…') return ({ en: 'Loading CSV…', de: 'CSV wird geladen…', fr: 'Chargement du CSV…' })[language];
  return TRANSLATIONS[language][key] ?? key;
}

function applyTranslations() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
    element.setAttribute('aria-label', element.title);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
}

const elements = {
  toolbar: document.querySelector('.toolbar'),
  toolbarActions: document.querySelector('.toolbar-actions'),
  table: document.getElementById('csv-table'),
  tableColumns: document.getElementById('table-columns'),
  tableHead: document.getElementById('table-head'),
  tableBody: document.getElementById('table-body'),
  tableScroll: document.getElementById('table-scroll'),
  tableStatus: document.getElementById('table-status'),
  addRow: document.getElementById('add-row'),
  addColumn: document.getElementById('add-column'),
  addColumnPopover: document.getElementById('add-column-popover'),
  toolbarColumnName: document.getElementById('toolbar-column-name'),
  deleteSelected: document.getElementById('delete-selected'),
  replaceValues: document.getElementById('replace-values'),
  replaceValuesPopover: document.getElementById('replace-values-popover'),
  toolbarReplaceFind: document.getElementById('toolbar-replace-find'),
  toolbarReplaceWith: document.getElementById('toolbar-replace-with'),
  toolbarReplaceCount: document.getElementById('toolbar-replace-count'),
  selectionCount: document.getElementById('selection-count'),
  delimiter: document.getElementById('delimiter-select'),
  settingsButton: document.getElementById('settings-button'),
  exportButton: document.getElementById('export-button'),
  exportPopover: document.getElementById('export-popover'),
  settingsPopover: document.getElementById('settings-popover'),
  colorizeColumns: document.getElementById('colorize-columns'),
  showGridlines: document.getElementById('show-gridlines'),
  responsiveColumns: document.getElementById('responsive-columns'),
  appearanceSwitcher: document.getElementById('appearance-switcher'),
  openByDefault: document.getElementById('open-by-default'),
  language: document.getElementById('language-select'),
  filterPopover: document.getElementById('filter-popover'),
  filterLabel: document.getElementById('filter-label'),
  filterInput: document.getElementById('column-filter-input'),
  filterSelectAll: document.getElementById('filter-select-all'),
  filterSelectAllLabel: document.getElementById('filter-select-all-label'),
  filterValues: document.getElementById('filter-values'),
  filterMore: document.getElementById('filter-more'),
  filterSelectionStatus: document.getElementById('filter-selection-status'),
  contextPopover: document.getElementById('context-popover'),
  contextCaption: document.getElementById('context-caption'),
  columnDialog: document.getElementById('column-dialog'),
  columnForm: document.getElementById('column-form'),
  columnTitle: document.getElementById('column-dialog-title'),
  columnName: document.getElementById('column-name'),
  confirmDialog: document.getElementById('confirm-dialog'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmAction: document.getElementById('confirm-action'),
  replaceDialog: document.getElementById('replace-dialog'),
  replaceForm: document.getElementById('replace-form'),
  replaceFind: document.getElementById('replace-find'),
  replaceWith: document.getElementById('replace-with'),
  replaceColumns: document.getElementById('replace-columns'),
  replaceCount: document.getElementById('replace-count'),
  replaceSubmit: document.getElementById('replace-submit'),
  pasteTable: document.getElementById('paste-table'),
  importDialog: document.getElementById('import-dialog'),
  importForm: document.getElementById('import-form'),
  importText: document.getElementById('import-text'),
  importMode: document.getElementById('import-mode'),
  importDelimiter: document.getElementById('import-delimiter'),
  importHeader: document.getElementById('import-header'),
  importDedupe: document.getElementById('import-dedupe'),
  importSkipEmpty: document.getElementById('import-skip-empty'),
  importSummary: document.getElementById('import-summary'),
  importFeedback: document.getElementById('import-feedback'),
  importIssues: document.getElementById('import-issues'),
  importPreview: document.getElementById('import-preview'),
  importReplaceNote: document.getElementById('import-replace-note'),
  importApply: document.getElementById('import-apply'),
};

let sheet = createEmptySheet();
let lastSerializedText = '';
let documentLoaded = false;
let isLoadingDocument = false;
let documentLoadSequence = 0;
let selectedRows = new Set();
let columnFilters = [];
let columnWidths = [];
let displayColumnWidths = [];
let columnWidthOverrides = Array.isArray(vscode.getState()?.columnWidthOverrides)
  ? vscode.getState().columnWidthOverrides
  : [];
let colorizeColumns = vscode.getState()?.colorizeColumns === true;
let showGridlines = vscode.getState()?.showGridlines === true;
let responsiveColumns = vscode.getState()?.responsiveColumns !== false;
let theme = ['system', 'light', 'dark'].includes(vscode.getState()?.theme) ? vscode.getState().theme : 'system';
let lastFilename = '';
let selectedColumn = -1;
const selectedColumns = new Set();
let lastSortClick = { column: -1, time: 0 };
let sortState = null;
let visibleRows = [];
let activeColumn = -1;
let activePopover = null;
let contextTarget = null;
let filterDraft = null;
let filterOptions = [];
let filterMatches = [];
let filterGlobalValues = new Set();
let filterShownCount = 0;
const FILTER_VALUES_PAGE_SIZE = 100;
let virtualRenderFrame = null;
let renderedRowStart = -1;
let renderedRowEnd = -1;
let resizeState = null;
let pointerIsDown = false;
let cellSelection = null;
let selectionDrag = null;
let selectionScrollFrame = null;
let suppressSelectionClick = false;
let movingColumn = -1;
let exportInProgress = false;
let pendingCellRender = false;
let popoverAnchor = null;
let clipboardRequestId = 0;
let pendingClipboardRequest = null;
let importPreviewTimer = null;
let importBackdropPointerDown = false;

const COLUMN_COLORS = [
  'var(--vscode-charts-blue, #2678c8)',
  'var(--vscode-charts-orange, #c77b18)',
  'var(--vscode-charts-green, #3b8d5a)',
  'var(--vscode-charts-purple, #8957b2)',
  'var(--vscode-charts-red, #c84949)',
  'var(--vscode-charts-yellow, #9a7c12)',
  'var(--vscode-charts-blue, #2678c8)',
  'var(--vscode-charts-foreground, #777)',
];
const VIRTUALIZE_AFTER_ROWS = 300;
const TABLE_ROW_HEIGHT = 30;
const VIRTUAL_ROW_OVERSCAN = 12;

function persistViewState() {
  vscode.setState({
    columnWidthOverrides,
    colorizeColumns,
    showGridlines,
    responsiveColumns,
    theme,
    language,
  });
}

function persistTablePreferences() {
  vscode.postMessage({
    type: 'saveTablePreferences',
    preferences: { colorizeColumns, showGridlines, responsiveColumns, theme, language },
  });
}

function updateAppearanceSwitcher() {
  elements.appearanceSwitcher.querySelectorAll('[data-theme]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  });
}

function applyTablePreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') return;
  const changed = colorizeColumns !== (preferences.colorizeColumns === true)
    || showGridlines !== (preferences.showGridlines === true)
    || responsiveColumns !== (preferences.responsiveColumns !== false)
    || theme !== (['system', 'light', 'dark'].includes(preferences.theme) ? preferences.theme : 'system')
    || (preferences.language in TRANSLATIONS && language !== preferences.language);
  colorizeColumns = preferences.colorizeColumns === true;
  showGridlines = preferences.showGridlines === true;
  responsiveColumns = preferences.responsiveColumns !== false;
  theme = ['system', 'light', 'dark'].includes(preferences.theme) ? preferences.theme : 'system';
  if (preferences.language in TRANSLATIONS) language = preferences.language;
  collator = new Intl.Collator(LOCALES[language] || LOCALES.en, { numeric: true, sensitivity: 'base' });
  elements.colorizeColumns.checked = colorizeColumns;
  elements.showGridlines.checked = showGridlines;
  elements.responsiveColumns.checked = responsiveColumns;
  document.body.dataset.theme = theme;
  updateAppearanceSwitcher();
  elements.language.value = language;
  persistViewState();
  applyTranslations();
  if (documentLoaded && changed) renderTable();
}

function columnWidthCss(column) {
  return `${displayColumnWidths[column] ?? columnWidthOverrides[column] ?? columnWidths[column] ?? 80}px`;
}

function applyColumnColor(element, column) {
  element.classList.toggle('is-colorized', colorizeColumns);
  if (colorizeColumns) element.style.setProperty('--column-color', COLUMN_COLORS[column % COLUMN_COLORS.length]);
  else element.style.removeProperty('--column-color');
}

function setDocument(rawText, filename = lastFilename) {
  stopSelectionDrag();
  elements.importDialog.close();
  pendingClipboardRequest = null;
  elements.pasteTable.disabled = false;
  documentLoaded = true;
  lastFilename = filename || lastFilename;
  const loadSequence = ++documentLoadSequence;
  const fallbackDelimiter = /\.tsv$/i.test(lastFilename) ? '\t' : ',';
  const commit = (parsedSheet) => {
    if (loadSequence !== documentLoadSequence) return;
    sheet = parsedSheet;
    isLoadingDocument = false;
    columnWidthOverrides = sheet.headers.map((_, column) => {
      const width = columnWidthOverrides[column];
      return Number.isFinite(width) && width >= 40 ? width : null;
    });
    for (const selected of selectedColumns) if (selected >= sheet.headers.length) selectedColumns.delete(selected);
    if (selectedColumn >= sheet.headers.length) selectedColumn = -1;
    elements.colorizeColumns.checked = colorizeColumns;
    elements.showGridlines.checked = showGridlines;
    lastSerializedText = rawText;
    selectedRows.clear();
    cellSelection = null;
    sortState = null;
    columnFilters = Array(sheet.headers.length).fill(null);
    recalculateColumnWidths();
    elements.delimiter.value = sheet.delimiter === '\t' ? 'tab' : sheet.delimiter;
    closePopovers();
    renderTable();
  };

  if (rawText.length < WORKER_PARSE_THRESHOLD || typeof Worker === 'undefined' || typeof fetch !== 'function' || !csvWorkerSourceUri) {
    isLoadingDocument = false;
    commit(parseCsv(rawText, fallbackDelimiter));
    return;
  }

  isLoadingDocument = true;
  sheet = createEmptySheet();
  renderTable();
  parseCsvInWorker(rawText, fallbackDelimiter)
    .then(commit)
    .catch(() => {
      if (loadSequence !== documentLoadSequence) return;
      try {
        commit(parseCsv(rawText, fallbackDelimiter));
      } catch (error) {
        isLoadingDocument = false;
        elements.tableStatus.textContent = error.message || 'Could not parse CSV';
        renderTable();
      }
    });
}

function parseCsvInWorker(rawText, fallbackDelimiter) {
  return ensureCsvWorker().then((worker) => new Promise((resolve, reject) => {
    const requestId = nextParseRequestId++;
    pendingParseRequests.set(requestId, { resolve, reject });
    try {
      worker.postMessage({ requestId, text: rawText, fallbackDelimiter });
    } catch (error) {
      pendingParseRequests.delete(requestId);
      reject(error);
    }
  }));
}

function ensureCsvWorker() {
  if (csvWorker) return Promise.resolve(csvWorker);
  if (csvWorkerPromise) return csvWorkerPromise;
  csvWorkerPromise = fetch(csvWorkerSourceUri)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load CSV parser (${response.status})`);
      return response.text();
    })
    .then((source) => {
      const workerBootstrap = `${source}\nself.addEventListener('message', (event) => {\n  const { requestId, text, fallbackDelimiter } = event.data;\n  try { self.postMessage({ requestId, sheet: globalThis.CsvData.parseCsv(text, fallbackDelimiter) }); }\n  catch (error) { self.postMessage({ requestId, error: error && error.message ? error.message : String(error) }); }\n});`;
      const blobUrl = URL.createObjectURL(new Blob([workerBootstrap], { type: 'text/javascript' }));
      try {
        csvWorker = new Worker(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      csvWorker.addEventListener('message', (event) => {
        const request = pendingParseRequests.get(event.data?.requestId);
        if (!request) return;
        pendingParseRequests.delete(event.data.requestId);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data.sheet);
      });
      csvWorker.addEventListener('error', (event) => {
        const error = new Error(event.message || 'CSV parser worker failed');
        csvWorker?.terminate();
        csvWorker = null;
        csvWorkerPromise = null;
        for (const request of pendingParseRequests.values()) request.reject(error);
        pendingParseRequests.clear();
      });
      return csvWorker;
    })
    .catch((error) => {
      csvWorkerPromise = null;
      throw error;
    });
  return csvWorkerPromise;
}

function sendEdit() {
  const text = serializeCsv(sheet);
  if (text === lastSerializedText) return;
  lastSerializedText = text;
  vscode.postMessage({ type: 'edit', text });
}

function isEmptyDocument() {
  return !lastSerializedText.replace(/^\ufeff/, '').trim() && sheet.rows.length === 0 && sheet.headers.every(name => !name.trim());
}

function importOptions() {
  return {
    mode: elements.importMode.value,
    delimiter: elements.importDelimiter.value === 'tab' ? '\t' : elements.importDelimiter.value,
    hasHeader: elements.importHeader.checked,
    dedupe: elements.importDedupe.checked,
    skipEmpty: elements.importSkipEmpty.checked,
  };
}

function updateImportPreview() {
  if (importPreviewTimer !== null) window.clearTimeout(importPreviewTimer);
  importPreviewTimer = null;
  const hasInputData = Boolean(elements.importText.value.trim());
  const plan = planCsvImport(sheet, elements.importText.value, importOptions());
  const delimiterName = { ',': 'Comma ,', ';': 'Semicolon ;', '\t': 'Tab', '|': 'Pipe |' }[plan.detectedDelimiter];
  elements.importSummary.hidden = !hasInputData;
  elements.importSummary.textContent = hasInputData
    ? `${t('Incoming rows')}: ${plan.importedCount} · ${t('Result rows')}: ${plan.rows.length} · ${t('Duplicate rows')}: ${plan.duplicates} · ${t('Empty rows skipped')}: ${plan.skipped} · ${t('Delimiter')}: ${t(delimiterName)}`
    : '';
  const issues = hasInputData ? [...plan.errors.map(issue => ({ ...issue, error: true })), ...plan.warnings] : [];
  elements.importFeedback.dataset.state = hasInputData && plan.errors.length ? 'error'
    : hasInputData && plan.warnings.length ? 'warning' : 'neutral';
  elements.importFeedback.dataset.hasIssues = String(issues.length > 0);
  elements.importIssues.hidden = issues.length === 0;
  elements.importIssues.replaceChildren(...issues.slice(0, 30).map(issue => createElement('li', issue.error ? 'import-error' : 'import-warning',
    `${t(issue.code)}${issue.record ? ` (${t('Record')} ${issue.record})` : ''}${issue.detail ? `: ${issue.detail}` : ''}`)));
  if (issues.length > 30) elements.importIssues.append(createElement('li', '', `${t('Further issues')}: ${issues.length - 30}`));
  if (!hasInputData) {
    elements.importPreview.replaceChildren();
    elements.importApply.disabled = true;
    elements.importReplaceNote.hidden = elements.importMode.value !== 'replace' || isEmptyDocument();
    return plan;
  }
  const preview = document.createElement('table');
  const head = document.createElement('thead');
  const heading = document.createElement('tr');
  plan.headers.forEach(name => heading.append(createElement('th', '', name)));
  head.append(heading);
  const body = document.createElement('tbody');
  plan.preview.forEach(cells => {
    const row = document.createElement('tr');
    cells.forEach(value => { const cell = createElement('td', '', value); cell.title = value; row.append(cell); });
    body.append(row);
  });
  preview.append(head, body);
  elements.importPreview.replaceChildren(preview);
  elements.importApply.disabled = plan.errors.length > 0 || isLoadingDocument;
  elements.importReplaceNote.hidden = elements.importMode.value !== 'replace' || isEmptyDocument();
  return plan;
}

function applyImportedTable(plan, append) {
  // Commit once so VS Code can undo the complete import in one step.
  sheet = { headers: plan.headers, rows: plan.rows, delimiter: plan.delimiter, lineEnding: plan.lineEnding,
    bom: plan.bom, trailingNewline: plan.trailingNewline };
  if (!append) columnWidthOverrides = [];
  selectedRows.clear();
  cellSelection = null;
  stopSelectionDrag();
  selectedColumn = -1;
  selectedColumns.clear();
  sortState = null;
  columnFilters = Array(sheet.headers.length).fill(null);
  elements.delimiter.value = sheet.delimiter === '\t' ? 'tab' : sheet.delimiter;
  recalculateColumnWidths();
  persistViewState();
  elements.tableScroll.scrollTop = 0;
  renderTable();
  sendEdit();
}

function pasteTable(text, allowDirect = true) {
  if (!documentLoaded || isLoadingDocument || elements.importDialog.open) return;
  closePopovers();
  const empty = isEmptyDocument();
  const plan = planCsvImport(sheet, text, { mode: 'replace' });
  if (empty && allowDirect && plan.tabular && plan.errors.length === 0) {
    applyImportedTable(plan, false);
    return;
  }
  elements.importText.value = text;
  elements.importMode.value = empty ? 'replace' : 'append';
  elements.importMode.querySelector('[value="append"]').disabled = empty;
  elements.importDelimiter.value = 'auto';
  elements.importHeader.checked = true;
  elements.importDedupe.checked = false;
  elements.importSkipEmpty.checked = true;
  updateImportPreview();
  elements.importDialog.showModal();
  window.setTimeout(() => elements.importText.focus(), 0);
}

function requestTablePaste() {
  if (!documentLoaded || isLoadingDocument || elements.importDialog.open || pendingClipboardRequest !== null) return;
  pendingClipboardRequest = ++clipboardRequestId;
  elements.pasteTable.disabled = true;
  vscode.postMessage({ type: 'readClipboard', requestId: pendingClipboardRequest });
}
elements.pasteTable.addEventListener('click', requestTablePaste);

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
  event.preventDefault();
  requestTablePaste();
});

document.addEventListener('paste', event => {
  if (event.defaultPrevented || event.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
  const text = event.clipboardData?.getData('text/plain');
  if (!text || !documentLoaded || isLoadingDocument) return;
  event.preventDefault();
  pasteTable(text);
});

elements.importForm.addEventListener('input', event => {
  if (importPreviewTimer !== null) window.clearTimeout(importPreviewTimer);
  if (event.target === elements.importText) importPreviewTimer = window.setTimeout(updateImportPreview, 150);
  else updateImportPreview();
});
elements.importForm.addEventListener('submit', event => {
  event.preventDefault();
  const plan = updateImportPreview();
  if (plan.errors.length || isLoadingDocument) return;
  applyImportedTable(plan, elements.importMode.value === 'append');
  elements.importDialog.close();
});
document.getElementById('import-cancel').addEventListener('click', () => elements.importDialog.close());
function isImportBackdrop(event) {
  if (event.target !== elements.importDialog) return false;
  const rect = elements.importDialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}
elements.importDialog.addEventListener('pointerdown', (event) => {
  importBackdropPointerDown = event.button === 0 && isImportBackdrop(event);
});
elements.importDialog.addEventListener('click', (event) => {
  if (importBackdropPointerDown && isImportBackdrop(event)) elements.importDialog.close('cancel');
  importBackdropPointerDown = false;
});
elements.importDialog.addEventListener('close', () => {
  // A queued close event may arrive after the next paste has reopened the dialog.
  if (elements.importDialog.open) return;
  if (importPreviewTimer !== null) window.clearTimeout(importPreviewTimer);
  importPreviewTimer = null;
  elements.importText.value = '';
  elements.importPreview.replaceChildren();
});

function getVisibleRows() {
  let filtered = filterRows(sheet.rows, columnFilters);

  if (sortState) {
    if (filtered === sheet.rows) filtered = filtered.slice();
    const { column, direction } = sortState;
    filtered.sort((left, right) => {
      const result = collator.compare(left.cells[column] ?? '', right.cells[column] ?? '');
      return (result * direction) || (left.id - right.id);
    });
  }
  return filtered;
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeIconButton(className, label, datasetKey, datasetValue, iconMarkup) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  if (datasetKey) button.dataset[datasetKey] = String(datasetValue);
  button.innerHTML = iconMarkup;
  return button;
}

function renderHeader() {
  const titleRow = document.createElement('tr');
  const selectHeader = createElement('th', 'row-number-head');
  const selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAll.id = 'select-visible-rows';
  selectAll.title = t('Select all visible rows');
  selectAll.setAttribute('aria-label', selectAll.title);
  selectAll.disabled = visibleRows.length === 0;
  updateSelectAll(selectAll);
  selectHeader.append(selectAll);
  titleRow.append(selectHeader);

  sheet.headers.forEach((header, column) => {
    const th = createElement('th', 'data-heading');
    th.dataset.column = String(column);
    th.classList.toggle('is-column-selected', selectedColumns.has(column));
    applyColumnColor(th, column);

    const layout = createElement('div', 'heading-content');
    const sortButton = document.createElement('button');
    sortButton.type = 'button';
    sortButton.className = 'sort-button';
    sortButton.dataset.sort = String(column);
    sortButton.title = `${t('Sort by')} ${header.trim() || `${t('Column')} ${column + 1}`}`;
    sortButton.setAttribute('aria-label', sortButton.title);
    if (sortState?.column === column) sortButton.classList.add('is-sorted');
    th.setAttribute('aria-sort', sortState?.column === column
      ? (sortState.direction > 0 ? 'ascending' : 'descending')
      : 'none');
    const name = createElement('span', '', header.trim() ? header : `${t('Column')} ${column + 1}`);
    sortButton.append(name);
    const indicators = createElement('span', 'sort-indicators');
    for (const direction of [1, -1]) {
      const directionButton = createElement('button', 'sort-direction');
      directionButton.type = 'button';
      directionButton.dataset.sort = String(column);
      directionButton.dataset.sortDirection = String(direction);
      const isActiveSortDirection = sortState?.column === column && sortState.direction === direction;
      directionButton.hidden = isActiveSortDirection;
      const arrowIcon = createElement('span', `material-arrow-icon material-arrow-small-${direction > 0 ? 'up' : 'down'}`);
      arrowIcon.setAttribute('aria-hidden', 'true');
      directionButton.append(arrowIcon);
      directionButton.title = t(direction > 0 ? 'Sort ascending' : 'Sort descending');
      directionButton.setAttribute('aria-label', directionButton.title);
      directionButton.setAttribute('aria-pressed', String(isActiveSortDirection));
      indicators.append(directionButton);
    }

    const hasColumnFilter = isColumnFilterActive(columnFilters[column]);
    const filterButton = makeIconButton(
      'header-button filter-button',
      hasColumnFilter ? t('Edit filter') : t('Filter column'),
      'filterToggle',
      column,
      `<span class="codicon codicon-${hasColumnFilter ? 'filter-filled' : 'filter'}" aria-hidden="true"></span>`,
    );
    filterButton.classList.toggle('is-active', hasColumnFilter);
    filterButton.setAttribute('aria-haspopup', 'true');
    filterButton.setAttribute('aria-expanded', String(activePopover === elements.filterPopover && activeColumn === column));

    layout.append(sortButton, indicators, filterButton);
    th.append(layout);
    const resizeHandle = createElement('span', 'column-resize-handle');
    resizeHandle.dataset.resizeColumn = String(column);
    resizeHandle.title = t('Drag to resize column');
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-orientation', 'vertical');
    resizeHandle.setAttribute('aria-label', `${t('Resize')} ${header.trim() || `${t('Column')} ${column + 1}`}`);
    resizeHandle.tabIndex = 0;
    th.append(resizeHandle);
    const moveHandle = makeIconButton('column-move-handle', t('Drag to move column'), 'moveColumn', column,
      '<span class="codicon codicon-gripper" aria-hidden="true"></span>');
    moveHandle.draggable = true;
    th.append(moveHandle);
    titleRow.append(th);
  });
  elements.tableHead.replaceChildren(titleRow);
  requestAnimationFrame(positionHeaderIcons);
}

function positionHeaderIcons() {
  const viewport = elements.tableScroll.getBoundingClientRect();
  const numberWidth = elements.tableHead.querySelector('.row-number-head')?.getBoundingClientRect().width ?? 0;
  const viewportLeft = viewport.left + numberWidth;
  const viewportRight = viewport.left + elements.tableScroll.clientWidth;
  elements.tableHead.querySelectorAll('th[data-column]').forEach((header) => {
    const layout = header.querySelector('.heading-content');
    const name = header.querySelector('.sort-button > span:first-child');
    const indicators = header.querySelector('.sort-indicators');
    const filter = header.querySelector('.filter-button');
    const moveHandle = header.querySelector('.column-move-handle');
    if (!layout || !name || !indicators || !filter || !moveHandle) return;
    const rect = layout.getBoundingClientRect();
    const visibleLeft = Math.max(0, viewportLeft - rect.left);
    const visibleRight = Math.min(layout.clientWidth, viewportRight - rect.left);
    const filterWidth = 18;
    const tooWide = layout.clientWidth > Math.max(320, elements.tableScroll.clientWidth * 0.6);
    // Ordinary columns put the filter at their right edge. Keep it within the
    // visible portion when scrolling, and near the title on unusually wide columns.
    const preferred = tooWide ? Math.min(layout.clientWidth - filterWidth - 3, name.offsetLeft + name.scrollWidth + 8)
      : layout.clientWidth - filterWidth - 3;
    const filterLeft = Math.max(visibleLeft, Math.min(preferred, visibleRight - filterWidth - 3));
    filter.hidden = visibleRight - visibleLeft < filterWidth;
    moveHandle.hidden = filter.hidden;
    filter.style.left = `${filterLeft}px`;
    filter.style.right = 'auto';
    moveHandle.style.left = `${layout.offsetLeft + filterLeft}px`;
    moveHandle.style.right = 'auto';
    layout.style.setProperty('--heading-right-padding', `${Math.max(26, layout.clientWidth - filterLeft + 4)}px`);
    const width = Math.min(name.scrollWidth, name.clientWidth);
    indicators.style.setProperty('--sort-indicator-left', `${name.offsetLeft + width / 2}px`);
  });
}

function renderBody() {
  const fragment = document.createDocumentFragment();

  if (visibleRows.length === 0) {
    const row = document.createElement('tr');
    const cell = createElement('td', 'empty-state', isLoadingDocument ? t('Loading CSV…') : t(sheet.rows.length === 0
      ? 'No data rows yet. Add a row to get started.'
      : 'No matching rows. Clear or adjust your column filters.'));
    cell.colSpan = sheet.headers.length + 1;
    row.append(cell);
    fragment.append(row);
    renderedRowStart = 0;
    renderedRowEnd = 0;
  } else {
    const { start, end } = getRenderedRowRange();
    appendVirtualSpacer(fragment, start * TABLE_ROW_HEIGHT);
    for (let index = start; index < end; index += 1) {
      const row = visibleRows[index];
      const tr = document.createElement('tr');
      tr.classList.toggle('is-selected', selectedRows.has(row.id));
      tr.classList.toggle('is-striped', index % 2 === 1);

      const rowHeader = createElement('td', 'row-number-cell');
      rowHeader.dataset.rowHeader = String(row.id);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedRows.has(row.id);
      checkbox.dataset.selectRow = String(row.id);
      checkbox.title = `${t('Select row')} ${row.id}`;
      checkbox.setAttribute('aria-label', checkbox.title);
      rowHeader.title = `${t('Original row number')} ${row.id}`;
      rowHeader.append(checkbox, createElement('span', '', String(row.id)));
      tr.append(rowHeader);

      sheet.headers.forEach((_, column) => {
        const value = row.cells[column] ?? '';
        const td = createElement('td', 'data-cell', value);
        td.dataset.rowId = String(row.id);
        td.dataset.column = String(column);
        td.classList.toggle('is-column-selected', selectedColumns.has(column));
        td.classList.toggle('is-cell-selected', isCellSelected(row.id, column));
        applyColumnColor(td, column);
        td.tabIndex = 0;
        td.title = value ? `${value}\nDouble-click to edit` : 'Double-click to edit';
        if (!value) td.classList.add('empty-cell');
        tr.append(td);
      });
      fragment.append(tr);
    }
    appendVirtualSpacer(fragment, (visibleRows.length - end) * TABLE_ROW_HEIGHT);
    renderedRowStart = start;
    renderedRowEnd = end;
  }
  elements.tableBody.replaceChildren(fragment);
}

function getRenderedRowRange() {
  const count = visibleRows.length;
  if (count <= VIRTUALIZE_AFTER_ROWS) return { start: 0, end: count };
  const viewportHeight = elements.tableScroll.clientHeight || 600;
  const firstVisible = Math.floor(elements.tableScroll.scrollTop / TABLE_ROW_HEIGHT);
  const start = Math.max(0, firstVisible - VIRTUAL_ROW_OVERSCAN);
  const end = Math.min(count, Math.max(start + 1,
    Math.ceil((elements.tableScroll.scrollTop + viewportHeight) / TABLE_ROW_HEIGHT) + VIRTUAL_ROW_OVERSCAN));
  return { start, end };
}

function appendVirtualSpacer(fragment, height) {
  if (height <= 0) return;
  const row = document.createElement('tr');
  row.className = 'virtual-spacer';
  row.setAttribute('aria-hidden', 'true');
  const cell = document.createElement('td');
  cell.colSpan = sheet.headers.length + 1;
  cell.style.height = `${height}px`;
  row.append(cell);
  fragment.append(row);
}

function scheduleVirtualRowRender() {
  if (virtualRenderFrame !== null) return;
  virtualRenderFrame = window.requestAnimationFrame(() => {
    virtualRenderFrame = null;
    if (visibleRows.length <= VIRTUALIZE_AFTER_ROWS) return;
    const { start, end } = getRenderedRowRange();
    if (start === renderedRowStart && end === renderedRowEnd) return;
    renderBody();
  });
}

function updateToolbar() {
  elements.exportButton.disabled = isLoadingDocument || exportInProgress || !documentLoaded;
  document.querySelectorAll('[data-action="export-csv"], [data-action="export-pdf"]').forEach((button) => {
    button.disabled = isLoadingDocument || exportInProgress || !documentLoaded;
  });
  const locale = LOCALES[language] || LOCALES.en;
  const number = (value) => value.toLocaleString(locale);
  const filterCount = columnFilters.filter(isColumnFilterActive).length;
  const visibleCount = visibleRows.length;
  const filtered = visibleCount !== sheet.rows.length;
  const rowCount = sheet.rows.length;
  const result = filtered
    ? `${number(visibleCount)} ${t('of')} ${number(rowCount)} ${t(rowCount === 1 ? 'row' : 'rows')}`
    : `${number(rowCount)} ${t(rowCount === 1 ? 'row' : 'rows')}`;
  const filterStatus = filterCount ? ` · ${number(filterCount)} ${t(filterCount === 1 ? 'filter' : 'filters')}` : '';
  const columnCount = sheet.headers.length;
  elements.tableStatus.textContent = `${result} · ${number(columnCount)} ${t(columnCount === 1 ? 'column' : 'columns')}${filterStatus}${exportInProgress ? ` · ${t('Exporting…')}` : ''}`;
  elements.tableStatus.setAttribute('aria-busy', String(exportInProgress));
  elements.tableStatus.title = elements.tableStatus.textContent;
  elements.addRow.disabled = isLoadingDocument;
  elements.addColumn.disabled = isLoadingDocument;
  elements.pasteTable.disabled = isLoadingDocument || pendingClipboardRequest !== null;
  elements.deleteSelected.disabled = isLoadingDocument || selectedRows.size === 0;
  elements.selectionCount.textContent = selectedRows.size.toLocaleString(locale);
  elements.selectionCount.hidden = selectedRows.size === 0;
}

function updateSelectAll(checkbox = document.getElementById('select-visible-rows')) {
  if (!checkbox) return;
  if (selectedRows.size === 0) {
    checkbox.checked = false;
    checkbox.indeterminate = false;
    return;
  }
  const count = visibleRows.reduce((total, row) => total + Number(selectedRows.has(row.id)), 0);
  checkbox.checked = count > 0 && count === visibleRows.length;
  checkbox.indeterminate = count > 0 && count < visibleRows.length;
}

function isCellSelected(rowId, column) {
  return Boolean(cellSelection?.rowIds.has(rowId)
    && column >= cellSelection.firstColumn && column <= cellSelection.lastColumn);
}

// Update only selection styles; replacing the table here would lose focus and
// pointer targets and would do unnecessary work on every pointer movement.
function refreshSelection() {
  elements.tableHead.querySelectorAll('[data-column]').forEach((cell) => {
    cell.classList.toggle('is-column-selected', selectedColumns.has(Number(cell.dataset.column)));
  });
  elements.tableBody.querySelectorAll('[data-row-header]').forEach((header) => {
    const selected = selectedRows.has(Number(header.dataset.rowHeader));
    header.closest('tr').classList.toggle('is-selected', selected);
    header.querySelector('input').checked = selected;
  });
  elements.tableBody.querySelectorAll('.data-cell').forEach((cell) => {
    const column = Number(cell.dataset.column);
    cell.classList.toggle('is-column-selected', selectedColumns.has(column));
    cell.classList.toggle('is-cell-selected', isCellSelected(Number(cell.dataset.rowId), column));
  });
  updateSelectAll();
  updateToolbar();
}

function applyDragSelection(target) {
  const drag = selectionDrag;
  const columnTarget = target?.closest('[data-column]');
  const rowTarget = target?.closest('[data-row-id], [data-row-header]');
  const column = columnTarget ? Number(columnTarget.dataset.column) : drag.column;
  const rowId = rowTarget ? Number(rowTarget.dataset.rowId ?? rowTarget.dataset.rowHeader) : null;
  const rowIndex = rowId === null ? drag.rowIndex : visibleRows.findIndex((row) => row.id === rowId);
  if (drag.kind !== 'column' && rowIndex < 0) return;
  if (drag.lastColumn === column && drag.lastRowIndex === rowIndex) return;
  drag.lastColumn = column;
  drag.lastRowIndex = rowIndex;
  const firstColumn = Math.min(drag.column, column);
  const lastColumn = Math.max(drag.column, column);
  if (drag.kind === 'column') {
    selectedColumns.clear();
    drag.base.forEach((item) => selectedColumns.add(item));
    for (let index = firstColumn; index <= lastColumn; index += 1) {
      if (drag.remove) selectedColumns.delete(index);
      else selectedColumns.add(index);
    }
    selectedColumn = selectedColumns.has(column) ? column : (selectedColumns.values().next().value ?? -1);
  } else {
    const rows = visibleRows.slice(Math.min(drag.rowIndex, rowIndex), Math.max(drag.rowIndex, rowIndex) + 1);
    if (drag.kind === 'row') {
      selectedRows = new Set(drag.base);
      rows.forEach((row) => {
        if (drag.remove) selectedRows.delete(row.id);
        else selectedRows.add(row.id);
      });
    } else {
      cellSelection = { rowIds: new Set(rows.map((row) => row.id)), firstColumn, lastColumn };
    }
  }
  refreshSelection();
}

function scrollSelection() {
  selectionScrollFrame = null;
  if (!selectionDrag?.moved) return;
  const { x, y } = selectionDrag;
  const rect = elements.tableScroll.getBoundingClientRect();
  const step = (position, start, end) => position < start + 24 ? -18 : (position > end - 24 ? 18 : 0);
  if (selectionDrag.kind !== 'column') elements.tableScroll.scrollTop += step(y, rect.top + elements.tableHead.offsetHeight, rect.bottom);
  if (selectionDrag.kind !== 'row') elements.tableScroll.scrollLeft += step(x, rect.left, rect.right);
  // Render synchronously so hit testing sees the newly visible virtual rows.
  const { start, end } = getRenderedRowRange();
  if (start !== renderedRowStart || end !== renderedRowEnd) renderBody();
  const target = document.elementFromPoint(Math.max(rect.left + 1, Math.min(x, rect.right - 1)),
    Math.max(rect.top + elements.tableHead.offsetHeight + 1, Math.min(y, rect.bottom - 1)));
  applyDragSelection(target);
  selectionScrollFrame = requestAnimationFrame(scrollSelection);
}

function stopSelectionDrag() {
  if (selectionDrag) {
    suppressSelectionClick = selectionDrag.moved || selectionDrag.kind !== 'column';
    // A cancelled pointer may produce no click; do not swallow the next click.
    window.setTimeout(() => { suppressSelectionClick = false; }, 0);
  }
  selectionDrag = null;
  if (selectionScrollFrame !== null) cancelAnimationFrame(selectionScrollFrame);
  selectionScrollFrame = null;
  document.body.classList.remove('is-selecting-cells');
}

function moveColumn(from, to) {
  const count = sheet.headers.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= count || to >= count || from === to) return;
  const order = Array.from({ length: count }, (_, index) => index);
  order.splice(to, 0, order.splice(from, 1)[0]);
  const reorder = (values) => order.map((index) => values[index]);
  sheet.headers = reorder(sheet.headers);
  sheet.rows.forEach((row) => { row.cells = reorder(row.cells).map((value) => value ?? ''); });
  columnFilters = reorder(columnFilters);
  columnWidths = reorder(columnWidths);
  columnWidthOverrides = reorder(columnWidthOverrides);
  const selection = [...selectedColumns].map((column) => order.indexOf(column));
  selectedColumns.clear();
  selection.forEach((column) => selectedColumns.add(column));
  selectedColumn = order.indexOf(selectedColumn);
  if (sortState) sortState.column = order.indexOf(sortState.column);
  cellSelection = null;
  closePopovers();
  persistViewState();
  renderTable();
  sendEdit();
}

function selectionText() {
  const columns = cellSelection
    ? Array.from({ length: cellSelection.lastColumn - cellSelection.firstColumn + 1 }, (_, index) => cellSelection.firstColumn + index)
    : (selectedColumns.size ? [...selectedColumns].sort((a, b) => a - b) : sheet.headers.map((_, index) => index));
  return visibleRows.filter((row) => cellSelection ? cellSelection.rowIds.has(row.id) : (!selectedRows.size || selectedRows.has(row.id)))
    .map((row) => columns.map((column) => escapeCell(row.cells[column] ?? '', '\t')).join('\t')).join('\n');
}

async function exportTable(format) {
  if (isLoadingDocument || exportInProgress || !documentLoaded) return;
  closePopovers();
  exportInProgress = true;
  updateToolbar();
  // Export the complete filtered/sorted view, including virtual rows that have
  // never been rendered. A snapshot keeps later edits out of an ongoing export.
  const snapshot = { ...sheet, headers: sheet.headers.slice(), rows: getVisibleRows().map((row) => ({ ...row, cells: row.cells.slice() })) };
  try {
    if (format === 'csv') {
      vscode.postMessage({ type: 'exportTable', format, text: serializeCsv(snapshot) });
    } else {
      const bytes = await CsvExport.createTablePdf(snapshot.headers, snapshot.rows, lastFilename || 'CSV');
      const chunks = [];
      for (let index = 0; index < bytes.length; index += 8192) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
      vscode.postMessage({ type: 'exportTable', format, base64: btoa(chunks.join('')) });
    }
  } catch (error) {
    exportInProgress = false;
    updateToolbar();
    vscode.postMessage({ type: 'showExportError', message: error.message || String(error) });
  }
}

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"], dialog, .popover')) return;
  if (!cellSelection && !selectedRows.size && !selectedColumns.size) return;
  event.preventDefault();
  vscode.postMessage({ type: 'copyToClipboard', text: selectionText() });
});

function renderTable() {
  pendingCellRender = false;
  visibleRows = getVisibleRows();
  elements.table.classList.toggle('has-gridlines', showGridlines);
  const numberColumn = document.createElement('col');
  numberColumn.style.width = 'var(--row-number-width)';
  elements.tableColumns.replaceChildren(numberColumn, ...sheet.headers.map((_, column) => {
    const col = document.createElement('col');
    col.style.width = columnWidthCss(column);
    return col;
  }));
  updateTableWidth();
  renderHeader();
  renderBody();
  updateToolbar();
}

function recalculateColumnWidths(columns = null) {
  const columnsToMeasure = columns ?? sheet.headers.map((_, column) => column);
  if (columns === null) columnWidths = Array(sheet.headers.length);
  // Measure the actual UI fonts instead of estimating character counts. Inspect
  // every row so late values and wide glyphs also fit when automatic sizing is used.
  const probe = document.createElement('table');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;';
  const th = probe.createTHead().insertRow().appendChild(document.createElement('th'));
  const button = createElement('button', 'sort-button');
  th.append(button);
  const td = probe.createTBody().insertRow().insertCell();
  td.className = 'data-cell';
  document.body.append(probe);
  const headerStyle = getComputedStyle(button);
  const headingStyle = getComputedStyle(th);
  const cellStyle = getComputedStyle(td);
  const font = style => `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const headerFont = font(headerStyle);
  const cellFont = font(cellStyle);
  const padding = style => parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  // Include a gridline even when gridlines are currently hidden.
  const headerPadding = padding(headerStyle) + padding(headingStyle) + 1;
  const cellPadding = padding(cellStyle) + 1;
  probe.remove();
  const context = document.createElement('canvas').getContext('2d');
  const widths = new Map();
  const measure = value => {
    const text = String(value ?? '').replace(/[ \t\r\n\f]+/g, ' ').trim();
    if (widths.has(text)) return widths.get(text);
    const width = context.measureText(text).width;
    if (widths.size < 4096) widths.set(text, width);
    return width;
  };
  context.font = headerFont;
  for (const column of columnsToMeasure) {
    const header = sheet.headers[column] ?? '';
    columnWidths[column] = Math.max(40, Math.ceil(measure(header.trim() ? header : `${t('Column')} ${column + 1}`) + headerPadding));
  }
  context.font = cellFont;
  widths.clear();
  for (const row of sheet.rows) {
    for (const column of columnsToMeasure) {
      columnWidths[column] = Math.max(columnWidths[column], Math.ceil(measure(row.cells[column]) + cellPadding));
    }
  }
}

function updateTableWidth() {
  const widths = sheet.headers.map((_, column) => Math.ceil(columnWidthOverrides[column] ?? columnWidths[column] ?? 80));
  const flexible = sheet.headers.map((_, column) => column).filter(column => !Number.isFinite(columnWidthOverrides[column]));
  const numberWidth = Math.ceil(parseFloat(getComputedStyle(elements.table).getPropertyValue('--row-number-width')) || 43);
  const minimumWidth = widths.reduce((sum, width) => sum + width, numberWidth);
  const spare = responsiveColumns ? Math.max(0, elements.tableScroll.clientWidth - minimumWidth) : 0;
  const flexibleWidth = flexible.reduce((sum, column) => sum + widths[column], 0);
  if (spare > 0 && flexibleWidth > 0) {
    const additions = flexible.map((column) => {
      const exact = spare * widths[column] / flexibleWidth;
      return { column, pixels: Math.floor(exact), remainder: exact % 1 };
    });
    let remaining = spare;
    for (const addition of additions) {
      widths[addition.column] += addition.pixels;
      remaining -= addition.pixels;
    }
    additions.sort((left, right) => right.remainder - left.remainder);
    for (let index = 0; index < remaining; index += 1) widths[additions[index % additions.length].column] += 1;
  }
  displayColumnWidths = widths;
  sheet.headers.forEach((_, column) => {
    const col = elements.tableColumns.children[column + 1];
    if (col) col.style.width = columnWidthCss(column);
  });
  elements.table.style.width = `${widths.reduce((sum, width) => sum + width, numberWidth)}px`;
  positionHeaderIcons();
}

function applyColumnWidth(column, width) {
  const value = Math.max(40, Math.round(width));
  columnWidthOverrides[column] = value;
  elements.tableColumns.children[column + 1].style.width = `${value}px`;
  updateTableWidth();
  return value;
}

function resetColumnWidths() {
  columnWidthOverrides = Array(sheet.headers.length).fill(null);
  persistViewState();
  closePopovers();
  renderTable();
}

function focusCell(rowId, column) {
  let cell = elements.tableBody.querySelector(`[data-row-id="${rowId}"][data-column="${column}"]`);
  if (!cell && visibleRows.length > VIRTUALIZE_AFTER_ROWS) {
    const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
    if (rowIndex >= 0) {
      elements.tableScroll.scrollTop = elements.tableHead.offsetHeight + (rowIndex * TABLE_ROW_HEIGHT);
      renderBody();
      cell = elements.tableBody.querySelector(`[data-row-id="${rowId}"][data-column="${column}"]`);
    }
  }
  if (cell) {
    cell.focus();
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function focusNeighbor(rowId, column, direction) {
  const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
  let nextColumn = column + direction;
  let nextRow = rowIndex;
  if (nextColumn >= sheet.headers.length) {
    nextColumn = 0;
    nextRow += 1;
  } else if (nextColumn < 0) {
    nextColumn = sheet.headers.length - 1;
    nextRow -= 1;
  }
  if (nextRow >= 0 && nextRow < visibleRows.length) focusCell(visibleRows[nextRow].id, nextColumn);
}

function beginCellEdit(cell) {
  if (!cell || cell.querySelector('textarea')) return;
  const rowId = Number(cell.dataset.rowId);
  const column = Number(cell.dataset.column);
  const row = sheet.rows.find((item) => item.id === rowId);
  if (!row) return;

  const originalValue = row.cells[column] ?? '';
  const editor = document.createElement('textarea');
  editor.className = 'cell-editor';
  editor.rows = Math.min(4, Math.max(1, originalValue.split('\n').length));
  editor.value = originalValue;
  editor.setAttribute('aria-label', `Edit ${sheet.headers[column] || `Column ${column + 1}`}`);
  cell.replaceChildren(editor);
  editor.focus();
  editor.select();

  let finished = false;
  const finish = (save, moveDirection = 0, fromBlur = false) => {
    if (finished) return;
    finished = true;
    if (save) {
      row.cells[column] = editor.value;
      recalculateColumnWidths([column]);
      sendEdit();
    }
    // Keep the pointer's target alive until its click has been dispatched.
    // Rebuilding here would swallow clicks on other cells and column headers.
    if (fromBlur && pointerIsDown) {
      cell.textContent = row.cells[column] ?? '';
      cell.classList.toggle('empty-cell', !row.cells[column]);
      pendingCellRender = true;
      return;
    }
    renderTable();
    if (moveDirection) focusNeighbor(rowId, column, moveDirection);
    else if (!fromBlur) focusCell(rowId, column);
  };

  editor.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      finish(true, event.shiftKey ? -1 : 1);
    }
  });
  editor.addEventListener('blur', () => finish(true, 0, true), { once: true });
}

function flushCellRender() {
  if (!pendingCellRender) return;
  const focused = document.activeElement;
  const rowId = focused?.dataset.rowId;
  const column = focused?.dataset.column;
  renderTable();
  if (rowId !== undefined && column !== undefined) focusCell(Number(rowId), Number(column));
}

document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
const finishPointerInteraction = () => {
  pointerIsDown = false;
  if (pendingCellRender) window.setTimeout(flushCellRender, 0);
};
document.addEventListener('pointerup', finishPointerInteraction, true);
document.addEventListener('pointercancel', finishPointerInteraction, true);
window.addEventListener('blur', () => {
  pointerIsDown = false;
  flushCellRender();
});

function openColumnDialog(mode, column = -1) {
  elements.columnTitle.textContent = t(mode === 'rename' ? 'Rename column' : 'Add column');
  elements.columnName.value = mode === 'rename' ? (sheet.headers[column] || '') : '';
  elements.columnName.placeholder = t(mode === 'rename' ? 'Column name' : 'e.g. Product ID');

  return new Promise((resolve) => {
    elements.columnDialog.addEventListener('close', () => {
      const result = elements.columnDialog.returnValue === 'save' ? elements.columnName.value.trim() : '';
      resolve(result);
    }, { once: true });
    elements.columnDialog.showModal();
    window.setTimeout(() => elements.columnName.focus(), 0);
  });
}

function confirmAction(message) {
  elements.confirmMessage.textContent = message;
  document.getElementById('confirm-title').textContent = t('Confirm deletion');
  return new Promise((resolve) => {
    elements.confirmDialog.addEventListener('close', () => {
      resolve(elements.confirmDialog.returnValue === 'confirm');
    }, { once: true });
    elements.confirmDialog.showModal();
  });
}

function selectedReplacementColumns() {
  const scope = elements.replaceForm.querySelector('input[name="replace-scope"]:checked')?.value;
  if (scope === 'all') return sheet.headers.map((_, column) => column);
  return [...elements.replaceColumns.querySelectorAll('input:checked')]
    .map(input => Number(input.dataset.replaceColumn));
}

function updateReplacementMatchCount() {
  const search = elements.replaceFind.value;
  const columns = selectedReplacementColumns();
  let count = 0;
  if (search !== '' && columns.length) {
    for (const row of sheet.rows) {
      for (const column of columns) {
        if (String(row.cells[column] ?? '').includes(search)) count += 1;
      }
    }
  }
  const locale = LOCALES[language] || LOCALES.en;
  const isUnchanged = count > 0 && elements.replaceWith.value === search;
  elements.replaceCount.textContent = isUnchanged
    ? t('Replacement is the same as the search value.')
    : `${count.toLocaleString(locale)} ${t(count === 1 ? 'matching cell' : 'matching cells')}`;
  const selectedScope = elements.replaceForm.querySelector('input[name="replace-scope"][value="selected"]')?.checked;
  elements.replaceSubmit.disabled = count === 0 || isUnchanged || (selectedScope && columns.length === 0);
}

function updateToolbarReplacementMatchCount() {
  const search = elements.toolbarReplaceFind.value;
  const replacement = elements.toolbarReplaceWith.value;
  const columns = selectedColumns.size ? [...selectedColumns] : (selectedColumn >= 0 ? [selectedColumn] : []);
  const allColumns = sheet.headers.map((_, column) => column);
  const countIn = (indices) => search === '' ? 0 : sheet.rows.reduce((total, row) => total + indices.filter((column) => String(row.cells[column] ?? '').includes(search)).length, 0);
  const selectedCount = countIn(columns);
  const allCount = countIn(allColumns);
  const locale = LOCALES[language] || LOCALES.en;
  elements.toolbarReplaceCount.textContent = `${allCount.toLocaleString(locale)} ${t(allCount === 1 ? 'matching cell' : 'matching cells')}`;
  const unchanged = replacement === search;
  elements.replaceValuesPopover.querySelector('[data-replace-scope="all"]').disabled = search === '' || allCount === 0 || unchanged;
  elements.replaceValuesPopover.querySelector('[data-replace-scope="selected"]').disabled = search === '' || selectedCount === 0 || columns.length === 0 || unchanged;
}

function openReplaceValuesDialog(scope = 'all') {
  closePopovers();
  elements.replaceFind.value = '';
  elements.replaceWith.value = '';
  elements.replaceForm.querySelector(`input[name="replace-scope"][value="${scope}"]`).checked = true;
  elements.replaceForm.querySelector('input[name="replace-scope"][value="selected"]').disabled = sheet.headers.length === 0;
  elements.replaceColumns.replaceChildren(...sheet.headers.map((name, column) => {
    const label = createElement('label', 'replace-column-option');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.replaceColumn = String(column);
    checkbox.checked = scope === 'selected' && selectedColumns.has(column);
    const text = createElement('span', '', name.trim() || `${t('Column')} ${column + 1}`);
    text.title = text.textContent;
    label.append(checkbox, text);
    return label;
  }));
  elements.replaceColumns.hidden = true;
  updateReplacementMatchCount();
  elements.replaceDialog.showModal();
  window.setTimeout(() => elements.replaceFind.focus(), 0);
}

function replaceMatchingValues() {
  const search = elements.replaceFind.value;
  if (search === '') return 0;
  const replacement = elements.replaceWith.value;
  if (replacement === search) return 0;
  const columns = selectedReplacementColumns();
  let count = 0;
  const changedColumns = new Set();
  for (const row of sheet.rows) {
    for (const column of columns) {
      const value = String(row.cells[column] ?? '');
      if (!value.includes(search)) continue;
      row.cells[column] = value.replaceAll(search, replacement);
      count += 1;
      changedColumns.add(column);
    }
  }
  if (count) {
    for (const column of changedColumns) columnFilters[column] = null;
    renderTable();
    sendEdit();
  }
  return count;
}

function positionPopover(popover, anchor) {
  popover.hidden = false;
  const anchorRect = anchor.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - rect.width - 8));
  let top = anchorRect.bottom + 5;
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, anchorRect.top - rect.height - 5);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function positionToolbarPopover(popover, anchor) {
  popover.hidden = false;
  const anchorRect = anchor.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - rect.width - 8));
  let top = anchorRect.top - rect.height - 5;
  if (top < 8) top = Math.min(window.innerHeight - rect.height - 8, anchorRect.bottom + 5);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function closePopovers(restoreFocus = false) {
  const anchor = popoverAnchor;
  for (const popover of [elements.settingsPopover, elements.filterPopover, elements.contextPopover, elements.addColumnPopover, elements.replaceValuesPopover, elements.exportPopover]) popover.hidden = true;
  document.querySelectorAll('[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  activePopover = null;
  activeColumn = -1;
  contextTarget = null;
  popoverAnchor = null;
  filterDraft = null;
  filterOptions = [];
  filterMatches = [];
  filterGlobalValues = new Set();
  elements.filterValues.replaceChildren();
  if (restoreFocus && anchor) {
    const currentAnchor = anchor.isConnected ? anchor
      : elements.tableHead.querySelector(`[data-filter-toggle="${anchor.dataset.filterToggle}"]`);
    currentAnchor?.focus();
  }
}

function openSettingsPopover() {
  if (activePopover === elements.settingsPopover) {
    closePopovers();
    return;
  }
  closePopovers();
  elements.settingsPopover.querySelector('[data-action="clear-sort"]').hidden = !sortState;
  activePopover = elements.settingsPopover;
  popoverAnchor = elements.settingsButton;
  elements.settingsButton.setAttribute('aria-expanded', 'true');
  positionPopover(elements.settingsPopover, elements.settingsButton);
  elements.settingsPopover.focus({ preventScroll: true });
}

function openToolbarPopover(popover, anchor) {
  if (activePopover === popover) {
    closePopovers();
    return;
  }
  closePopovers();
  if (popover === elements.addColumnPopover) {
    elements.toolbarColumnName.value = '';
    const selected = selectedColumns.size ? [...selectedColumns] : (selectedColumn >= 0 ? [selectedColumn] : []);
    const before = popover.querySelector('[data-column-insert="before"]');
    const after = popover.querySelector('[data-column-insert="after"]');
    before.disabled = after.disabled = selected.length === 0 || !elements.toolbarColumnName.value.trim();
    popover.querySelector('[data-column-insert="end"]').disabled = true;
  }
  if (popover === elements.replaceValuesPopover) {
    elements.toolbarReplaceFind.value = '';
    elements.toolbarReplaceWith.value = '';
    updateToolbarReplacementMatchCount();
  }
  activePopover = popover;
  popoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  positionToolbarPopover(popover, anchor);
  (popover === elements.addColumnPopover ? elements.toolbarColumnName : popover === elements.replaceValuesPopover ? elements.toolbarReplaceFind : popover.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
}

function openFilterPopover(column, anchor) {
  if (activePopover === elements.filterPopover && activeColumn === column) {
    closePopovers();
    return;
  }
  closePopovers();
  activePopover = elements.filterPopover;
  activeColumn = column;
  popoverAnchor = anchor;
  elements.filterLabel.textContent = `${t('Filter column')}: ${sheet.headers[column]?.trim() || `${t('Column')} ${column + 1}`}`;
  const current = columnFilters[column];
  elements.filterInput.value = current?.query || '';
  filterGlobalValues = new Set(sheet.rows.map(row => String(row.cells[column] ?? '')));
  filterDraft = new Set(current?.values instanceof Set ? current.values : filterGlobalValues);
  filterOptions = getColumnFilterValues(sheet.rows, columnFilters, column)
    .sort((a, b) => (a.value === '' ? -1 : b.value === '' ? 1 : collator.compare(a.value, b.value)));
  elements.filterPopover.querySelector('[data-action="clear-column-filter"]').disabled = !isColumnFilterActive(current);
  renderFilterValues();
  positionPopover(elements.filterPopover, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  elements.filterInput.focus();
  elements.filterInput.select();
}

function updateFilterSelection() {
  const selected = filterMatches.reduce((count, item) => count + Number(filterDraft.has(item.value)), 0);
  elements.filterSelectAll.checked = filterMatches.length > 0 && selected === filterMatches.length;
  elements.filterSelectAll.indeterminate = selected > 0 && selected < filterMatches.length;
  elements.filterSelectAll.disabled = !filterMatches.length;
  elements.filterSelectAllLabel.textContent = t(elements.filterInput.value.trim() ? 'Select all matches' : 'Select all values');
  elements.filterSelectionStatus.textContent = `${selected}/${filterMatches.length}`;
}

function applyFilterSelection() {
  if (!filterDraft || activeColumn < 0) return;
  const query = elements.filterInput.value.trim();
  const allSelected = [...filterGlobalValues].every(value => filterDraft.has(value));
  const filter = { query, values: allSelected ? null : new Set(filterDraft) };
  columnFilters[activeColumn] = isColumnFilterActive(filter) ? filter : null;
  elements.filterPopover.querySelector('[data-action="clear-column-filter"]').disabled = !isColumnFilterActive(filter);
  renderTable();
}

function appendFilterValues() {
  const fragment = document.createDocumentFragment();
  const end = Math.min(filterShownCount + FILTER_VALUES_PAGE_SIZE, filterMatches.length);
  for (let index = filterShownCount; index < end; index += 1) {
    const { value, count } = filterMatches[index];
    const label = createElement('label', 'filter-value');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = filterDraft.has(value);
    checkbox.dataset.filterValueIndex = String(index);
    const text = createElement('span', 'filter-value-text', value === '' ? t('(Blanks)') : value);
    text.title = value === '' ? t('(Blanks)') : value;
    label.append(checkbox, text, createElement('span', 'filter-value-count', String(count)));
    fragment.append(label);
  }
  elements.filterValues.append(fragment);
  filterShownCount = end;
  elements.filterMore.hidden = end >= filterMatches.length;
}

function renderFilterValues() {
  const query = elements.filterInput.value.trim().toLocaleLowerCase();
  filterMatches = filterOptions.filter(item => !query || item.value.toLocaleLowerCase().includes(query));
  filterShownCount = 0;
  elements.filterValues.replaceChildren();
  elements.filterValues.scrollTop = 0;
  appendFilterValues();
  if (!filterMatches.length) elements.filterValues.append(createElement('div', 'filter-selection-status', t('No matching values')));
  updateFilterSelection();
}

elements.filterValues.addEventListener('change', event => {
  const index = event.target.dataset.filterValueIndex;
  if (!filterDraft || index === undefined) return;
  const value = filterMatches[Number(index)].value;
  if (event.target.checked) filterDraft.add(value);
  else filterDraft.delete(value);
  updateFilterSelection();
  applyFilterSelection();
});
elements.filterSelectAll.addEventListener('change', () => {
  if (!filterDraft) return;
  for (const { value } of filterMatches) {
    if (elements.filterSelectAll.checked) filterDraft.add(value);
    else filterDraft.delete(value);
  }
  elements.filterValues.querySelectorAll('input').forEach(input => {
    input.checked = filterDraft.has(filterMatches[Number(input.dataset.filterValueIndex)].value);
  });
  updateFilterSelection();
  applyFilterSelection();
});
elements.filterMore.addEventListener('click', appendFilterValues);

function openContextPopover(column, rowId, kind, clientX, clientY) {
  closePopovers();
  activePopover = elements.contextPopover;
  activeColumn = column;
  contextTarget = { rowId, column, kind };
  popoverAnchor = document.activeElement;
  const header = column >= 0 ? (sheet.headers[column]?.trim() || `${t('Column')} ${column + 1}`) : '';
  const row = rowId === null ? null : sheet.rows.find((item) => item.id === rowId);
  const value = row && column >= 0 ? String(row.cells[column] ?? '') : '';
  elements.contextCaption.textContent = kind === 'cell'
    ? header + ': ' + (value || '(empty)')
    : (kind === 'row' ? `${t('row')} ${rowId}` : header);
  elements.contextPopover.querySelectorAll('.context-cell-action').forEach((item) => {
    item.hidden = kind !== 'cell';
  });
  elements.contextPopover.querySelectorAll('.context-column-action').forEach((item) => {
    item.hidden = kind !== 'column' && kind !== 'cell';
  });
  elements.contextPopover.querySelectorAll('.context-row-or-cell-action').forEach((item) => {
    item.hidden = kind !== 'row' && kind !== 'cell';
  });
  const filterValueButton = elements.contextPopover.querySelector('[data-action="filter-value"]');
  filterValueButton.disabled = !row;
  const deleteButton = elements.contextPopover.querySelector('[data-action="delete-column"]');
  deleteButton.disabled = sheet.headers.length <= 1;
  elements.contextPopover.querySelector('[data-action="move-column-left"]').disabled = column <= 0;
  elements.contextPopover.querySelector('[data-action="move-column-right"]').disabled = column < 0 || column >= sheet.headers.length - 1;
  const selectColumnButton = elements.contextPopover.querySelector('[data-action="select-column"]');
  const selectColumnLabel = selectColumnButton.querySelector('[data-i18n]');
  selectColumnLabel.dataset.i18n = selectedColumns.has(column) ? 'Deselect column' : 'Select column';
  selectColumnLabel.textContent = t(selectColumnLabel.dataset.i18n);
  selectColumnButton.setAttribute('aria-pressed', String(selectedColumns.has(column)));
  elements.contextPopover.querySelector('[data-action="clear-sort-column"]').hidden = sortState?.column !== column;
  elements.contextPopover.querySelector('[data-action="sort-ascending"]').hidden = sortState?.column === column && sortState.direction > 0;
  elements.contextPopover.querySelector('[data-action="sort-descending"]').hidden = sortState?.column === column && sortState.direction < 0;
  elements.contextPopover.querySelector('[data-action="copy-row-list"]').disabled = !row;
  elements.contextPopover.hidden = false;
  const rect = elements.contextPopover.getBoundingClientRect();
  const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
  let top = clientY;
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
  elements.contextPopover.style.left = `${left}px`;
  elements.contextPopover.style.top = `${top}px`;
  elements.contextPopover.querySelector('button:not([hidden]):not(:disabled)')?.focus();
}

function clearFilters() {
  columnFilters = Array(sheet.headers.length).fill(null);
  closePopovers();
  renderTable();
}

function clearSort() {
  sortState = null;
  closePopovers();
  renderTable();
}

function addRow() {
  columnFilters = Array(sheet.headers.length).fill(null);
  selectedRows.clear();
  cellSelection = null;
  const row = {
    id: sheet.rows.reduce((maximum, item) => Math.max(maximum, item.id), 0) + 1,
    cells: Array(sheet.headers.length).fill(''),
  };
  sheet.rows.push(row);
  renderTable();
  sendEdit();
  focusCell(row.id, 0);
}

async function addColumn(insertAt = sheet.headers.length, requestedName = '') {
  const name = requestedName.trim() || await openColumnDialog('add');
  if (!name) return;
  const index = Math.max(0, Math.min(insertAt, sheet.headers.length));
  sheet.headers.splice(index, 0, name);
  sheet.rows.forEach((row) => row.cells.splice(index, 0, ''));
  columnFilters.splice(index, 0, null);
  columnWidthOverrides.splice(index, 0, null);
  columnWidths.splice(index, 0, null);
  if (sortState?.column >= index) sortState.column += 1;
  cellSelection = null;
  if (selectedColumn >= index) selectedColumn += 1;
  const shiftedSelection = [...selectedColumns].map((column) => column >= index ? column + 1 : column);
  selectedColumns.clear();
  shiftedSelection.forEach((column) => selectedColumns.add(column));
  persistViewState();
  recalculateColumnWidths([index]);
  renderTable();
  sendEdit();
}

async function renameColumn(column) {
  closePopovers();
  const name = await openColumnDialog('rename', column);
  if (!name) return;
  sheet.headers[column] = name;
  recalculateColumnWidths([column]);
  renderTable();
  sendEdit();
}

async function deleteColumn(column) {
  if (sheet.headers.length <= 1) return;
  const columnName = sheet.headers[column]?.trim() || `Column ${column + 1}`;
  closePopovers();
  const confirmed = await confirmAction(`Delete “${columnName}” and all values in this column?`);
  if (!confirmed) return;

  sheet.headers.splice(column, 1);
  cellSelection = null;
  sheet.rows.forEach((row) => row.cells.splice(column, 1));
  columnFilters.splice(column, 1);
  columnWidths.splice(column, 1);
  columnWidthOverrides.splice(column, 1);
  persistViewState();
  const remappedSelection = [...selectedColumns].filter((item) => item !== column).map((item) => item > column ? item - 1 : item);
  selectedColumns.clear();
  remappedSelection.forEach((item) => selectedColumns.add(item));
  selectedColumn = selectedColumns.values().next().value ?? -1;
  if (sortState) {
    if (sortState.column === column) sortState = null;
    else if (sortState.column > column) sortState.column -= 1;
  }
  renderTable();
  sendEdit();
}

async function deleteSelectedRows() {
  if (selectedRows.size === 0) return;
  const selectedCount = selectedRows.size;
  const confirmed = await confirmAction(`Delete ${selectedCount.toLocaleString('en-US')} selected ${selectedCount === 1 ? 'row' : 'rows'}?`);
  if (!confirmed) return;

  sheet.rows = sheet.rows.filter((row) => !selectedRows.has(row.id));
  selectedRows.clear();
  recalculateColumnWidths();
  renderTable();
  sendEdit();
}

elements.columnForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!elements.columnName.value.trim()) {
    elements.columnName.focus();
    return;
  }
  elements.columnDialog.close('save');
});

document.querySelector('[data-column-cancel]').addEventListener('click', () => elements.columnDialog.close('cancel'));
elements.columnDialog.addEventListener('click', (event) => {
  if (event.target === elements.columnDialog) elements.columnDialog.close('cancel');
});
elements.replaceFind.addEventListener('input', updateReplacementMatchCount);
elements.replaceWith.addEventListener('input', updateReplacementMatchCount);
elements.replaceForm.querySelectorAll('input[name="replace-scope"]').forEach((input) => {
  input.addEventListener('change', () => {
    elements.replaceColumns.hidden = input.value !== 'selected' || !input.checked;
    updateReplacementMatchCount();
  });
});
elements.replaceColumns.addEventListener('change', updateReplacementMatchCount);
elements.replaceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!replaceMatchingValues()) return;
  elements.replaceDialog.close('replace');
});
document.getElementById('replace-cancel').addEventListener('click', () => elements.replaceDialog.close('cancel'));
elements.replaceDialog.addEventListener('close', () => elements.replaceValues.focus());
document.getElementById('add-row').addEventListener('click', addRow);
elements.addColumn.addEventListener('click', () => openToolbarPopover(elements.addColumnPopover, elements.addColumn));
elements.addColumnPopover.addEventListener('click', (event) => {
  const option = event.target.closest('[data-column-insert]');
  if (!option || option.disabled) return;
  let index = sheet.headers.length;
  const name = elements.toolbarColumnName.value.trim();
  const selected = selectedColumns.size ? [...selectedColumns] : (selectedColumn >= 0 ? [selectedColumn] : []);
  if (option.dataset.columnInsert === 'before' && selected.length) index = Math.min(...selected);
  else if (option.dataset.columnInsert === 'after' && selected.length) index = Math.max(...selected) + 1;
  closePopovers();
  void addColumn(index, name);
});
elements.toolbarColumnName.addEventListener('input', () => {
  const hasName = Boolean(elements.toolbarColumnName.value.trim());
  const selected = selectedColumns.size > 0 || selectedColumn >= 0;
  elements.addColumnPopover.querySelector('[data-column-insert="before"]').disabled = !hasName || !selected;
  elements.addColumnPopover.querySelector('[data-column-insert="after"]').disabled = !hasName || !selected;
  elements.addColumnPopover.querySelector('[data-column-insert="end"]').disabled = !hasName;
});
elements.deleteSelected.addEventListener('click', () => void deleteSelectedRows());
elements.replaceValues.addEventListener('click', () => openToolbarPopover(elements.replaceValuesPopover, elements.replaceValues));
elements.replaceValuesPopover.addEventListener('click', (event) => {
  const option = event.target.closest('[data-replace-scope]');
  if (!option || option.disabled) return;
  const scope = option.dataset.replaceScope;
  const quickSelectedColumns = selectedColumns.size ? [...selectedColumns] : (selectedColumn >= 0 ? [selectedColumn] : []);
  elements.replaceFind.value = elements.toolbarReplaceFind.value;
  elements.replaceWith.value = elements.toolbarReplaceWith.value;
  elements.replaceForm.querySelector('input[name="replace-scope"][value="all"]').checked = scope === 'all';
  elements.replaceForm.querySelector('input[name="replace-scope"][value="selected"]').checked = scope === 'selected';
  elements.replaceColumns.replaceChildren(...sheet.headers.map((_, column) => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.replaceColumn = String(column);
    checkbox.checked = quickSelectedColumns.includes(column);
    return checkbox;
  }));
  if (replaceMatchingValues()) closePopovers();
});
elements.toolbarReplaceFind.addEventListener('input', updateToolbarReplacementMatchCount);
elements.toolbarReplaceWith.addEventListener('input', updateToolbarReplacementMatchCount);
elements.settingsButton.addEventListener('click', openSettingsPopover);
elements.exportButton.addEventListener('click', () => openToolbarPopover(elements.exportPopover, elements.exportButton));
elements.colorizeColumns.addEventListener('change', () => {
  colorizeColumns = elements.colorizeColumns.checked;
  persistViewState();
  persistTablePreferences();
  renderTable();
});
elements.showGridlines.addEventListener('change', () => {
  showGridlines = elements.showGridlines.checked;
  persistViewState();
  persistTablePreferences();
  renderTable();
});

elements.responsiveColumns.checked = responsiveColumns;
document.body.dataset.theme = theme;
updateAppearanceSwitcher();
elements.responsiveColumns.addEventListener('change', () => {
  responsiveColumns = elements.responsiveColumns.checked;
  updateTableWidth();
  persistViewState();
  persistTablePreferences();
});
elements.appearanceSwitcher.addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme]');
  if (!button || !elements.appearanceSwitcher.contains(button)) return;
  theme = button.dataset.theme;
  document.body.dataset.theme = theme;
  updateAppearanceSwitcher();
  persistViewState();
  persistTablePreferences();
});
elements.language.value = language;
applyTranslations();
elements.language.addEventListener('change', () => {
  language = elements.language.value in TRANSLATIONS ? elements.language.value : 'en';
  collator = new Intl.Collator(LOCALES[language] || LOCALES.en, { numeric: true, sensitivity: 'base' });
  persistViewState();
  persistTablePreferences();
  applyTranslations();
  renderTable();
  if (activePopover === elements.settingsPopover) positionPopover(elements.settingsPopover, elements.settingsButton);
});
elements.openByDefault.addEventListener('change', () => {
  elements.openByDefault.disabled = true;
  vscode.postMessage({ type: 'setDefaultEditorPreference', enabled: elements.openByDefault.checked });
});

elements.table.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-resize-column]');
  if (!handle || event.button !== 0) return;
  event.preventDefault();
  const column = Number(handle.dataset.resizeColumn);
  const header = elements.tableHead.querySelector('th[data-column="' + column + '"]');
  if (!header) return;
  closePopovers();
  handle.setPointerCapture(event.pointerId);
  handle.classList.add('is-dragging');
  resizeState = {
    handle,
    column,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: header.getBoundingClientRect().width,
    group: [...selectedColumns].filter((selected) => selected !== column).map((selected) => ({
      column: selected,
      startWidth: elements.tableHead.querySelector(`th[data-column="${selected}"]`)?.getBoundingClientRect().width,
    })).filter((entry) => Number.isFinite(entry.startWidth)),
  };
  document.body.classList.add('is-resizing-column');
});

document.addEventListener('pointermove', (event) => {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const delta = event.clientX - resizeState.startX;
  resizeState.currentWidth = applyColumnWidth(resizeState.column, resizeState.startWidth + delta);
  resizeState.group.forEach((entry) => applyColumnWidth(entry.column, entry.startWidth + delta));
});

function finishColumnResize(event) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const resizedColumn = resizeState.column;
  const finalWidth = resizeState.currentWidth ?? resizeState.startWidth;
  resizeState.handle.classList.remove('is-dragging');
  resizeState = null;
  document.body.classList.remove('is-resizing-column');
  applyColumnWidth(resizedColumn, finalWidth);
  persistViewState();
}
document.addEventListener('pointerup', finishColumnResize);
document.addEventListener('pointercancel', finishColumnResize);

elements.table.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || isLoadingDocument || event.target.closest('textarea, input, [data-resize-column], [data-move-column], [data-filter-toggle], .sort-direction')) return;
  const cell = event.target.closest('.data-cell');
  const row = event.target.closest('[data-row-header]');
  const heading = event.target.closest('th[data-column]');
  if (!cell && !row && !heading) return;
  const kind = heading ? 'column' : (row ? 'row' : 'cell');
  const column = Number((heading || cell)?.dataset.column ?? 0);
  const rowId = Number((cell || row)?.dataset.rowId ?? row?.dataset.rowHeader);
  const additive = event.ctrlKey || event.metaKey;
  selectionDrag = {
    kind, column, rowIndex: visibleRows.findIndex((item) => item.id === rowId),
    pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    x: event.clientX, y: event.clientY, moved: false,
    base: additive ? new Set(kind === 'column' ? selectedColumns : selectedRows) : new Set(),
    remove: additive && (kind === 'column' ? selectedColumns.has(column) : selectedRows.has(rowId)),
  };
  if (kind !== 'column') {
    event.preventDefault();
    // Commit any active editor before selecting its replacement cell.
    document.activeElement?.blur();
    selectedColumns.clear();
    selectedColumn = -1;
    if (kind === 'cell') selectedRows.clear();
    cellSelection = null;
    cell?.focus({ preventScroll: true });
    applyDragSelection(event.target);
  }
});

document.addEventListener('pointermove', (event) => {
  if (!selectionDrag || event.pointerId !== selectionDrag.pointerId) return;
  const drag = selectionDrag;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    if (drag.kind === 'column') {
      selectedRows.clear();
      cellSelection = null;
    }
    document.body.classList.add('is-selecting-cells');
    selectionScrollFrame = requestAnimationFrame(scrollSelection);
  }
  event.preventDefault();
  applyDragSelection(document.elementFromPoint(event.clientX, event.clientY));
});
document.addEventListener('pointerup', stopSelectionDrag);
document.addEventListener('pointercancel', stopSelectionDrag);
window.addEventListener('blur', stopSelectionDrag);

elements.table.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('[data-move-column]');
  if (!handle) { event.preventDefault(); return; }
  movingColumn = Number(handle.dataset.moveColumn);
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(movingColumn));
  closePopovers();
});
elements.table.addEventListener('dragover', (event) => {
  if (movingColumn < 0) return;
  const heading = event.target.closest('th[data-column]');
  if (!heading) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  elements.tableHead.querySelectorAll('.is-column-drop-target').forEach((item) => item.classList.remove('is-column-drop-target'));
  heading.classList.add('is-column-drop-target');
});
elements.table.addEventListener('drop', (event) => {
  const heading = event.target.closest('th[data-column]');
  if (movingColumn < 0 || !heading) return;
  event.preventDefault();
  moveColumn(movingColumn, Number(heading.dataset.column));
  movingColumn = -1;
});
elements.table.addEventListener('dragend', () => {
  movingColumn = -1;
  elements.tableHead.querySelectorAll('.is-column-drop-target').forEach((item) => item.classList.remove('is-column-drop-target'));
});
elements.table.addEventListener('keydown', (event) => {
  const handle = event.target.closest('[data-move-column]');
  if (!handle || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const column = Number(handle.dataset.moveColumn);
  const to = column + (event.key === 'ArrowRight' ? 1 : -1);
  moveColumn(column, to);
  elements.tableHead.querySelector(`[data-move-column="${Math.max(0, Math.min(to, sheet.headers.length - 1))}"]`)?.focus();
});

elements.table.addEventListener('click', (event) => {
  if (suppressSelectionClick) {
    suppressSelectionClick = false;
    event.preventDefault();
    return;
  }
  if (event.target.closest('[data-move-column]')) return;
  const filterButton = event.target.closest('[data-filter-toggle]');
  if (filterButton) {
    openFilterPopover(Number(filterButton.dataset.filterToggle), filterButton);
    return;
  }

  const sortButton = event.target.closest('[data-sort]');
  if (sortButton) {
    cellSelection = null;
    selectedRows.clear();
    const column = Number(sortButton.dataset.sort);
    if (event.ctrlKey || event.metaKey) {
      if (selectedColumns.has(column)) selectedColumns.delete(column);
      else selectedColumns.add(column);
      selectedColumn = selectedColumns.has(column) ? column : (selectedColumns.values().next().value ?? -1);
      renderTable();
      return;
    }
    const now = performance.now();
    const isDoubleClick = lastSortClick.column === column && now - lastSortClick.time < 450;
    lastSortClick = { column, time: isDoubleClick ? 0 : now };
    if (isDoubleClick) {
      if (sortState?.column === column) sortState = null;
      selectedColumns.clear();
      selectedColumn = -1;
      renderTable();
      return;
    }
    selectedColumns.clear();
    selectedColumn = -1;
    const direction = Number(sortButton.dataset.sortDirection);
    sortState = Number.isFinite(direction) && direction !== 0
      ? { column, direction }
      : (sortState?.column === column ? { column, direction: sortState.direction * -1 } : { column, direction: 1 });
    renderTable();
    return;
  }

  const rowCheckbox = event.target.closest('[data-select-row]');
  if (rowCheckbox) {
    cellSelection = null;
    selectedColumns.clear();
    selectedColumn = -1;
    const rowId = Number(rowCheckbox.dataset.selectRow);
    if (rowCheckbox.checked) selectedRows.add(rowId);
    else selectedRows.delete(rowId);
    refreshSelection();
    return;
  }

  if (event.target.id === 'select-visible-rows') {
    cellSelection = null;
    selectedColumns.clear();
    selectedColumn = -1;
    visibleRows.forEach((row) => {
      if (event.target.checked) selectedRows.add(row.id);
      else selectedRows.delete(row.id);
    });
    renderTable();
    return;
  }

  const heading = event.target.closest('th[data-column]');
  if (heading && !event.target.closest('button, [data-resize-column]')) {
    cellSelection = null;
    selectedRows.clear();
    const column = Number(heading.dataset.column);
    if (event.ctrlKey || event.metaKey) {
      if (selectedColumns.has(column)) selectedColumns.delete(column);
      else selectedColumns.add(column);
    } else {
      selectedColumns.clear();
      selectedColumns.add(column);
    }
    selectedColumn = selectedColumns.has(column) ? column : (selectedColumns.values().next().value ?? -1);
    renderTable();
    return;
  }
  const cell = event.target.closest('[data-row-id][data-column]');
  if (cell && selectedColumns.size && !event.ctrlKey && !event.metaKey) {
    selectedColumns.clear();
    selectedColumn = -1;
    renderTable();
  }
});

elements.table.addEventListener('contextmenu', (event) => {
  const cell = event.target.closest('[data-row-id][data-column]');
  const heading = event.target.closest('th[data-column]');
  const rowHeading = event.target.closest('.row-number-cell');
  const target = cell || heading || rowHeading;
  if (!target) return;
  event.preventDefault();
  const column = target.dataset.column === undefined ? -1 : Number(target.dataset.column);
  const rowId = cell ? Number(cell.dataset.rowId) : null;
  const rowHeaderId = rowHeading ? Number(rowHeading.querySelector('[data-select-row]')?.dataset.selectRow || rowHeading.textContent.trim()) : null;
  openContextPopover(column, rowId ?? rowHeaderId, cell ? 'cell' : (rowHeading ? 'row' : 'column'), event.clientX, event.clientY);
});

elements.table.addEventListener('dblclick', (event) => {
  const resizeHandle = event.target.closest('[data-resize-column]');
  if (resizeHandle) {
    const column = Number(resizeHandle.dataset.resizeColumn);
    columnWidthOverrides[column] = null;
    persistViewState();
    renderTable();
    return;
  }
  const heading = event.target.closest('th[data-column]');
  if (heading) {
    if (!event.target.closest('[data-move-column]') && sortState?.column === Number(heading.dataset.column)) { sortState = null; renderTable(); }
    return;
  }
  const cell = event.target.closest('[data-row-id][data-column]');
  if (cell) beginCellEdit(cell);
});

elements.table.addEventListener('keydown', (event) => {
  const resizeHandle = event.target.closest('[data-resize-column]');
  if (resizeHandle && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const column = Number(resizeHandle.dataset.resizeColumn);
    const header = elements.tableHead.querySelector('th[data-column="' + column + '"]');
    const currentWidth = header?.getBoundingClientRect().width || 120;
    applyColumnWidth(column, currentWidth + (event.key === 'ArrowRight' ? 12 : -12));
    persistViewState();
    return;
  }
  const cell = event.target.closest('[data-row-id][data-column]');
  if (cell && event.target === cell && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const rowId = Number(cell.dataset.rowId);
    const column = Number(cell.dataset.column);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      focusNeighbor(rowId, column, event.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
      const neighbor = visibleRows[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)];
      if (neighbor) focusCell(neighbor.id, column);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusCell(rowId, event.key === 'Home' ? 0 : sheet.headers.length - 1);
      return;
    }
  }
  if (cell && event.target === cell && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    const row = sheet.rows.find((item) => item.id === Number(cell.dataset.rowId));
    const column = Number(cell.dataset.column);
    const selected = cellSelection || selectedRows.size || selectedColumns.size ? selectionText() : row?.cells[column] ?? '';
    if (row) vscode.postMessage({ type: 'copyToClipboard', text: selected });
    return;
  }
  if (cell && event.target === cell && (event.key === 'Enter' || event.key === 'F2')) {
    event.preventDefault();
    beginCellEdit(cell);
  }
});

elements.filterInput.addEventListener('input', () => {
  if (filterDraft) {
    renderFilterValues();
    applyFilterSelection();
  }
});

elements.delimiter.addEventListener('change', () => {
  sheet.delimiter = elements.delimiter.value === 'tab' ? '\t' : elements.delimiter.value;
  closePopovers();
  sendEdit();
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.popover, #settings-button, #add-column, #replace-values, #export-button, [data-filter-toggle]')) return;
  if (activePopover) closePopovers();
});

document.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  const column = activeColumn;
  const target = contextTarget;

  if (action === 'reset-column-widths') resetColumnWidths();
  else if (action === 'export-csv' || action === 'export-pdf') void exportTable(action === 'export-csv' ? 'csv' : 'pdf');
  else if (action === 'clear-filters') clearFilters();
  else if (action === 'clear-sort') clearSort();
  else if (action === 'open-text') {
    closePopovers();
    vscode.postMessage({ type: 'openAsText' });
  } else if (action === 'replace-values') {
    openReplaceValuesDialog();
  } else if (action === 'open-project') {
    closePopovers(true);
    vscode.postMessage({ type: 'openProject' });
  } else if (action === 'open-feature-request') {
    closePopovers(true);
    vscode.postMessage({ type: 'openFeatureRequest' });
  } else if (action === 'clear-column-filter' && column >= 0) {
    columnFilters[column] = null;
    elements.filterInput.value = '';
    filterDraft = new Set(filterGlobalValues);
    renderFilterValues();
    elements.filterPopover.querySelector('[data-action="clear-column-filter"]').disabled = true;
    renderTable();
  } else if ((action === 'copy-cell' || action === 'copy-row') && target?.kind === 'cell') {
    const row = sheet.rows.find((item) => item.id === target.rowId);
    if (!row) return;
    const copiedText = action === 'copy-cell'
      ? (row.cells[target.column] ?? '')
      : row.cells.map((value) => escapeCell(value, '\t')).join('\t');
    closePopovers();
    vscode.postMessage({ type: 'copyToClipboard', text: copiedText });
  } else if (action === 'copy-row-list' && (target?.kind === 'row' || target?.kind === 'cell')) {
    const row = sheet.rows.find((item) => item.id === target.rowId);
    if (!row) return;
    closePopovers();
    vscode.postMessage({ type: 'copyToClipboard', text: row.cells.map((value) => String(value ?? '')).join('\n') });
  } else if (action === 'copy-column-list' && column >= 0) {
    const values = [sheet.headers[column] || 'Column ' + (column + 1)];
    visibleRows.forEach((row) => values.push(String(row.cells[column] ?? '')));
    closePopovers();
    vscode.postMessage({ type: 'copyToClipboard', text: values.join('\n') });
  } else if (action === 'select-column' && column >= 0) {
    selectedRows.clear();
    cellSelection = null;
    if (selectedColumns.has(column)) selectedColumns.delete(column);
    else selectedColumns.add(column);
    selectedColumn = selectedColumns.has(column) ? column : (selectedColumns.values().next().value ?? -1);
    closePopovers();
    renderTable();
  } else if (action === 'clear-sort-column' && column >= 0) {
    if (sortState?.column === column) sortState = null;
    closePopovers();
    renderTable();
  } else if (action === 'clear-sort' && sortState) {
    sortState = null;
    closePopovers();
    renderTable();
  } else if (action === 'fit-column-width' && column >= 0) {
    (selectedColumns.has(column) ? [...selectedColumns] : [column]).forEach((item) => { columnWidthOverrides[item] = null; });
    persistViewState();
    closePopovers();
    renderTable();
  } else if (action === 'filter-column' && column >= 0) {
    const filterButton = elements.tableHead.querySelector(`th[data-column="${column}"] [data-filter-toggle]`);
    closePopovers();
    if (filterButton) openFilterPopover(column, filterButton);
  } else if (action === 'filter-value' && target?.kind === 'cell') {
    const row = sheet.rows.find((item) => item.id === target.rowId);
    if (!row) return;
    columnFilters[target.column] = { query: '', values: new Set([String(row.cells[target.column] ?? '')]) };
    closePopovers();
    renderTable();
  } else if ((action === 'sort-ascending' || action === 'sort-descending') && target) {
    sortState = { column: target.column, direction: action === 'sort-ascending' ? 1 : -1 };
    closePopovers();
    renderTable();
  } else if (action === 'rename-column' && column >= 0) {
    void renameColumn(column);
  } else if (action === 'move-column-left' && column >= 0) {
    moveColumn(column, column - 1);
  } else if (action === 'move-column-right' && column >= 0) {
    moveColumn(column, column + 1);
  } else if (action === 'delete-column' && column >= 0) {
    void deleteColumn(column);
  }
});

elements.tableScroll.addEventListener('scroll', () => {
  positionHeaderIcons();
  if (activePopover) closePopovers();
  scheduleVirtualRowRender();
}, { passive: true });

window.addEventListener('resize', () => {
  updateTableWidth();
  scheduleVirtualRowRender();
  if (activePopover) closePopovers();
});

new ResizeObserver(() => {
  if (documentLoaded) updateTableWidth();
}).observe(elements.tableScroll);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (activePopover) {
      event.preventDefault();
      closePopovers(true);
    }
    if (selectedColumns.size || selectedRows.size || cellSelection) {
      event.preventDefault();
      stopSelectionDrag();
      selectedRows.clear();
      cellSelection = null;
      selectedColumns.clear();
      selectedColumn = -1;
      renderTable();
    }
  }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'exportFinished') {
    exportInProgress = false;
    updateToolbar();
  }
  if (message.type === 'clipboardText' && message.requestId === pendingClipboardRequest && typeof message.text === 'string') {
    pendingClipboardRequest = null;
    elements.pasteTable.disabled = false;
    pasteTable(message.text);
  }
  if ((message.type === 'load' || message.type === 'editRejected') && typeof message.text === 'string') setDocument(message.text, message.filename);
  if (message.type === 'tablePreferences') applyTablePreferences(message.preferences);
  if (message.type === 'defaultEditorPreference' && typeof message.enabled === 'boolean') {
    elements.openByDefault.checked = message.enabled;
    elements.openByDefault.disabled = false;
  }
});

vscode.postMessage({ type: 'ready' });
