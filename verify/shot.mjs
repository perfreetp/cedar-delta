import { serve, launch, shotPath } from './harness.mjs';

const server = serve();
const { browser, page, errors } = await launch();

await page.screenshot({ path: shotPath('01-initial'), fullPage: false });
console.log('errors:', errors.length ? errors : 'none');

await browser.close();
server.close();
