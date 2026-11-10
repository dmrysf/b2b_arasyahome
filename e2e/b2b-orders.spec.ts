import {expect,test} from '@playwright/test';
import {mockApi,API} from './mock-api';
import { emptyLine, emptyOrder, orderFields } from '../src/orders/model';
const perms=['b2b.companies.view','b2b.orders.view','b2b.orders.create','b2b.orders.update','b2b.orders.manage_status'];
test('create-only access confirms the saved reference without revealing detail or offering a second submit',async({page})=>{
 const api=await mockApi(page,{loggedIn:true,permissions:['b2b.companies.view','b2b.orders.create']});
 const companyId=api.companies.seed({legalName:'Restricted Client SRL',taxIdentifier:'1234'});
 await page.goto(`/comenzi/noua?companyId=${companyId}`);
 await page.getByRole('button',{name:'Adaugă linie'}).click();
 await page.getByLabel('Cod produs 1',{exact:true}).fill('LIMITED');
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();
 await expect(page.getByText('Ciorna a fost creată. Nu aveți permisiunea de a vedea detaliile.')).toBeVisible();
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Salvează ciorna',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Crearea necesită permisiunea pentru comenzi și vizualizarea companiilor.'})).toHaveCount(0);
 expect(api.orders.orders).toHaveLength(1);
 expect(api.state.requests.some(r=>r.startsWith('GET /b2b/orders/'))).toBe(false);
});
test('classic order saves, finalizes, duplicates and shows exact server totals in both languages',async({page})=>{
 const api=await mockApi(page,{loggedIn:true,permissions:perms}); const companyId=api.companies.seed({legalName:'Client SRL',taxIdentifier:'1234'});
 await page.goto(`/comenzi/noua?companyId=${companyId}`);
 await expect(page.getByRole('heading',{name:'Comandă nouă'})).toBeVisible();
 await page.getByRole('button',{name:'Adaugă linie'}).click();
 await page.getByLabel('Cod produs 1',{exact:true}).fill('P1');
 await page.getByLabel('Cantitate 1',{exact:true}).fill('4');
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toHaveValue('P1');
 await expect(page.getByLabel('Cantitate 1',{exact:true})).toHaveValue('4');
 await page.getByLabel('Unitate de facturare 1').selectOption('meter');
 await page.getByLabel('Metri total 1').fill('13,5');
 await page.getByLabel('Preț unitar net 1').fill('10,00');
 await page.getByLabel('TVA % 1').fill('19');
 await expect(page.getByTestId('order-totals')).toContainText('160.65 RON');
 await expect(page.getByLabel('Monedă')).toBeDisabled();
 // The order type is an explicit choice, separate from the line kind; no type is preselected.
 await expect(page.getByTestId('order-type-badge')).toHaveText('Tip neales');
 await page.getByRole('radio',{name:/Doar debitare/}).check();
 await expect(page.getByTestId('order-type-badge')).toHaveText('Doar debitare');
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();
 await expect(page.getByRole('heading',{name:'B2B-ORD-000001'})).toBeVisible();
 await page.getByRole('button',{name:'Finalizează',exact:true}).click();
 await expect(page.getByTestId('confirm-order-type')).toContainText('Pregătire material → Livrare');
 await page.getByRole('button',{name:'Confirmă finalizarea'}).click();
 await expect(page.getByText('Finalizată',{exact:true}).first()).toBeVisible();
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Duplică în ciornă'}).click();
 await expect(page.getByRole('heading',{name:'B2B-ORD-000002'})).toBeVisible();
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toHaveValue('P1');
 await page.getByRole('button',{name:'TR — Türkçe'}).click();
 await expect(page.getByRole('button',{name:'Taslağı kaydet'})).toBeVisible();
 await page.getByRole('button',{name:'RO — Română'}).click();
 // On API 2.67.0 the order list shows the type of both orders (the duplicate keeps it).
 await page.getByRole('link',{name:'Comenzi',exact:true}).click();
 await expect(page.getByRole('link',{name:'B2B-ORD-000001'})).toBeVisible();
 await expect(page.getByTestId('order-list-type')).toHaveText(['Doar debitare','Doar debitare']);
 await page.getByRole('button',{name:'TR — Türkçe'}).click();
 expect(api.state.requests).toContain('POST /b2b/orders');
 expect(await page.evaluate(()=>[sessionStorage.length,Object.keys(localStorage)])).toEqual([0,['arasya.b2b.locale']]);
});
test('finance eligibility: the reasons, the refusal and the next owner are shown in RO and TR, also at 360 px',async({page})=>{
 const api=await mockApi(page,{loggedIn:true,permissions:perms});const companyId=api.companies.seed({legalName:'Synthetic Blocked SRL',taxIdentifier:'1234'});
 const reasons=['IDENTITY_NOT_VERIFIED','NO_APPROVED_LIMIT'];
 api.orders.finance.gate={configured:true,finalizationMode:'enforce',releaseMode:'enforce',preview:{phase:'finalization',mode:'enforce',outcome:'BLOCKED',reasons}};
 api.orders.finance.refuse=reasons;
 const order=api.orders.seed(orderFields({...emptyOrder(companyId),orderType:'CUT_ONLY',lines:[{...emptyLine(),productCode:'P1',quantity:'1',unitPriceNet:'10.00',vatPercent:'19'}]}));
 await page.goto(`/comenzi/${order.id}`);
 const panel=page.getByTestId('finance-panel');
 await expect(panel.getByRole('heading',{name:'Eligibilitate financiară'})).toBeVisible();
 await expect(page.getByTestId('finance-preview')).toHaveAttribute('data-outcome','BLOCKED');
 await expect(panel).toContainText('Comanda nu poate fi finalizată pe credit.');
 await expect(panel).toContainText('Identitatea companiei nu este verificată.');
 await expect(panel).toContainText('Compania nu are o limită de cumpărare aprobată.');
 await expect(panel).toContainText('Pasul următor aparține departamentului Financiar');
 await expect(panel).not.toContainText('IDENTITY_NOT_VERIFIED');
 // The server refuses; the screen explains the refusal and the order stays a draft.
 await page.getByRole('button',{name:'Finalizează',exact:true}).click();await page.getByRole('button',{name:'Confirmă finalizarea'}).click();
 await expect(page.getByRole('alert').filter({hasText:'Comanda nu poate fi finalizată pe credit. Nu a fost modificat nimic.'})).toContainText('Compania nu are o limită de cumpărare aprobată.');
 expect(api.orders.orders.find(o=>o.id===order.id)!.status).toBe('draft');
 for(const width of [1440,1024,768,390,360]) {
  await page.setViewportSize({width,height:800});
  await expect(panel).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`no horizontal overflow at ${width}px`).toBe(true);
 }
 await page.getByRole('button',{name:'TR — Türkçe'}).click();
 await expect(panel.getByRole('heading',{name:'Finans uygunluğu'})).toBeVisible();
 await expect(panel).toContainText('Sipariş vadeli olarak kesinleştirilemez.');
 await expect(panel).toContainText('Şirket kimliği doğrulanmadı.');
 // An invalid server configuration is said plainly.
 api.orders.finance.gate={configured:false,finalizationMode:null,releaseMode:null,preview:{phase:null,mode:null,outcome:'CONFIGURATION_INVALID',reasons:[]}};
 await page.reload();
 await expect(page.getByTestId('finance-invalid')).toContainText('Finans kontrolü yapılandırması geçersiz');
});
test('draft retry keeps one key, freezes editors and preserves input after version conflict',async({page})=>{
 const api=await mockApi(page,{loggedIn:true,permissions:perms});const companyId=api.companies.seed({legalName:'Client SRL',taxIdentifier:'1234'});
 await page.goto(`/comenzi/noua?companyId=${companyId}`);await page.getByRole('button',{name:'Adaugă linie'}).click();await page.getByLabel('Cod produs 1',{exact:true}).fill('LOCAL');
 let failed=false;
 await page.route(`${API}/b2b/orders`,async route=>{if(route.request().method()==='POST'&&!failed){failed=true;return route.abort('internetdisconnected');}return route.fallback();});
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();await expect(page.getByText('Nu există conexiune cu serverul.')).toBeVisible();
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toHaveValue('LOCAL');await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();await expect(page.getByRole('heading',{name:'B2B-ORD-000001'})).toBeVisible();
 await page.getByLabel('Cod produs 1',{exact:true}).fill('MY EDIT');
 await page.route(`${API}/b2b/orders/*`,async route=>{if(route.request().method()==='PUT')return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'ORDER_CHANGED',message:'Do not show'}})});return route.fallback();});
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();await expect(page.getByLabel('Cod produs 1',{exact:true})).toHaveValue('MY EDIT');
 await page.getByRole('button',{name:'Vezi versiunea actuală'}).click();await expect(page.getByTestId('current-order')).toContainText('LOCAL');await expect(page.getByLabel('Cod produs 1',{exact:true})).toHaveValue('MY EDIT');
});
test('stale calculation is ignored and dirty navigation prompts',async({page})=>{
 const api=await mockApi(page,{loggedIn:true,permissions:perms});const companyId=api.companies.seed({legalName:'Client SRL',taxIdentifier:'1234'});
 await page.goto(`/comenzi/noua?companyId=${companyId}`);await page.getByRole('button',{name:'Adaugă linie'}).click();
 await page.getByLabel('Cod produs 1',{exact:true}).fill('P');await page.getByLabel('TVA % 1').fill('0');
 await page.route(`${API}/b2b/orders/calculate`,async route=>{const body=route.request().postDataJSON();if(body.lines[0]?.unitPriceNet==='1'){await new Promise(r=>setTimeout(r,800));return route.fulfill({contentType:'application/json',body:JSON.stringify({currencyCode:'RON',lines:[{totals:{baseNet:'1.00',discountNet:'0.00',net:'1.00',vat:'0.00',gross:'1.00'}}],totals:{net:'1.00',vat:'0.00',gross:'1.00'},complete:true})});}return route.fallback();});
 await page.getByLabel('Preț unitar net 1').fill('1');await page.waitForRequest(r=>r.url().endsWith('/calculate')&&r.postDataJSON().lines[0]?.unitPriceNet==='1');
 await page.getByLabel('Preț unitar net 1').fill('2');await expect(page.getByTestId('order-totals')).toContainText('2.00 RON');await page.waitForTimeout(900);await expect(page.getByTestId('order-totals')).toContainText('2.00 RON');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('navigation').getByRole('link',{name:'Comenzi',exact:true}).click();await expect(page.getByLabel('Preț unitar net 1')).toHaveValue('2');
});

