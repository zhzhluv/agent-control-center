#!/usr/bin/env node
/**
 * Authenticated Screen Capture Script
 * Uses Chrome DevTools Protocol (CDP) via ws library
 * No Playwright/Puppeteer required
 *
 * Fixed: Tab selection now uses Korean text labels instead of indices
 * Added: DOM verification before each screenshot
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const CDP_PORT = 9222;
const APP_URL = 'http://127.0.0.1:9876';

// Read token without exposing it
const TOKEN = fs.readFileSync('/tmp/agent-control-center-token', 'utf8').trim();
if (!TOKEN) {
  console.error('Token not found');
  process.exit(1);
}
console.log('Token: loaded');

// Viewports to capture
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'ipad-landscape', width: 1180, height: 820 },
  { name: 'ipad-portrait', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
];

// Screens to capture with Korean button text and DOM verification
// Actual tab order: 운영실, 로그, 보고서, 설정
const SCREENS = [
  {
    name: 'ops',
    buttonText: '운영실',
    verifyText: '직원 운영실',
    fallbackText: 'Pixel Office'
  },
  {
    name: 'reports',
    buttonText: '보고서',
    verifyText: '에이전트 보고서',
    fallbackText: 'Reports'
  },
  {
    name: 'settings',
    buttonText: '설정',
    verifyText: '연결 설정',
    fallbackText: 'Connection'
  },
];

let chromeProcess = null;
let ws = null;
let messageId = 1;
const pendingMessages = new Map();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWebSocketDebuggerUrl() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const tabs = JSON.parse(data);
          const page = tabs.find(t => t.type === 'page');
          if (page) {
            resolve(page.webSocketDebuggerUrl);
          } else {
            reject(new Error('No page found'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout getting debugger URL'));
    });
  });
}

function sendCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = messageId++;
    const message = JSON.stringify({ id, method, params });

    pendingMessages.set(id, { resolve, reject });
    ws.send(message);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingMessages.has(id)) {
        pendingMessages.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 30000);
  });
}

async function connectToCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('Connected to CDP');
      resolve();
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pendingMessages.has(msg.id)) {
        const { resolve, reject } = pendingMessages.get(msg.id);
        pendingMessages.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    });

    ws.on('error', reject);
    ws.on('close', () => console.log('CDP connection closed'));
  });
}

async function setViewport(width, height) {
  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
}

async function captureScreenshot(filename) {
  const result = await sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });

  const buffer = Buffer.from(result.data, 'base64');
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  console.log(`   Saved: ${filename} (${Math.round(buffer.length / 1024)}KB)`);
  return filepath;
}

async function navigateAndWait(url) {
  await sendCommand('Page.enable');
  await sendCommand('Page.navigate', { url });
  await sleep(2000); // Wait for page load
}

async function setAuthToken() {
  // Set localStorage auth token
  await sendCommand('Runtime.evaluate', {
    expression: `localStorage.setItem('authToken', '${TOKEN}')`,
  });
  console.log('Auth token set in localStorage');
}

// Click tab by Korean text label
async function clickTabByText(buttonText) {
  const expression = `
    (function() {
      const buttons = document.querySelectorAll('button, [role="tab"]');
      for (const btn of buttons) {
        const text = btn.textContent || btn.innerText || '';
        if (text.includes('${buttonText}')) {
          btn.click();
          return { clicked: true, text: text.trim().substring(0, 20) };
        }
      }
      return { clicked: false, text: null };
    })()
  `;
  const result = await sendCommand('Runtime.evaluate', {
    expression,
    returnByValue: true
  });
  return result.result?.value || { clicked: false };
}

// Verify current screen by checking DOM text
async function verifyScreen(verifyText, fallbackText) {
  const expression = `
    (function() {
      const body = document.body.innerText || document.body.textContent || '';
      const hasVerify = body.includes('${verifyText}');
      const hasFallback = body.includes('${fallbackText}');
      return {
        hasVerify,
        hasFallback,
        verified: hasVerify || hasFallback,
        sample: body.substring(0, 200)
      };
    })()
  `;
  const result = await sendCommand('Runtime.evaluate', {
    expression,
    returnByValue: true
  });
  return result.result?.value || { verified: false };
}

async function startChrome(width, height) {
  const userDataDir = `/tmp/chrome-cdp-${Date.now()}`;

  const args = [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    'about:blank',
  ];

  chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args, {
    stdio: 'ignore',
  });

  // Wait for Chrome to start
  await sleep(2000);

  // Clean up user data dir on exit
  chromeProcess.userDataDir = userDataDir;
}

async function stopChrome() {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (chromeProcess) {
    chromeProcess.kill();
    // Clean up user data dir
    try {
      fs.rmSync(chromeProcess.userDataDir, { recursive: true, force: true });
    } catch (e) {}
    chromeProcess = null;
  }
}

async function captureAuthenticatedScreens() {
  console.log('\n=== Authenticated Screen Capture (Text-Based Tab Selection) ===\n');

  const results = [];

  for (const viewport of VIEWPORTS) {
    console.log(`\nViewport: ${viewport.name} (${viewport.width}x${viewport.height})`);

    try {
      // Start Chrome for this viewport
      await startChrome(viewport.width, viewport.height);

      // Get WebSocket URL
      let wsUrl;
      for (let i = 0; i < 10; i++) {
        try {
          wsUrl = await getWebSocketDebuggerUrl();
          break;
        } catch (e) {
          await sleep(500);
        }
      }

      if (!wsUrl) {
        throw new Error('Could not get CDP WebSocket URL');
      }

      // Connect to CDP
      await connectToCDP(wsUrl);

      // Set viewport
      await setViewport(viewport.width, viewport.height);

      // Navigate to app
      await navigateAndWait(APP_URL);

      // Set auth token in localStorage
      await setAuthToken();

      // Reload to apply auth
      await navigateAndWait(APP_URL);
      await sleep(2500); // Wait for WebSocket connection and data load

      // Capture each screen
      for (const screen of SCREENS) {
        const filename = `authenticated-${screen.name}-${viewport.name}-${viewport.width}x${viewport.height}.png`;

        try {
          // Click tab by Korean text
          console.log(`   Clicking tab: ${screen.buttonText}`);
          const clickResult = await clickTabByText(screen.buttonText);

          if (!clickResult.clicked) {
            throw new Error(`Tab not found: ${screen.buttonText}`);
          }
          console.log(`   Tab clicked: ${clickResult.text}`);

          await sleep(1500); // Wait for tab content to load

          // Verify we're on the correct screen
          console.log(`   Verifying: ${screen.verifyText}`);
          const verification = await verifyScreen(screen.verifyText, screen.fallbackText);

          if (!verification.verified) {
            throw new Error(`DOM verification failed for ${screen.name}: expected "${screen.verifyText}" or "${screen.fallbackText}"`);
          }
          console.log(`   Verified: ${verification.hasVerify ? screen.verifyText : screen.fallbackText}`);

          await captureScreenshot(filename);
          results.push({
            filename,
            status: 'success',
            viewport: viewport.name,
            screen: screen.name,
            verified: verification.hasVerify ? screen.verifyText : screen.fallbackText
          });
        } catch (e) {
          console.log(`   Failed: ${filename} - ${e.message}`);
          results.push({
            filename,
            status: 'failed',
            error: e.message,
            viewport: viewport.name,
            screen: screen.name
          });
        }
      }

    } catch (e) {
      console.log(`   Viewport failed: ${e.message}`);
      for (const screen of SCREENS) {
        const filename = `authenticated-${screen.name}-${viewport.name}-${viewport.width}x${viewport.height}.png`;
        results.push({
          filename,
          status: 'failed',
          error: e.message,
          viewport: viewport.name,
          screen: screen.name
        });
      }
    } finally {
      await stopChrome();
      await sleep(500);
    }
  }

  return results;
}

// Main
(async () => {
  try {
    const results = await captureAuthenticatedScreens();

    console.log('\n=== Summary ===\n');

    const success = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed');

    console.log(`Success: ${success.length}`);
    console.log(`Failed: ${failed.length}`);

    if (success.length > 0) {
      console.log('\nSuccessful captures with DOM verification:');
      for (const s of success) {
        console.log(`  - ${s.screen}/${s.viewport}: verified "${s.verified}"`);
      }
    }

    if (failed.length > 0) {
      console.log('\nFailed captures:');
      for (const f of failed) {
        console.log(`  - ${f.filename}: ${f.error}`);
      }
    }

    console.log('\nCapture files:');
    const files = fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.startsWith('authenticated-'));
    for (const f of files) {
      const stats = fs.statSync(path.join(SCREENSHOTS_DIR, f));
      console.log(`  - ${f} (${Math.round(stats.size / 1024)}KB)`);
    }

    process.exit(failed.length > 0 ? 1 : 0);
  } catch (e) {
    console.error('Fatal error:', e.message);
    await stopChrome();
    process.exit(1);
  }
})();
