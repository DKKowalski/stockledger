import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { token, get } from '../fixture';

test('owner follows the in-app deals guide to the end without changing anything', async ({app,screen,agent,browser}) => {
  const auth = await token();
  const before = await get('/settings',auth);
  const user = credentials.user('admin');
  await app.open('/login');
  await screen.getByLabel('Email address').fill(user.username);
  await screen.getByPlaceholder('Enter your password').fill(user.password);
  await screen.getByRole('button','Sign in').tap();
  await expect(screen.getByRole('heading','Box and quantity deals')).toBeVisible();
  await agent.act('Press "Show me" on the New card about box and quantity deals, then stop as soon as the guide shows step 1. Do not press Next.');
  await expect(screen.getByRole('heading','Turn deals on')).toBeVisible();
  expect(await browser.evaluate(() => document.querySelector('[data-tour="deals-switch"]')?.classList.contains('tour-highlight'))).toBe(true);
  await agent.act('Read each guide step and move forward with Next until the guide offers Done, then press Done. Do not change any settings or prices.');
  await expect(browser.locator('.tour-card')).toHaveCount(0);
  await app.open('/');
  await expect(screen.getByRole('button','Show me')).toHaveCount(0);
  expect(await get('/settings',auth)).toEqual(before);
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
