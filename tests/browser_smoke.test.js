const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const port = 4194;
const chromePath = ['/usr/bin/chromium', '/usr/bin/google-chrome'].find((item) => fs.existsSync(item));

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('dev server did not start')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`http://127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`dev server exited with ${code}`));
      }
    });
  });
}

function waitForChrome(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('chromium did not expose devtools')), 10000);
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`chromium exited with ${code}`));
      }
    });
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function connectWebSocket(wsUrl) {
  const parsed = new URL(wsUrl);
  const key = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');
  const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
  let buffer = Buffer.alloc(0);
  let opened = false;
  let nextId = 1;
  const pending = new Map();

  function sendFrame(payload) {
    const data = Buffer.from(JSON.stringify(payload));
    const header = [];
    header.push(0x81);
    if (data.length < 126) {
      header.push(0x80 | data.length);
    } else {
      header.push(0x80 | 126, (data.length >> 8) & 0xff, data.length & 0xff);
    }
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.alloc(data.length);
    for (let index = 0; index < data.length; index += 1) {
      masked[index] = data[index] ^ mask[index % 4];
    }
    socket.write(Buffer.concat([Buffer.from(header), mask, masked]));
  }

  function parseFrames() {
    while (buffer.length >= 2) {
      const second = buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      }
      if (buffer.length < offset + length) return;
      const payload = buffer.slice(offset, offset + length).toString('utf8');
      buffer = buffer.slice(offset + length);
      if (!payload) continue;
      const message = JSON.parse(payload);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  }

  const ready = new Promise((resolve, reject) => {
    socket.on('connect', () => {
      socket.write([
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      if (!opened) {
        const text = chunk.toString('utf8');
        const headerEnd = text.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        opened = true;
        const rest = chunk.slice(headerEnd + 4);
        if (rest.length) buffer = Buffer.concat([buffer, rest]);
        resolve();
        parseFrames();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      parseFrames();
    });
    socket.on('error', reject);
  });

  return {
    ready,
    send(method, params = {}, sessionId = null) {
      const id = nextId;
      nextId += 1;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      sendFrame(payload);
      return new Promise((resolve) => pending.set(id, resolve));
    },
    close() {
      socket.end();
    },
  };
}

function terminate(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      resolve();
    }, 2000);
  });
}

async function run() {
  assert.ok(chromePath, 'chromium or google-chrome is required for browser smoke test');

  const server = spawn(process.execPath, ['tools/dev-server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'actitpass-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let client;
  try {
    await waitForServer(server);
    const browserWs = await waitForChrome(chrome);
    const version = await getJson(`http://${new URL(browserWs).host}/json/version`);
    client = connectWebSocket(version.webSocketDebuggerUrl);
    await client.ready;
    const target = await client.send('Target.createTarget', { url: `http://127.0.0.1:${port}` });
    const attached = await client.send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
    const sessionId = attached.result.sessionId;
    const send = (method, params = {}) => client.send(method, params, sessionId);
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}` });
    await send('Runtime.evaluate', {
      expression: 'new Promise((resolve) => { const wait = () => document.body ? resolve(true) : setTimeout(wait, 50); wait(); })',
      awaitPromise: true,
      returnByValue: true,
    });

    await send('Runtime.evaluate', {
      expression: `
        new Promise((resolve) => {
          setTimeout(async () => {
            document.querySelector('#tab-create').click();
            document.querySelector('#vault-name').value = 'браузерный-тест';
            document.querySelector('#master-password').value = 'browser-test-password';
            document.querySelector('#master-password-confirm').value = 'browser-test-password';
            document.querySelector('#create-demo-data').checked = true;
            document.querySelector('#unlock-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            setTimeout(() => resolve({
              cards: document.querySelectorAll('.secret-card').length,
              swatches: document.querySelectorAll('.swatch-button').length,
              icons: document.querySelectorAll('.template-symbol').length,
              eyes: document.querySelectorAll('.eye-button').length,
              visibleRows: document.querySelectorAll('.value-row').length,
              secretRows: document.querySelectorAll('.secret-row').length,
              text: document.body.innerText,
            }), 700);
          }, 500);
        })
      `,
      awaitPromise: true,
      returnByValue: true,
    });
    const result = await send('Runtime.evaluate', {
      expression: `({
        cards: document.querySelectorAll('.secret-card').length,
        swatches: document.querySelectorAll('.swatch-button').length,
        icons: document.querySelectorAll('.template-symbol').length,
        eyes: document.querySelectorAll('.eye-button').length,
        visibleRows: document.querySelectorAll('.value-row').length,
        secretRows: document.querySelectorAll('.secret-row').length,
        body: document.body.innerText
      })`,
      returnByValue: true,
    });
    if (!result.result || !result.result.result || !result.result.result.value) {
      throw new Error(`Unexpected Runtime.evaluate response: ${JSON.stringify(result)}`);
    }
    const value = result.result.result.value;
    assert.ok(value.cards >= 4, 'demo cards should render');
    assert.ok(value.swatches >= 7, 'color swatches should render');
    assert.ok(value.icons >= 4, 'template icons should render');
    assert.ok(value.eyes >= 4, 'eye buttons should render');
    assert.ok(value.visibleRows >= 8, 'visible fields should render');
    assert.ok(value.secretRows >= 4, 'hidden fields should render');
    assert.ok(value.body.includes('Основная карта'), 'Russian demo card should be visible');
    assert.ok(value.body.includes('Синхронизация'), 'Russian UI should be visible');

    const settings = await send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        document.querySelector('[data-view="settings"]').click();
        requestAnimationFrame(() => resolve({
          palette: document.querySelectorAll('#settings-palette .gallery-chip').length,
          icons: document.querySelectorAll('#settings-icons .gallery-chip').length,
          body: document.body.innerText,
        }));
      })`,
      awaitPromise: true,
      returnByValue: true,
    });
    const settingsValue = settings.result.result.value;
    assert.ok(settingsValue.palette >= 7, 'settings should show all color swatches');
    assert.ok(settingsValue.icons >= 10, 'settings should show template pictograms');
    assert.ok(settingsValue.body.includes('Палитра цветов'), 'settings palette title should be visible');
    assert.ok(settingsValue.body.includes('Пиктограммы шаблонов'), 'settings icons title should be visible');

    async function assertLayout(label, width, height) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 700,
      });
      await send('Runtime.evaluate', {
        expression: `
          new Promise((resolve) => {
            requestAnimationFrame(() => {
              document.querySelector('[data-view="sync"]').click();
              requestAnimationFrame(() => resolve(true));
            });
          })
        `,
        awaitPromise: true,
        returnByValue: true,
      });
      const layout = await send('Runtime.evaluate', {
        expression: `(() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity) !== 0
              && rect.width > 0
              && rect.height > 0;
          };
          const controls = Array.from(document.querySelectorAll('button, input:not([type="file"]), select, textarea'))
            .filter(visible)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                id: element.id || '',
                text: element.innerText || element.value || element.getAttribute('aria-label') || '',
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              };
            });
          const overlaps = [];
          for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
              const a = controls[leftIndex];
              const b = controls[rightIndex];
              const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (horizontal > 1 && vertical > 1) {
                overlaps.push({ a, b, horizontal, vertical });
              }
            }
          }
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth,
            controls: controls.length,
            overlaps,
          };
        })()`,
        returnByValue: true,
      });
      const data = layout.result.result.value;
      assert.ok(data.scrollWidth <= data.innerWidth + 2, `${label}: page should not overflow horizontally`);
      assert.equal(data.overlaps.length, 0, `${label}: controls should not overlap: ${JSON.stringify(data.overlaps.slice(0, 3))}`);
      assert.ok(data.controls > 10, `${label}: expected visible controls to be measured`);
    }

    await assertLayout('desktop sync layout', 1280, 900);
    await assertLayout('mobile sync layout', 390, 844);

    console.log('browser_smoke.test.js: all tests passed');
  } finally {
    if (client) client.close();
    await terminate(chrome);
    await terminate(server);
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
