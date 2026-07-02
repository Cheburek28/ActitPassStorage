const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'web');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = clean === '/' ? '/index.html' : clean;
  const filePath = path.resolve(root, `.${target}`);
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

function parseWebDavConfig(rawConfig) {
  const config = typeof rawConfig === 'string' ? rawConfig.trim() : rawConfig;
  if (!config) throw new Error('WebDAV config is required');
  if (typeof config === 'string' && config.startsWith('{')) {
    return normalizeWebDavConfig(JSON.parse(config));
  }
  if (typeof config === 'string') {
    return normalizeWebDavConfig({ url: config });
  }
  return normalizeWebDavConfig(config);
}

function normalizeWebDavConfig(config) {
  const url = new URL(String(config.url || ''));
  const directoryUrl = url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`;
  const headers = {};
  if (config.username || config.password) {
    const token = Buffer.from(`${config.username || ''}:${config.password || ''}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return { directoryUrl, headers };
}

function webDavFileUrl(config, fileName) {
  const safeName = encodeURIComponent(path.basename(String(fileName || '')));
  return new URL(safeName, config.directoryUrl).toString();
}

async function webDavRequest(config, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...config.headers,
      ...(options.headers || {}),
    },
  });
  if (!response.ok && ![207, 201, 204].includes(response.status)) {
    throw new Error(`WebDAV ${options.method || 'GET'} failed with HTTP ${response.status}`);
  }
  return response;
}

function parseWebDavFiles(xml) {
  const files = new Set();
  const hrefRegex = /<[^:>]*(?::)?href[^>]*>([^<]+)<\/[^:>]*(?::)?href>/gi;
  let match = hrefRegex.exec(xml);
  while (match) {
    const decoded = decodeURIComponent(match[1]);
    const name = path.posix.basename(decoded);
    if (name.endsWith('.actitpass-sync.json')) files.add(name);
    match = hrefRegex.exec(xml);
  }
  return Array.from(files).sort();
}

function parseFtpConfig(rawConfig) {
  const config = typeof rawConfig === 'string' ? rawConfig.trim() : rawConfig;
  if (!config) throw new Error('FTP config is required');
  if (typeof config === 'string' && config.startsWith('{')) {
    return normalizeFtpConfig(JSON.parse(config));
  }
  if (typeof config === 'string') {
    const url = new URL(config);
    if (url.protocol !== 'ftp:') throw new Error('Only ftp:// URLs are supported by the runnable adapter');
    return normalizeFtpConfig({
      host: url.hostname,
      port: url.port ? Number(url.port) : 21,
      username: decodeURIComponent(url.username || 'anonymous'),
      password: decodeURIComponent(url.password || 'anonymous@'),
      path: decodeURIComponent(url.pathname || '/'),
    });
  }
  return normalizeFtpConfig(config);
}

function normalizeFtpConfig(config) {
  return {
    host: String(config.host || ''),
    port: Number(config.port || 21),
    username: String(config.username || config.user || 'anonymous'),
    password: String(config.password || 'anonymous@'),
    path: String(config.path || config.directory || '/'),
  };
}

