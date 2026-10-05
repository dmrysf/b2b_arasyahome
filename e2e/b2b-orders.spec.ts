import {expect,test} from '@playwright/test';
import {mockApi,API} from './mock-api';
import { emptyLine, emptyOrder, orderFields } from '../src/orders/model';
const perms=['b2b.companies.view','b2b.orders.view','b2b.orders.create','b2b.orders.update','b2b.orders.manage_status'];
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
 await page.getByRole('button',{name:'Salvează ciorna',exact:true}).click();
 await expect(page.getByRole('heading',{name:'B2B-ORD-000001'})).toBeVisible();
 await page.getByRole('button',{name:'Finalizează',exact:true}).click();
 await page.getByRole('button',{name:'Confirmă finalizarea'}).click();
 await expect(page.getByText('Finalizată',{exact:true}).first()).toBeVisible();
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Duplică în ciornă'}).click();
 await expect(page.getByRole('heading',{name:'B2B-ORD-000002'})).toBeVisible();
 await expect(page.getByLabel('Cod produs 1',{exact:true})).toHaveValue('P1');
 await page.getByRole('button',{name:'TR — Türkçe'}).click();
 await expect(page.getByRole('button',{name:'Taslağı kaydet'})).toBeVisible();
 expect(api.state.requests).toContain('POST /b2b/orders');
 expect(await page.evaluate(()=>[sessionStorage.length,Object.keys(localStorage)])).toEqual([0,['arasya.b2b.locale']]);
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
