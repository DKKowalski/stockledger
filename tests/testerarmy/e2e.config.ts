import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';
import { fixture } from './fixture';
export default {
  projectId: 'stockledger-disposable-pricing-qa',
  targets: [
    {name:'desktop', engine:web({viewport:{width:1440,height:1000},locale:'en-GH',timezoneId:'Africa/Accra',reducedMotion:'reduce'}), app:{url:fixture.webBase}},
    {name:'mobile', engine:web({viewport:{width:390,height:844},locale:'en-GH',timezoneId:'Africa/Accra',reducedMotion:'reduce'}), app:{url:fixture.webBase}},
  ],
  agents:{default:{model:chatgpt('gpt-6-luna'),maxSteps:25,maxModelCalls:18,system:'You are testing StockLedger on a disposable local business. Use only visible UI controls. Complete exactly the requested goal and inspect its result. Never record a sale unless the goal explicitly asks you to submit one.',context:'The pricing preview is on the Items screen, below Selling prices. Previews do not alter stock. Existing sales use retail prices. Product: Live preview product. Mobile navigation may require opening the navigation menu.'}},
  credentials:{admin:{username:fixture.administrator.email,password:fixture.administrator.password},attendant:{username:fixture.attendant.email,password:fixture.attendant.password}},
  workers:1,retries:0,cache:'off',trace:'on',timeout:240000,assertionTimeout:15000,reporters:['list','markdown'],
} satisfies E2EConfig;
