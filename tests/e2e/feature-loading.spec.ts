import {expect,test} from '@playwright/test';
test('public and attendant visits defer owner feature modules',async({page})=>{
  await page.setExtraHTTPHeaders({'X-Forwarded-For':'198.51.100.211'});
  const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
  await page.goto('/login');await expect(page.getByRole('button',{name:'Preview as shop attendant'})).toBeVisible();
  expect(requests.some(url=>url.includes('/src/app/role-workspace'))).toBe(false);
  await page.getByRole('button',{name:'Preview as shop attendant'}).click();await expect(page).toHaveURL('/');
  await page.getByRole('main').getByRole('link',{name:'Sell',exact:true}).click();await expect(page.getByRole('heading',{name:'Record a sale',exact:true})).toBeVisible();
  expect(requests.some(url=>/\/src\/features\/(finance|profitability|settings|admin)\//.test(url))).toBe(false);
});
test('a failed feature download offers recovery while other navigation still works',async({page})=>{
  await page.setExtraHTTPHeaders({'X-Forwarded-For':'198.51.100.212'});
  await page.goto('/login');await page.getByRole('button',{name:'Preview as owner'}).click();await expect(page).toHaveURL('/');
  await page.route('**/src/features/finance/finance-page.tsx*',route=>route.abort('connectionreset'));
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Finance',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('This page could not load');await expect(page.getByRole('button',{name:'Reload page',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Team',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Team',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Reload page',exact:true})).toHaveCount(0);
});