class FtpClient {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = '';
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.config.host, port: this.config.port }, async () => {
        try {
          await this.readResponse([220]);
          await this.command(`USER ${this.config.username}`, [230, 331]);
          if (this.lastCode === 331) await this.command(`PASS ${this.config.password}`, [230]);
          await this.command('TYPE I', [200]);
          if (this.config.path && this.config.path !== '/') await this.command(`CWD ${this.config.path}`, [250]);
          resolve(this);
        } catch (error) {
          reject(error);
        }
      });
      this.socket.on('data', (chunk) => this.onData(chunk));
      this.socket.on('error', reject);
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    this.flushWaiters();
  }

  flushWaiters() {
    while (this.waiters.length) {
      const response = this.extractResponse();
      if (!response) return;
      this.waiters.shift()(response);
    }
  }

  extractResponse() {
    const lines = this.buffer.split(/\r?\n/);
    if (lines.length < 2) return null;
    const complete = [];
    while (lines.length > 1) {
      const line = lines.shift();
      complete.push(line);
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.join('\r\n');
        return complete.join('\n');
      }
    }
    return null;
  }

  readResponse(expectedCodes) {
    return new Promise((resolve, reject) => {
      const handle = (response) => {
        const code = Number(response.slice(0, 3));
        this.lastCode = code;
        if (!expectedCodes.includes(code)) {
          reject(new Error(`FTP expected ${expectedCodes.join('/')} but got ${response}`));
          return;
        }
        resolve(response);
      };
      this.waiters.push(handle);
      this.flushWaiters();
    });
  }

  async command(command, expectedCodes) {
    this.socket.write(`${command}\r\n`);
    return this.readResponse(expectedCodes);
  }

  async openPassiveDataSocket() {
    const response = await this.command('PASV', [227]);
    const match = response.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!match) throw new Error(`FTP PASV parse failed: ${response}`);
    const host = match.slice(1, 5).join('.');
    const port = (Number(match[5]) * 256) + Number(match[6]);
    return net.createConnection({ host, port });
  }

  async list() {
    const dataSocket = await this.openPassiveDataSocket();
    const chunks = [];
    dataSocket.on('data', (chunk) => chunks.push(chunk));
    const closed = new Promise((resolve, reject) => {
      dataSocket.on('end', resolve);
      dataSocket.on('error', reject);
    });
    await this.command('LIST', [150, 125]);
    await closed;
    await this.readResponse([226]);
    return Buffer.concat(chunks).toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/).pop())
      .filter((name) => name && name.endsWith('.actitpass-sync.json'))
      .sort();
  }

  async read(fileName) {
    const dataSocket = await this.openPassiveDataSocket();
    const chunks = [];
    dataSocket.on('data', (chunk) => chunks.push(chunk));
    const closed = new Promise((resolve, reject) => {
      dataSocket.on('end', resolve);
      dataSocket.on('error', reject);
    });
    await this.command(`RETR ${path.basename(fileName)}`, [150, 125]);
    await closed;
    await this.readResponse([226]);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async write(fileName, packageObject) {
    const dataSocket = await this.openPassiveDataSocket();
    await this.command(`STOR ${path.basename(fileName)}`, [150, 125]);
    dataSocket.end(JSON.stringify(packageObject, null, 2));
    await new Promise((resolve, reject) => {
      dataSocket.on('close', resolve);
      dataSocket.on('error', reject);
    });
    await this.readResponse([226]);
  }

  close() {
    if (!this.socket) return;
    this.socket.write('QUIT\r\n');
    this.socket.end();
  }
}

async function withFtpClient(rawConfig, callback) {
  const client = new FtpClient(parseFtpConfig(rawConfig));
  await client.connect();
  try {
    return await callback(client);
  } finally {
    client.close();
  }
}

function parseEmailConfig(rawConfig) {
  const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
  if (!config) throw new Error('Email config is required');
  return {
    email: String(config.email || ''),
    login: String(config.login || config.email || ''),
    password: String(config.password || ''),
    imapHost: String(config.imapHost || ''),
    imapPort: Number(config.imapPort || 993),
    smtpHost: String(config.smtpHost || ''),
    smtpPort: Number(config.smtpPort || 465),
    folder: String(config.folder || 'ActitPassStorage'),
    imapTls: config.imapTls === undefined ? Number(config.imapPort || 993) === 993 : Boolean(config.imapTls),
    smtpTls: config.smtpTls === undefined ? Number(config.smtpPort || 465) === 465 : Boolean(config.smtpTls),
  };
}

function encodeMimeWords(value) {
  return String(value || '').replace(/[\r\n]/g, ' ');
}

function wrapBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
}

function mailFileName(fileName, packageObject) {
  const safe = path.basename(String(fileName || ''));
  if (safe.endsWith('.actitpass-sync.json')) return safe;
  const fallback = `${String(packageObject?.packageId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '')}.actitpass-sync.json`;
  return fallback;
}

