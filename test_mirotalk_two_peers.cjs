const path = require('path');
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runTest() {
  console.log('Launching browser 1 (Publisher)...');
  const browser1 = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-insecure-localhost',
      '--ignore-certificate-errors',
      '--no-sandbox',
    ],
  });

  console.log('Launching browser 2 (Viewer)...');
  const browser2 = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-insecure-localhost',
      '--ignore-certificate-errors',
      '--no-sandbox',
    ],
  });

  const testRoom = 'lctest' + Date.now();
  const pubUrl = `https://192.168.1.4:3010/join/?room=${testRoom}&roomPassword=0&name=Publisher&audio=1&video=1&screen=0&hide=0&notify=0&chat=0&duration=unlimited&embed=1`;
  const viewUrl = `https://192.168.1.4:3010/join/?room=${testRoom}&roomPassword=0&name=Viewer&audio=0&video=0&screen=0&hide=1&notify=0&chat=0&duration=unlimited&embed=1`;

  const page1 = await browser1.newPage();
  const page2 = await browser2.newPage();

  page1.on('console', msg => console.log('[PUB LOG]', msg.type(), msg.text()));
  page1.on('pageerror', err => console.error('[PUB ERR]', err.message));

  page2.on('console', msg => console.log('[VIEW LOG]', msg.type(), msg.text()));
  page2.on('pageerror', err => console.error('[VIEW ERR]', err.message));

  console.log('Navigating Publisher to:', pubUrl);
  await page1.goto(pubUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Waiting 4s for publisher initialization...');
  await new Promise(r => setTimeout(r, 4000));

  console.log('Navigating Viewer to:', viewUrl);
  await page2.goto(viewUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Waiting 10s for WebRTC negotiation...');
  await new Promise(r => setTimeout(r, 10000));

  const pubStatus = await page1.evaluate(() => {
    const v = document.querySelectorAll('video');
    const c = document.querySelectorAll('.Camera');
    return {
      videosCount: v.length,
      videoDetails: Array.from(v).map(el => ({
        id: el.id,
        muted: el.muted,
        srcObject: Boolean(el.srcObject),
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        paused: el.paused,
        currentTime: el.currentTime,
        display: el.style.display || window.getComputedStyle(el).display,
        parentDisplay: el.parentElement ? window.getComputedStyle(el.parentElement).display : null,
      })),
      camerasCount: c.length,
      cameraDisplays: Array.from(c).map(el => ({
        id: el.id,
        dataset: Object.assign({}, el.dataset),
        display: window.getComputedStyle(el).display,
      })),
    };
  });

  const viewStatus = await page2.evaluate(() => {
    const v = document.querySelectorAll('video');
    const c = document.querySelectorAll('.Camera');
    return {
      videosCount: v.length,
      videoDetails: Array.from(v).map(el => ({
        id: el.id,
        muted: el.muted,
        srcObject: Boolean(el.srcObject),
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        paused: el.paused,
        currentTime: el.currentTime,
        display: el.style.display || window.getComputedStyle(el).display,
        parentDisplay: el.parentElement ? window.getComputedStyle(el.parentElement).display : null,
      })),
      camerasCount: c.length,
      cameraDisplays: Array.from(c).map(el => ({
        id: el.id,
        dataset: Object.assign({}, el.dataset),
        display: window.getComputedStyle(el).display,
      })),
    };
  });

  console.log('--- PUBLISHER STATUS ---');
  console.log(JSON.stringify(pubStatus, null, 2));

  console.log('--- VIEWER STATUS ---');
  console.log(JSON.stringify(viewStatus, null, 2));

  await browser1.close();
  await browser2.close();
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
