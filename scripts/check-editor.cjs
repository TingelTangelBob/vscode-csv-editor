// Use a locally installed Playwright, or pass the path to an existing module.
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { PDFDocument } = require('../media/pdf/pdf-lib.min.js');
const root = process.env.CSV_EDITOR_ROOT || require('node:path').resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
  const page = await browser.newPage({viewport:{width:1000,height:600}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(fs.readFileSync(root+'/media/index.html','utf8').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,''));
  await page.evaluate(() => { window.messages=[]; window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>messages.push(m)}); });
  await page.addStyleTag({path:root+'/media/editor.css'});
  await page.addStyleTag({content:fs.readFileSync(root+'/media/codicon.css','utf8').replace('./codicon.ttf', 'data:font/ttf;base64,'+fs.readFileSync(root+'/media/codicon.ttf').toString('base64'))});
  await page.addStyleTag({content:'@font-face{font-family:material-product-icons;src:url(data:font/woff;base64,'+fs.readFileSync(root+'/media/material-icons.woff').toString('base64')+')}'});
  await page.addScriptTag({path:root+'/media/csv.js'});
  await page.route('http://csv-assets.local/**', route=>{
    const filename=new URL(route.request().url()).pathname;
    if(!/^\/(?:pdf\/)?[\w.-]+$/.test(filename)) return route.abort();
    return route.fulfill({path:root+'/media'+filename,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.addScriptTag({url:'http://csv-assets.local/export.js'});
  await page.addScriptTag({path:root+'/media/editor.js'});
  const load = async text => page.evaluate(text=>setDocument(text,'test.csv'), text);
  const cell = (r,c)=>page.locator(`.data-cell[data-row-id="${r}"][data-column="${c}"]`);
  const drag = async (from,to) => {
    const a=await from.boundingBox(), b=await to.boundingBox();
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});
    await page.mouse.up();
  };
  await load('Name,Age,City\nZoe,31,Berlin\nAmy,22,Bonn\nJoe,40,Essen');
  assert.equal(await page.locator('[data-move-column="0"]').isVisible(),false);
  await page.locator('th[data-column="0"]').hover();
  assert.equal(await page.locator('[data-move-column="0"]').isVisible(),true);
  assert.equal(await page.locator('[data-move-column="1"]').isVisible(),false);
  await cell(1,0).hover();
  assert.equal(await page.locator('[data-move-column="0"]').isVisible(),false);
  await page.locator('th[data-column="0"] .sort-direction').first().focus();
  assert.equal(await page.locator('[data-move-column="0"]').isVisible(),true);
  await page.evaluate(()=>document.activeElement.blur());
  const originalCsv=await page.evaluate(()=>serializeCsv(sheet));
  await page.evaluate(()=>pasteTable('Name,Age,City\nBob,23,Paris',false));
  assert.equal(await page.locator('#import-dialog').isVisible(),true);
  const dialogBox=await page.locator('#import-dialog').boundingBox();
  await page.mouse.click(dialogBox.x+4,dialogBox.y+4);
  assert.equal(await page.locator('#import-dialog').isVisible(),true);
  await page.locator('#import-text').click();
  assert.equal(await page.locator('#import-dialog').isVisible(),true);
  await page.mouse.click(2,2);
  assert.equal(await page.locator('#import-dialog').isVisible(),false);
  assert.equal(await page.evaluate(()=>serializeCsv(sheet)),originalCsv);
  assert.equal(await page.locator('.toolbar-divider:visible').count(),4);
  await page.locator('#export-button').click();
  assert.equal(await page.locator('#export-popover').isVisible(),true);
  assert.equal(await page.locator('#export-button').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#export-popover button:focus').textContent(),'CSV');
  const exportBox=await page.locator('#export-popover').boundingBox();
  assert.ok(exportBox.width<120,JSON.stringify(exportBox));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#export-popover').isVisible(),false);
  assert.equal(await page.locator('#export-button:focus').count(),1);
  await page.locator('#export-button').click();
  await page.locator('#export-button').click();
  assert.equal(await page.locator('#export-popover').isVisible(),false);
  await page.locator('#export-button').click();
  await page.locator('#settings-button').click();
  assert.equal(await page.locator('#export-popover').isVisible(),false);
  assert.equal(await page.locator('#settings-popover [data-action^="export-"]').count(),0);
  await page.keyboard.press('Escape');
  await drag(cell(1,0),cell(3,1));
  assert.equal(await page.locator('.is-cell-selected').count(),6);
  assert.equal(await page.locator('tbody tr.is-cell-guide-row').count(),3);
  assert.equal(await page.locator('thead th.is-cell-guide-column').count(),2);
  await page.keyboard.press('Control+c');
  assert.equal(await page.evaluate(()=>messages.at(-1).text),'Zoe\t31\nAmy\t22\nJoe\t40');
  await cell(2,2).click();
  assert.equal(await page.locator('.is-cell-selected').count(),1);
  await page.mouse.move(2,2);
  assert.equal(await page.locator('tbody tr.is-cell-guide-row').count(),1);
  assert.equal(await page.locator('thead th.is-cell-guide-column').count(),1);
  assert.equal(await page.locator('thead th[data-column="2"].is-cell-guide-column').count(),1);
  for (const locator of [cell(2,0), cell(1,2), page.locator('[data-row-header="2"]'), page.locator('th[data-column="2"]')]) {
    assert.match(await locator.evaluate(element=>getComputedStyle(element).backgroundImage),/linear-gradient/);
  }
  assert.equal(await cell(1,0).evaluate(element=>getComputedStyle(element).backgroundImage),'none');
  assert.equal(await cell(2,2).evaluate(element=>getComputedStyle(element).backgroundImage),'none');
  if(process.env.CSV_SELECTION_PREVIEW_DIR) await page.locator('#csv-table').screenshot({path:require('node:path').join(process.env.CSV_SELECTION_PREVIEW_DIR,'csv-selection-light.png')});
  const previousTheme=await page.evaluate(()=>document.body.dataset.theme);
  await page.evaluate(()=>document.body.dataset.theme='dark');
  assert.match(await cell(2,0).evaluate(element=>getComputedStyle(element).backgroundImage),/linear-gradient/);
  if(process.env.CSV_SELECTION_PREVIEW_DIR) await page.locator('#csv-table').screenshot({path:require('node:path').join(process.env.CSV_SELECTION_PREVIEW_DIR,'csv-selection-dark.png')});
  await page.evaluate(theme=>document.body.dataset.theme=theme,previousTheme);
  await cell(2,2).dblclick();
  assert.equal(await page.locator('.cell-editor').count(),1);
  await page.keyboard.press('Escape');
  // A click after editing must save the old editor and select the new range.
  await cell(1,0).dblclick();
  await page.locator('.cell-editor').fill('Zoe edited');
  await drag(cell(2,0),cell(3,1));
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>sheet.rows[0].cells[0]),'Zoe edited');
  assert.equal(await page.locator('.is-cell-selected').count(),4);
  await page.evaluate(()=>sheet.rows[0].cells[0]='Zoe');
  await drag(page.locator('[data-row-header="1"]'),page.locator('[data-row-header="3"]'));
  assert.deepEqual(await page.evaluate(()=>[...selectedRows]),[1,2,3]);
  assert.equal(await page.locator('.is-cell-guide-row, .is-cell-guide-column').count(),0);
  await page.keyboard.press('Control+c');
  assert.equal(await page.evaluate(()=>messages.at(-1).text),'Zoe\t31\tBerlin\nAmy\t22\tBonn\nJoe\t40\tEssen');
  await page.keyboard.press('Escape');
  await drag(page.locator('th[data-column="0"] .column-title'),page.locator('th[data-column="2"] .column-title'));
  assert.deepEqual(await page.evaluate(()=>[...selectedColumns]),[0,1,2]);
  assert.equal(await page.evaluate(()=>sortState),null);
  await page.locator('th[data-column="0"]').hover();
  await page.locator('[data-sort="0"]').first().click();
  assert.deepEqual(await page.evaluate(()=>visibleRows.map(r=>r.id)),[2,3,1]);
  await drag(page.locator('[data-row-header="2"]'),page.locator('[data-row-header="3"]'));
  assert.deepEqual(await page.evaluate(()=>[...selectedRows]),[2,3]);
  await page.evaluate(()=>{columnFilters[2]={values:new Set(['Bonn','Berlin'])}; columnWidthOverrides=[111,122,133]; selectedColumns.clear();selectedColumns.add(2);renderTable();});
  await page.locator('th[data-column="2"]').hover();
  await page.locator('[data-move-column="2"]').dragTo(page.locator('th[data-column="0"]'));
  assert.deepEqual(await page.evaluate(()=>sheet.headers),['City','Name','Age']);
  assert.deepEqual(await page.evaluate(()=>sheet.rows[0].cells),['Berlin','Zoe','31']);
  assert.equal(await page.evaluate(()=>sortState.column),1);
  assert.deepEqual(await page.evaluate(()=>columnWidthOverrides),[133,111,122]);
  assert.deepEqual(await page.evaluate(()=>[...selectedColumns]),[0]);
  assert.deepEqual(await page.evaluate(()=>visibleRows.map(r=>r.id)),[2,1]);
  await page.locator('[data-move-column="0"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(()=>sheet.headers),['Name','City','Age']);
  await page.evaluate(()=>addColumn(0,'New'));
  assert.equal(await page.evaluate(()=>sortState.column),1);
  assert.equal(await page.evaluate(()=>columnFilters[2].values.has('Bonn')),true);
  assert.equal(await page.evaluate(()=>columnWidthOverrides[2]),133);
  await page.evaluate(()=>exportTable('csv'));
  assert.equal(await page.evaluate(()=>messages.at(-1).text),'New,Name,City,Age\n,Amy,Bonn,22\n,Zoe,Berlin,31');
  assert.equal(await page.evaluate(()=>exportInProgress),true);
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'exportFinished'}})));
  await page.locator('#export-button').click();
  await page.locator('#export-popover [data-action="export-pdf"]').click();
  await page.waitForFunction(()=>messages.at(-1).type==='exportTable' && messages.at(-1).format==='pdf');
  assert.equal(await page.locator('#export-popover').isVisible(),false);
  const pdf = Buffer.from(await page.evaluate(()=>messages.at(-1).base64),'base64');
  assert.ok(pdf.toString('ascii').startsWith('%PDF-1.7'));
  assert.equal((await PDFDocument.load(pdf)).getPageCount(),1);
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'exportFinished'}})));
  // Exercise horizontal and vertical pagination, multiline text and Unicode.
  const widePdf = Buffer.from(await page.evaluate(async()=>{
    const headers=Array.from({length:24},(_,i)=>'Column '+i);
    const rows=Array.from({length:60},(_,i)=>({cells:headers.map((_,c)=>`${i}/${c} ÄÖÜ 東京 `+'longword'.repeat(i===0?60:2))}));
    const bytes=await CsvExport.createTablePdf(headers,rows,'Wide table');
    return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
  }),'base64');
  assert.ok((await PDFDocument.load(widePdf)).getPageCount()>3);
  if(process.env.CSV_EDITOR_PDF_ARTIFACT) fs.writeFileSync(process.env.CSV_EDITOR_PDF_ARTIFACT,widePdf);
  await page.evaluate(()=>{columnFilters[1]={values:new Set()};renderTable();});
  await page.evaluate(()=>exportTable('csv'));
  assert.equal(await page.evaluate(()=>messages.at(-1).text),'New,Name,City,Age');
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'exportFinished'}})));
  await page.evaluate(()=>exportTable('pdf'));
  const emptyPdf=Buffer.from(await page.evaluate(()=>messages.at(-1).base64),'base64');
  assert.equal((await PDFDocument.load(emptyPdf)).getPageCount(),1);
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'exportFinished'}})));
  await page.locator('#settings-button').click();
  await page.locator('#settings-popover').evaluate(async (element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const switcher=await page.locator('#appearance-switcher').boundingBox();
  const setting=await page.locator('.language-setting').boundingBox();
  assert.ok(Math.abs(switcher.x-(setting.x+8))<1);
  assert.ok(Math.abs(switcher.width-(setting.width-16))<1, JSON.stringify({switcher,setting}));
  await page.keyboard.press('Escape');
  await load('A,B,C\n'+Array.from({length:2000},(_,i)=>`${i},b${i},c${i}`).join('\n'));
  await page.evaluate(()=>elements.tableScroll.scrollTop=0);
  await drag(cell(1,0),cell(5,1));
  assert.equal(await page.evaluate(()=>cellSelection.rowIds.size),5);
  const a=await cell(1,0).boundingBox();
  const rect=await page.locator('#table-scroll').boundingBox();
  await page.mouse.move(a.x+15,a.y+10); await page.mouse.down();
  await page.mouse.move(a.x+50,rect.y+rect.height-3,{steps:10});
  await page.waitForTimeout(500); await page.mouse.up();
  assert.ok(await page.evaluate(()=>cellSelection.rowIds.size)>18);
  await page.evaluate(()=>focusCell(1200,1));
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.rowId),'1200');
  assert.equal(await page.locator('.is-cell-selected').count(),0);
  assert.equal(await page.locator('tbody tr.is-cell-guide-row').count(),0);
  assert.ok(await page.locator('tbody td.is-cell-guide-column').count()>0);
  // Export must include matching virtual rows that were never rendered.
  await page.evaluate(()=>{columnFilters[0]={query:'19'};sortState={column:0,direction:-1};renderTable();});
  const expectedExport=await page.evaluate(()=>serializeCsv({...sheet,rows:getVisibleRows()}));
  await page.locator('#export-button').click();
  await page.locator('#export-popover [data-action="export-csv"]').click();
  assert.equal(await page.evaluate(()=>messages.at(-1).text),expectedExport);
  assert.ok(await page.evaluate(()=>getVisibleRows().length)>20);
  assert.equal(await page.locator('#export-button').isDisabled(),true);
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'exportFinished'}})));
  for(const width of [320,420,1000]) {
    await page.setViewportSize({width,height:600});
    assert.equal(await page.locator('.toolbar-divider:visible').count(),4);
    await page.locator('#export-button').click();
    await page.locator('#export-popover').evaluate(async element=>Promise.all(element.getAnimations().map(a=>a.finished)));
    const box=await page.locator('#export-popover').boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=width);
    const toolbar=await page.locator('.toolbar-actions').boundingBox();
    assert.ok(toolbar.x>=0 && toolbar.x+toolbar.width<=width);
    await page.locator('#table-status').click();
    assert.equal(await page.locator('#export-popover').isVisible(),false);
  }
  // Header titles align with cell values; arrows have their own vertical space.
  await page.evaluate(()=>{responsiveColumns=false;sortState=null;sheet.headers[0]='Region gyp';columnWidthOverrides=[180,220,200];renderTable();positionHeaderIcons();elements.tableScroll.scrollLeft=0;elements.tableScroll.scrollTop=0;});
  const heading=page.locator('th[data-column="0"]');
  await heading.hover();
  const metrics=await heading.evaluate(header=>{
    const name=header.querySelector('.column-title > span').getBoundingClientRect();
    const rect=header.getBoundingClientRect();
    const filter=header.querySelector('.filter-button').getBoundingClientRect();
    const grip=header.querySelector('.column-move-handle').getBoundingClientRect();
    const up=header.querySelector('[data-sort-direction="1"]').getBoundingClientRect();
    const down=header.querySelector('[data-sort-direction="-1"]').getBoundingClientRect();
    return {left:name.left-rect.left,filterGap:rect.right-filter.right,upGap:name.top-up.bottom,downGap:down.top-name.bottom,
      textHeight:name.height,upBorder:up.top-rect.top,downBorder:rect.bottom-down.bottom,
      controlsAligned:Math.abs(grip.left-filter.left)<1 && grip.width===filter.width && grip.height===filter.height,
      topGap:grip.top-rect.top,bottomGap:rect.bottom-filter.bottom,
      sameIconSize:getComputedStyle(header.querySelector('.column-move-handle .codicon')).fontSize===getComputedStyle(header.querySelector('.filter-button .codicon')).fontSize};
  });
  assert.ok(Math.abs(metrics.left-9)<1,JSON.stringify(metrics));
  assert.ok(metrics.filterGap>=5 && metrics.filterGap<=8,JSON.stringify(metrics));
  assert.ok(metrics.upGap>=1 && metrics.downGap>=1,JSON.stringify(metrics));
  assert.ok(metrics.textHeight>=16 && metrics.upBorder<=1 && metrics.downBorder<=1,JSON.stringify(metrics));
  assert.ok(metrics.controlsAligned && metrics.sameIconSize,JSON.stringify(metrics));
  assert.ok(Math.abs(metrics.topGap-metrics.bottomGap)<=1,JSON.stringify(metrics));
  await heading.locator('.column-title').click();
  assert.equal(await page.evaluate(()=>sortState),null);
  await heading.locator('.sort-direction[data-sort-direction="1"]').hover();
  assert.ok(await heading.locator('.sort-direction[data-sort-direction="1"]').evaluate(element =>
    getComputedStyle(element, '::before').backgroundImage.includes('linear-gradient') &&
    getComputedStyle(element, '::before').opacity === '1'));
  if(process.env.CSV_EDITOR_SORT_PREVIEW_DIR) await page.locator('thead').screenshot({path:require('node:path').join(process.env.CSV_EDITOR_SORT_PREVIEW_DIR,'csv-sort-up-preview.png')});
  await heading.locator('.sort-direction[data-sort-direction="1"]').click();
  assert.deepEqual(await page.evaluate(()=>sortState),{column:0,direction:1});
  await heading.locator('.column-title').dblclick();
  assert.deepEqual(await page.evaluate(()=>sortState),{column:0,direction:1});
  await heading.click({position:{x:120,y:3}});
  await heading.click({position:{x:120,y:39}});
  assert.deepEqual(await page.evaluate(()=>sortState),{column:0,direction:1});
  await heading.locator('.sort-direction[data-sort-direction="-1"]').hover();
  assert.ok(await heading.locator('.sort-direction[data-sort-direction="-1"]').evaluate(element =>
    getComputedStyle(element, '::before').opacity === '1'));
  if(process.env.CSV_EDITOR_SORT_PREVIEW_DIR) await page.locator('thead').screenshot({path:require('node:path').join(process.env.CSV_EDITOR_SORT_PREVIEW_DIR,'csv-sort-down-preview.png')});
  await heading.locator('.sort-direction[data-sort-direction="-1"]').click();
  assert.deepEqual(await page.evaluate(()=>sortState),{column:0,direction:-1});
  await heading.locator('.sort-direction[data-sort-direction="-1"]').dblclick();
  assert.deepEqual(await page.evaluate(()=>sortState),{column:0,direction:-1});
  await heading.locator('.sort-direction[data-sort-direction="1"]').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>sortState),{column:0,direction:1});
  if(process.env.CSV_EDITOR_HEADER_ARTIFACT) {
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('thead').screenshot({path:process.env.CSV_EDITOR_HEADER_ARTIFACT});
  }
  // A partially clipped normal header pins its filter to the viewport edge.
  await page.evaluate(()=>{columnWidthOverrides=[400,400,400];renderTable();elements.tableScroll.scrollLeft=200;positionHeaderIcons();});
  const secondFilter=await page.locator('th[data-column="1"] .filter-button').boundingBox();
  const viewport=await page.locator('#table-scroll').boundingBox();
  assert.ok(secondFilter.x+secondFilter.width<=viewport.x+viewport.width);
  // Wide columns keep the filter close to their title, then visible after scrolling.
  await page.evaluate(()=>{columnWidthOverrides=[1400,180,180];renderTable();elements.tableScroll.scrollLeft=0;positionHeaderIcons();});
  assert.ok(await heading.evaluate(header=>{
    const name=header.querySelector('.column-title > span').getBoundingClientRect();
    return header.querySelector('.filter-button').getBoundingClientRect().left-name.right<12;
  }));
  await page.evaluate(()=>{elements.tableScroll.scrollLeft=500;positionHeaderIcons();});
  assert.ok(await heading.evaluate(header=>{
    const filter=header.querySelector('.filter-button').getBoundingClientRect();
    const numbers=document.querySelector('.row-number-head').getBoundingClientRect();
    return filter.left>=numbers.right && filter.right<window.innerWidth;
  }));
  // A narrow heading uses all available space until its right-hand controls appear.
  await page.mouse.move(1,1);
  await page.evaluate(()=>{
    document.activeElement.blur();
    sheet.headers[0]='Enabled'; columnFilters=[null,null,null]; sortState=null;
    columnWidthOverrides=[70,220,200]; elements.tableScroll.scrollLeft=0; renderTable(); positionHeaderIcons();
  });
  const titleFits = () => heading.locator('.column-title > span').evaluate(element => element.scrollWidth <= element.clientWidth);
  assert.equal(await titleFits(),true,'The unhovered heading should use the space occupied by hidden controls.');
  await heading.hover();
  assert.equal(await titleFits(),false,'The hovered heading should make room for visible controls.');
  assert.equal(await heading.locator('.filter-button').isVisible(),true);
  await page.mouse.move(1,1);
  assert.equal(await titleFits(),true,'The full title should return when the pointer leaves.');
  await heading.locator('.sort-direction').first().focus();
  assert.equal(await titleFits(),false,'Keyboard focus should reserve space for visible controls.');
  await page.evaluate(()=>document.activeElement.blur());
  assert.equal(await titleFits(),true);
  await page.evaluate(()=>{columnFilters[0]={query:'x',values:null};renderTable();positionHeaderIcons();});
  assert.equal(await heading.locator('.filter-button').isVisible(),true);
  assert.equal(await titleFits(),false,'An active filter remains visible outside hover.');
  await page.evaluate(()=>document.body.classList.add('is-resizing-column'));
  assert.equal(await titleFits(),true,'Hidden controls must not reserve space during resizing.');
  await page.evaluate(()=>{document.body.classList.remove('is-resizing-column');columnFilters[0]=null;renderTable();document.body.classList.add('vscode-high-contrast');positionHeaderIcons();});
  assert.equal(await titleFits(),false,'High contrast mode keeps the filter control visible.');
  await page.evaluate(()=>document.body.classList.remove('vscode-high-contrast'));
  assert.deepEqual(errors,[]);
  // Reopen a small file in a fresh webview with the state the extension saved.
  async function openRememberedView(text, fileView = null, canRememberFileView = true) {
    const viewPage = await browser.newPage({viewport:{width:1000,height:600}});
    const origin = 'http://csv-view.local';
    await viewPage.route(`${origin}/**`, route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!/^[\w.-]+$/.test(name)) return route.abort();
      if (name !== 'index.html') return route.fulfill({path:root+'/media/'+name});
      const html = fs.readFileSync(root+'/media/index.html','utf8')
        .replaceAll('{{CSP_SOURCE}}',origin).replaceAll('{{NONCE}}','view-test')
        .replaceAll('{{VERSION}}','test').replaceAll('{{CODICON_STYLESHEET_URI}}',origin+'/codicon.css')
        .replaceAll('{{STYLESHEET_URI}}',origin+'/editor.css').replaceAll('{{CSV_SCRIPT_URI}}',origin+'/csv.js')
        .replaceAll('{{EXPORT_SCRIPT_URI}}',origin+'/export.js').replaceAll('{{SCRIPT_URI}}',origin+'/editor.js');
      return route.fulfill({contentType:'text/html',body:html});
    });
    await viewPage.addInitScript(({text,fileView,canRememberFileView}) => {
      window.viewMessages = [];
      window.acquireVsCodeApi = () => ({getState:()=>({}),setState(){},postMessage(message){
        viewMessages.push(message);
        if (message.type === 'ready') setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
          data:{type:'load',filename:'sample.csv',text,fileView,canRememberFileView},
        })),0);
      }});
    }, {text,fileView,canRememberFileView});
    await viewPage.goto(origin);
    await viewPage.waitForFunction(()=>documentLoaded && !isLoadingDocument);
    return viewPage;
  }
  const sampleText = 'Name,City\nZoe,Berlin\nAmy,Bonn';
  const viewPage = await openRememberedView(sampleText);
  await viewPage.locator('#settings-button').click();
  await viewPage.locator('#remember-file-view').check();
  await viewPage.evaluate(()=>{
    columnWidthOverrides=[150,90];
    columnFilters=[{query:'amy',values:new Set(['Amy'])},null];
    sortState={column:1,direction:-1};
    renderTable();
  });
  const savedView = await viewPage.evaluate(()=>viewMessages.filter(message=>message.type==='saveFileView').at(-1).view);
  assert.equal(savedView.columns[0].width,150);
  assert.deepEqual(savedView.columns[0].filter.values,['Amy']);
  assert.deepEqual(savedView.sort,{name:'City',direction:-1});
  assert.ok(!await viewPage.evaluate(()=>viewMessages.some(message=>message.type==='edit')));
  await viewPage.close();
  const reopenedView = await openRememberedView('City,Name,New\nBerlin,Zoe,x\nBonn,Amy,y',savedView);
  assert.equal(await reopenedView.locator('#remember-file-view').isChecked(),true);
  assert.deepEqual(await reopenedView.evaluate(()=>columnWidthOverrides),[90,150,null]);
  assert.deepEqual(await reopenedView.evaluate(()=>sortState),{column:0,direction:-1});
  assert.deepEqual(await reopenedView.evaluate(()=>visibleRows.map(row=>row.cells[1])),['Amy']);
  await reopenedView.locator('#settings-button').click();
  await reopenedView.locator('[data-action="reset-file-view"]').click();
  assert.equal(await reopenedView.locator('#remember-file-view').isChecked(),false);
  assert.deepEqual(await reopenedView.evaluate(()=>columnWidthOverrides),[null,null,null]);
  assert.equal(await reopenedView.evaluate(()=>sortState),null);
  assert.equal(await reopenedView.evaluate(()=>visibleRows.length),2);
  assert.equal(await reopenedView.evaluate(()=>viewMessages.filter(message=>message.type==='saveFileView').at(-1).enabled),false);
  await reopenedView.close();
  const untitledView = await openRememberedView(sampleText,null,false);
  assert.equal(await untitledView.locator('#remember-file-view').isDisabled(),true);
  await untitledView.close();
  // Exercise the real webview CSP and lazy PDF resources as a separate page.
  const cspPage=await browser.newPage({viewport:{width:1000,height:600}});
  const origin='http://csv-offline.local';
  const requests=[];
  const cspErrors=[];
  cspPage.on('pageerror',error=>cspErrors.push(error.message));
  await cspPage.route('**/*',route=>{
    const url=new URL(route.request().url());
    requests.push(url.href);
    if(url.origin!==origin) return route.abort();
    const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!/^(?:pdf\/)?[\w.-]+$/.test(filename)) return route.abort();
    if(filename!=='index.html') return route.fulfill({path:root+'/media/'+filename});
    const html=fs.readFileSync(root+'/media/index.html','utf8')
      .replaceAll('{{CSP_SOURCE}}',origin).replaceAll('{{NONCE}}','pdf-regression')
      .replaceAll('{{VERSION}}','test').replaceAll('{{CODICON_STYLESHEET_URI}}',origin+'/codicon.css')
      .replaceAll('{{STYLESHEET_URI}}',origin+'/editor.css').replaceAll('{{CSV_SCRIPT_URI}}',origin+'/csv.js')
      .replaceAll('{{EXPORT_SCRIPT_URI}}',origin+'/export.js').replaceAll('{{SCRIPT_URI}}',origin+'/editor.js');
    return route.fulfill({contentType:'text/html',body:html});
  });
  await cspPage.addInitScript(()=>{
    window.messages=[];
    window.acquireVsCodeApi=()=>({getState:()=>({}),setState(){},postMessage(message){
      messages.push(message);
      if(message.type==='ready') setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{
        data:{type:'load',filename:'Export.csv',text:'Name,City\nÄnne,München 東京'},
      })),0);
    }});
  });
  await cspPage.goto(origin);
  await cspPage.waitForFunction(()=>documentLoaded);
  assert.ok(!requests.some(url=>url.includes('/pdf/')),'PDF assets must not load on editor startup.');
  await cspPage.locator('#export-button').click();
  await cspPage.locator('[data-action="export-pdf"]').click();
  await cspPage.waitForFunction(()=>messages.some(message=>message.type==='exportTable'||message.type==='showExportError'));
  const exportMessage=await cspPage.evaluate(()=>messages.at(-1));
  assert.equal(exportMessage.type,'exportTable',JSON.stringify(exportMessage));
  assert.equal((await PDFDocument.load(Buffer.from(exportMessage.base64,'base64'))).getPageCount(),1);
  assert.ok(requests.every(url=>url.startsWith(origin+'/')),'Export must use bundled resources only.');
  assert.deepEqual(cspErrors,[]);
  await cspPage.close();
  console.log('Browser checks passed: selection, copy, edit, sorting, filtered column moves, widths, insertion, virtual scrolling, CSV/PDF export, PDF pagination and appearance width.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