class LineProtocolClient {
  constructor({ host, port, secure = false }) {
    this.host = host;
    this.port = port;
    this.secure = secure;
    this.socket = null;
    this.buffer = '';
  }

  connect() {
    return new Promise((resolve, reject) => {
      const options = { host: this.host, port: this.port, servername: this.host, rejectUnauthorized: false };
      this.socket = this.secure ? tls.connect(options, resolve) : net.createConnection(options, resolve);
      this.socket.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
      });
      this.socket.on('error', reject);
    });
  }

  write(line) {
    this.socket.write(`${line}\r\n`);
  }

  close() {
    if (this.socket) this.socket.end();
  }
}

class SmtpClient extends LineProtocolClient {
  constructor(config) {
    super({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpTls });
    this.config = config;
  }

  async connect() {
    await super.connect();
    await this.readResponse([220]);
    await this.command('EHLO actitpass.local', [250]);
    if (this.config.login || this.config.password) {
      const token = Buffer.from(`\0${this.config.login}\0${this.config.password}`, 'utf8').toString('base64');
      await this.command(`AUTH PLAIN ${token}`, [235, 503]);
    }
    return this;
  }

  extractResponse() {
    const lines = this.buffer.split(/\r?\n/);
    if (lines.length < 2) return null;
    const collected = [];
    while (lines.length > 1) {
      const line = lines.shift();
      collected.push(line);
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.join('\r\n');
        return collected.join('\n');
      }
    }
    return null;
  }

  readResponse(expectedCodes) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const response = this.extractResponse();
        if (!response) {
          if (Date.now() - started > 10000) reject(new Error('SMTP response timeout'));
          else setTimeout(tick, 10);
          return;
        }
        const code = Number(response.slice(0, 3));
        if (!expectedCodes.includes(code)) {
          reject(new Error(`SMTP expected ${expectedCodes.join('/')} but got ${response}`));
          return;
        }
        resolve(response);
      };
      tick();
    });
  }

  async command(command, expectedCodes) {
    this.write(command);
    return this.readResponse(expectedCodes);
  }

  async sendPackage(fileName, packageObject) {
    const safeName = mailFileName(fileName, packageObject);
    await this.command(`MAIL FROM:<${this.config.email}>`, [250]);
    await this.command(`RCPT TO:<${this.config.email}>`, [250, 251]);
    await this.command('DATA', [354]);
    const message = [
      `From: ${this.config.email}`,
      `To: ${this.config.email}`,
      `Subject: ActitPassStorage Sync ${encodeMimeWords(safeName)}`,
      `X-ActitPass-Sync: ${safeName}`,
      'MIME-Version: 1.0',
      `Content-Type: application/json; name="${safeName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeName}"`,
      '',
      wrapBase64(JSON.stringify(packageObject, null, 2)),
      '.',
    ].join('\r\n');
    this.socket.write(`${message}\r\n`);
    await this.readResponse([250]);
    await this.command('QUIT', [221]);
    return safeName;
  }
}

class ImapClient extends LineProtocolClient {
  constructor(config) {
    super({ host: config.imapHost, port: config.imapPort, secure: config.imapTls });
    this.config = config;
    this.tagCounter = 1;
  }

  async connect() {
    await super.connect();
    await this.waitFor(/\* OK[^\r\n]*(?:\r\n|\n)/i, 'IMAP greeting timeout');
    await this.command(`LOGIN ${this.quote(this.config.login)} ${this.quote(this.config.password)}`, ['OK']);
    try {
      await this.command(`SELECT ${this.quote(this.config.folder)}`, ['OK']);
    } catch (error) {
      await this.command(`CREATE ${this.quote(this.config.folder)}`, ['OK']);
      await this.command(`SELECT ${this.quote(this.config.folder)}`, ['OK']);
    }
    return this;
  }