test('100 stable rows remain usable across mobile, tablet, desktop and reduced motion', async ({page}, testInfo) => {
 const api=await mockApi(page,{loggedIn:true,permissions:perms});
 const companyId=api.companies.seed({legalName:'Volume Client SRL',taxIdentifier:'1234'});
 const fields=orderFields({...emptyOrder(companyId),lines:Array.from({length:100},(_,index)=>({...emptyLine(),productCode:`P-${index}`,unitPriceNet:'0.05',vatPercent:'10'}))});
 const order=api.orders.seed(fields);
 await page.goto(`/comenzi/${order.id}`);
 await expect(page.locator('.order-line')).toHaveCount(100);
 const ids=await page.locator('.order-line').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-line-id')));
 expect(new Set(ids).size).toBe(100);
 await expect(page.getByTestId('order-totals')).toContainText('6.00 RON');
 await page.getByLabel('Cod produs 100',{exact:true}).fill('LAST-EDIT');
 await page.getByLabel('Cod produs 100',{exact:true}).press('Enter');
 await expect(page.getByLabel('Tip produs 100',{exact:true})).toBeFocused();
 expect(await page.locator('.order-line').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-line-id')))).toEqual(ids);
 for(const width of [360,390,768,1280,1920]) {
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(await page.locator('.order-line').last().evaluate(row=>row.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
  await expect(page.getByLabel('Cod produs 100',{exact:true})).toHaveValue('LAST-EDIT');
  if(width===390 || width===768) {
   await page.getByLabel('Cod produs 100',{exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:testInfo.outputPath(`classic-100-${width}.png`)});
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.locator('.order-line').first().evaluate(row=>getComputedStyle(row).animationName)).toBe('none');
 await page.getByLabel('Cod produs 100',{exact:true}).press('Control+s');
 await expect(page.getByRole('button',{name:'Salvează ciorna',exact:true})).toBeDisabled();
 expect(api.orders.orders[0].lines[99].productCode).toBe('LAST-EDIT');
 await page.getByLabel('Cod produs 100',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:testInfo.outputPath('classic-100-desktop.png')});
});

test('lost successful response replays one intent and pending writes freeze every field',async({page})=>{
 const api=await mockApi(page,{loggedIn:true,permissions:perms});
 const companyId=api.companies.seed({legalName:'Retry Client SRL',taxIdentifier:'1234'});
 await page.goto(`/comenzi/noua?companyId=${companyId}`);
 await page.getByRole('button',{name:'Adaugă linie'}).click();
 await page.getByLabel('Cod produs 1',{exact:true}).fill('RETRY');
 const keys:string[]=[];let first=true;
 await page.route(`${API}/b2b/orders`,async route=>{
  if(route.request().method()!=='POST')return route.fallback();
  const key=(await route.request().allHeaders())['idempotency-key'];keys.push(key);
  if(first){first=false;api.orders.handle('POST','/b2b/orders',new URLSearchParams(),route.request().postDataJSON(),key);
   await new Promise(resolve=>setTimeout(resolve,400));return route.abort('internetdisconnected');}
  return route.fallback();
 });
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('Referință client')).toBeDisabled();
 await expect(page.getByText('Nu există conexiune cu serverul.')).toBeVisible();
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();
 await expect(page.getByRole('heading',{level:1})).toHaveText('B2B-ORD-000001');
 expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect(api.orders.orders).toHaveLength(1);
 await page.getByLabel('Cod produs 1',{exact:true}).press('Alt+Enter');
 await expect(page.locator('.order-line')).toHaveCount(2);
 await expect(page.getByLabel('Cod produs 2',{exact:true})).toBeFocused();
});

test('frozen orders show their historical contact and addresses, and line counts are grammatical in RO and TR', async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true, permissions: [...perms, 'b2b.companies.update'] });
  const companyId = api.companies.seed({ legalName: 'Snapshot SRL', taxIdentifier: '5555' });
  const post = (section: string, body: Record<string, unknown>) =>
    expect(api.companies.handle('POST', `/b2b/companies/${companyId}/${section}`, new URLSearchParams(), body, crypto.randomUUID()).status).toBe(201);
  post('contacts', { name: 'Ana Istoric', jobTitle: null, email: null, phone: null, isPrimary: true });
  const address = (type: string, city: string) => ({ type, label: null, countryCode: 'RO', countyRegion: null, city, postalCode: null, addressLine1: `Str. ${city} 1`, addressLine2: null, isPrimary: true });
  post('addresses', address('billing', 'Cluj'));
  post('addresses', address('delivery', 'Iași'));
  const [contact] = api.companies.contacts.get(companyId)!;
  const [billing, delivery] = api.companies.addresses.get(companyId)!;
  const line = (code: string) => ({ ...orderFields({ ...emptyOrder(companyId), lines: [{ ...emptyLine(), productCode: code, quantity: '1', unitPriceNet: '1.00', vatPercent: '19' }] }).lines[0], id: null });
  const fields = { ...orderFields(emptyOrder(companyId)), orderType: 'FULL_TAILORING' as const, contactId: contact.id, billingAddressId: billing.id, deliveryAddressId: delivery.id, lines: [line('ONE')] };
  const order = api.orders.seed(fields);
  expect(api.orders.handle('POST', `/b2b/orders/${order.id}/finalize`, new URLSearchParams(), { expectedVersion: 1 }, crypto.randomUUID()).status).toBe(200);
  // The live contact changes after finalization; the order keeps the historical name.
  contact.name = 'Nume Nou Live';

  await page.goto(`/comenzi/${order.id}`);
  await expect(page.getByLabel('Cod produs 1', { exact: true })).toBeDisabled();
  const selected = (label: string) => page.locator('label').filter({ hasText: label }).locator('select option:checked');
  await expect(selected('Persoană de contact')).toHaveText('Ana Istoric');
  await expect(selected('Adresă de facturare')).toHaveText(/Cluj · Str\. Cluj 1/);
  await expect(selected('Adresă de livrare')).toHaveText(/Iași · Str\. Iași 1/);
  await expect(page.getByText('Înregistrare selectată indisponibilă')).toHaveCount(0);
  await expect(page.getByText('Nume Nou Live')).toHaveCount(0);
  await page.getByRole('button', { name: 'Anulează comanda', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(`${order.code} · 1 produs · RON`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'TR — Türkçe' }).click();
  await expect(page.getByText('Seçili kayıt kullanılamıyor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Siparişi iptal et', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(`${order.code} · 1 ürün · RON`);
  await page.keyboard.press('Escape');

  const draft = api.orders.seed({ ...fields, lines: [line('A'), line('B'), line('C')] });
  await page.goto(`/comenzi/${draft.id}`);
  await page.getByRole('button', { name: 'Siparişi iptal et', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(`${draft.code} · 3 ürün · RON`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'RO — Română' }).click();
  await page.getByRole('button', { name: 'Anulează comanda', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(`${draft.code} · 3 produse · RON`);
});

test('zero-downtime release: B2B 0.9.x on Operations API 2.66.0 neither shows nor sends the order type and still finalizes',async({page})=>{
 const api=await mockApi(page,{loggedIn:true,permissions:perms,features:null}); const companyId=api.companies.seed({legalName:'Synthetic Legacy SRL',taxIdentifier:'1234'});
 const bodies:unknown[]=[];
 page.on('request',r=>{ if(r.url().startsWith(API+'/b2b/orders') && ['POST','PUT'].includes(r.method())) bodies.push(r.postDataJSON()); });
 await page.goto(`/comenzi/noua?companyId=${companyId}`);
 await expect(page.getByRole('heading',{name:'Comandă nouă'})).toBeVisible();
 await expect(page.getByRole('radio',{name:/Doar debitare/})).toHaveCount(0);
 await expect(page.getByTestId('order-type-badge')).toHaveCount(0);
 await page.getByRole('button',{name:'Adaugă linie'}).click();
 await page.getByLabel('Cod produs 1',{exact:true}).fill('P1');
 await page.getByLabel('Preț unitar net 1').fill('10,00');
 await page.getByLabel('TVA % 1').fill('19');
 await expect(page.getByTestId('order-totals')).toContainText('11.90 RON');
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();
 await expect(page.getByRole('heading',{name:'B2B-ORD-000001'})).toBeVisible();
 await expect(page.getByText('Alegeți tipul comenzii înainte de finalizare.')).toHaveCount(0);
 await page.getByRole('button',{name:'Finalizează',exact:true}).click();
 await page.getByRole('button',{name:'Confirmă finalizarea'}).click();
 await expect(page.getByText('Finalizată',{exact:true}).first()).toBeVisible();
 await expect(page.getByTestId('finance-panel')).toHaveCount(0);
 // Neither the order list nor the company order history shows a type badge on API 2.66.0.
 await page.goto('/comenzi');
 await expect(page.getByRole('link',{name:'B2B-ORD-000001'})).toBeVisible();
 await expect(page.getByTestId('order-list-type')).toHaveCount(0);
 await expect(page.getByText('Tip neales')).toHaveCount(0);
 await page.goto(`/companii/${companyId}`);
 await expect(page.getByRole('link',{name:'B2B-ORD-000001'})).toBeVisible();
 await expect(page.getByTestId('order-list-type')).toHaveCount(0);
 await expect(page.getByText('Tip neales')).toHaveCount(0);
 expect(bodies.length).toBeGreaterThan(0);
 expect(bodies.some(b=>Object.hasOwn(b as object,'orderType'))).toBe(false);
});
test('feature matrix: the finance panel follows financeGate and the order type (also of a historical typed order) follows orderTypes, never the order data alone',async({page})=>{
 const gateOff={configured:true,finalizationMode:'off',releaseMode:'off',preview:{phase:'finalization',mode:'off',outcome:'NOT_EVALUATED',reasons:[]}};
 for (const [features,panel,types] of [[[],false,false],[['financeGate'],true,false],[['orderTypes'],false,true],[['orderTypes','financeGate'],true,true]] as const) {
  const api=await mockApi(page,{loggedIn:true,permissions:perms,features:[...features]});const companyId=api.companies.seed({legalName:'Synthetic Matrix SRL',taxIdentifier:'4321'});
  // API 2.68.0 sends the gate state of every draft, also while the gate is off.
  api.orders.finance.gate=gateOff;
  const order=api.orders.seed(orderFields({...emptyOrder(companyId),lines:[{...emptyLine(),productCode:'P1',quantity:'1',unitPriceNet:'10.00',vatPercent:'19'}]}));
  await page.goto(`/comenzi/${order.id}`);
  await expect(page.getByRole('heading',{name:order.code})).toBeVisible();
  const label=JSON.stringify(features);
  await expect(page.getByTestId('finance-panel'),label).toHaveCount(panel?1:0);
  await expect(page.locator('fieldset.order-type'),label).toHaveCount(types?1:0);
  await expect(page.getByTestId('order-type-badge'),label).toHaveCount(types?1:0);
  if(!panel) await expect(page.getByText('Eligibilitate financiară'),label).toHaveCount(0);
  // A historical typed order (created while order types were on): the finalize dialog and the finalized details show its type only with orderTypes.
  const typed=api.orders.seed(orderFields({...emptyOrder(companyId),orderType:'CUT_ONLY',lines:[{...emptyLine(),productCode:'P2',quantity:'1',unitPriceNet:'10.00',vatPercent:'19'}]}));
  await page.goto(`/comenzi/${typed.id}`);
  await expect(page.getByRole('heading',{name:typed.code})).toBeVisible();
  await page.getByRole('button',{name:'Finalizează',exact:true}).click();
  await expect(page.getByRole('dialog'),label).toContainText(typed.code);
  await expect(page.getByTestId('confirm-order-type'),label).toHaveCount(types?1:0);
  await page.getByRole('button',{name:'Confirmă finalizarea'}).click();
  await expect(page.getByText('Finalizată',{exact:true}).first(),label).toBeVisible();
  await expect(page.getByTestId('frozen-order-type'),label).toHaveCount(types?1:0);
  if(!types) await expect(page.getByText(/Doar debitare|Pregătire material → Livrare|Tip neales/),label).toHaveCount(0);
  else await expect(page.getByTestId('frozen-order-type'),label).toContainText('Doar debitare');
  await page.unrouteAll({behavior:'ignoreErrors'});
 }
});