  quote(value) {
    return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  waitFor(pattern, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const match = this.buffer.match(pattern);
        if (match) {
          const end = match.index + match[0].length;
          const response = this.buffer.slice(0, end);
          this.buffer = this.buffer.slice(end);
          resolve(response);
          return;
        }
        if (Date.now() - started > 10000) reject(new Error(timeoutMessage));
        else setTimeout(tick, 10);
      };
      tick();
    });
  }

  async command(command, okStatuses = ['OK']) {
    const tag = `A${String(this.tagCounter++).padStart(4, '0')}`;
    this.write(`${tag} ${command}`);
    const response = await this.waitFor(new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)[^\\r\\n]*(?:\\r?\\n|$)`, 'i'), `IMAP command timeout: ${command}`);
    const status = response.match(new RegExp(`${tag} (OK|NO|BAD)`, 'i'))?.[1]?.toUpperCase();
    if (!okStatuses.includes(status)) {
      throw new Error(`IMAP ${command.split(' ')[0]} failed with ${status}`);
    }
    return response;
  }

  async listPackageFiles() {
    const response = await this.command('SEARCH SUBJECT "ActitPassStorage Sync"', ['OK']);
    const ids = this.searchIds(response);
    const files = new Set();
    for (const id of ids) {
      const mail = await this.fetchMail(id);
      const parsed = parseSyncMail(mail);
      if (parsed?.fileName) files.add(parsed.fileName);
    }
    return Array.from(files).sort();
  }

  async readPackage(fileName) {
    const response = await this.command('SEARCH SUBJECT "ActitPassStorage Sync"', ['OK']);
    const ids = this.searchIds(response);
    for (const id of ids) {
      const mail = await this.fetchMail(id);
      const parsed = parseSyncMail(mail);
      if (parsed?.fileName === path.basename(String(fileName || ''))) return parsed.package;
    }
    throw new Error(`Email sync package not found: ${fileName}`);
  }

  searchIds(response) {
    const match = response.match(/\* SEARCH ([^\r\n]*)/i);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(/\s+/).filter(Boolean);
  }

  async fetchMail(id) {
    const response = await this.command(`FETCH ${id} BODY.PEEK[]`, ['OK']);
    const literal = response.match(/BODY(?:\.PEEK)?\[\]\s*\{(\d+)\}\r?\n([\s\S]*?)\r?\n\)/i);
    if (literal) return literal[2].slice(0, Number(literal[1]));
    const fallback = response.match(/BODY(?:\.PEEK)?\[\]\s+"([\s\S]*?)"\r?\n/i);
    return fallback ? fallback[1] : response;
  }
}

function parseSyncMail(mail) {
  const raw = String(mail || '');
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) return null;
  const headerText = raw.slice(0, split);
  const body = raw.slice(split).replace(/^\r?\n\r?\n?/, '').trim();
  const fileName = path.basename(
    headerText.match(/^X-ActitPass-Sync:\s*(.+)$/im)?.[1]?.trim()
    || headerText.match(/filename="?([^"\r\n;]+)"?/i)?.[1]
    || headerText.match(/^Subject:\s*ActitPassStorage Sync\s+(.+)$/im)?.[1]?.trim()
    || '',
  );
  if (!fileName.endsWith('.actitpass-sync.json')) return null;
  const isBase64 = /Content-Transfer-Encoding:\s*base64/i.test(headerText);
  const json = isBase64 ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') : body;
  return { fileName, package: JSON.parse(json) };
}

async function withImapClient(rawConfig, callback) {
  const client = new ImapClient(parseEmailConfig(rawConfig));
  await client.connect();
  try {
    return await callback(client);
  } finally {
    client.close();
  }
}

async function sendEmailPackage(rawConfig, fileName, packageObject) {
  const client = new SmtpClient(parseEmailConfig(rawConfig));
  await client.connect();
  try {
    return await client.sendPackage(fileName, packageObject);
  } finally {
    client.close();
  }
}

async function handleApi(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);

    if (req.url === '/api/mounted-folder/list') {
      const directory = path.resolve(String(body.directory || ''));
      if (!directory) {
        sendJson(res, 400, { error: 'Directory is required' });
        return;
      }
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      sendJson(res, 200, {
        files: entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.actitpass-sync.json'))
          .map((entry) => entry.name)
          .sort(),
      });
      return;
    }

    if (req.url === '/api/mounted-folder/read') {
      const directory = path.resolve(String(body.directory || ''));
      if (!directory) {
        sendJson(res, 400, { error: 'Directory is required' });
        return;
      }
      const fileName = path.basename(String(body.fileName || ''));
      const filePath = path.join(directory, fileName);
      const raw = await fs.promises.readFile(filePath, 'utf8');
      sendJson(res, 200, { package: JSON.parse(raw) });
      return;
    }

    if (req.url === '/api/mounted-folder/write') {
      const directory = path.resolve(String(body.directory || ''));
      if (!directory) {
        sendJson(res, 400, { error: 'Directory is required' });
        return;
      }
      await fs.promises.mkdir(directory, { recursive: true });
      const fileName = path.basename(String(body.fileName || `sync-${Date.now()}.actitpass-sync.json`));
      if (!fileName.endsWith('.actitpass-sync.json')) {
        sendJson(res, 400, { error: 'Invalid sync package name' });
        return;
      }
      const finalPath = path.join(directory, fileName);
      const tempPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
      await fs.promises.writeFile(tempPath, JSON.stringify(body.package, null, 2), 'utf8');
      await fs.promises.rename(tempPath, finalPath);
      sendJson(res, 200, { fileName });
      return;
    }

    if (req.url === '/api/webdav/list') {
      const config = parseWebDavConfig(body.config);
      const response = await webDavRequest(config, config.directoryUrl, {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      });
      sendJson(res, 200, { files: parseWebDavFiles(await response.text()) });
      return;
    }

    if (req.url === '/api/webdav/read') {
      const config = parseWebDavConfig(body.config);
      const response = await webDavRequest(config, webDavFileUrl(config, body.fileName), { method: 'GET' });
      sendJson(res, 200, { package: await response.json() });
      return;
    }

    if (req.url === '/api/webdav/write') {
      const config = parseWebDavConfig(body.config);
      const fileName = path.basename(String(body.fileName || `sync-${Date.now()}.actitpass-sync.json`));
      if (!fileName.endsWith('.actitpass-sync.json')) {
        sendJson(res, 400, { error: 'Invalid sync package name' });
        return;
      }
      await webDavRequest(config, webDavFileUrl(config, fileName), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body.package, null, 2),
      });
      sendJson(res, 200, { fileName });
      return;
    }

    if (req.url === '/api/ftp/list') {
      const files = await withFtpClient(body.config, (client) => client.list());
      sendJson(res, 200, { files });
      return;
    }

    if (req.url === '/api/ftp/read') {
      const packageObject = await withFtpClient(body.config, (client) => client.read(body.fileName));
      sendJson(res, 200, { package: packageObject });
      return;
    }

    if (req.url === '/api/ftp/write') {
      const fileName = path.basename(String(body.fileName || `sync-${Date.now()}.actitpass-sync.json`));
      if (!fileName.endsWith('.actitpass-sync.json')) {
        sendJson(res, 400, { error: 'Invalid sync package name' });
        return;
      }
      await withFtpClient(body.config, (client) => client.write(fileName, body.package));
      sendJson(res, 200, { fileName });
      return;
    }

    if (req.url === '/api/email/list') {
      const files = await withImapClient(body.config, (client) => client.listPackageFiles());
      sendJson(res, 200, { files });
      return;
    }

    if (req.url === '/api/email/read') {
      const packageObject = await withImapClient(body.config, (client) => client.readPackage(body.fileName));
      sendJson(res, 200, { package: packageObject });
      return;
    }

    if (req.url === '/api/email/write') {
      const fileName = mailFileName(body.fileName || `sync-${Date.now()}.actitpass-sync.json`, body.package);
      const writtenName = await sendEmailPackage(body.config, fileName, body.package);
      sendJson(res, 200, { fileName: writtenName });
      return;
    }

    sendJson(res, 404, { error: 'Unknown API route' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    handleApi(req, res);
    return;
  }

  const filePath = resolvePath(req.url || '/');
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`ActitPassStorage is running at http://${host}:${port}`);
});
