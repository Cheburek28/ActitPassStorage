const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const port = 4184;
const webDavPort = 4185;
const ftpPort = 4186;
const imapPort = 4187;
const smtpPort = 4188;
const directory = path.join(os.tmpdir(), 'actitpass-sync-api-test');

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('dev server did not start')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`http://127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`dev server exited with ${code}`));
      }
    });
  });
}

async function post(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

function startFakeWebDav() {
  const files = new Map();
  const server = http.createServer((req, res) => {
    const fileName = path.posix.basename(decodeURIComponent(req.url || ''));
    if (req.method === 'PROPFIND') {
      const hrefs = Array.from(files.keys())
        .map((name) => `<d:response><d:href>/dav/${encodeURIComponent(name)}</d:href></d:response>`)
        .join('');
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${hrefs}</d:multistatus>`);
      return;
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        files.set(fileName, body);
        res.writeHead(201);
        res.end();
      });
      return;
    }
    if (req.method === 'GET' && files.has(fileName)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(files.get(fileName));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(webDavPort, '127.0.0.1', () => resolve(server));
  });
}

function startFakeFtp() {
  const files = new Map();
  const server = net.createServer((socket) => {
    let cwd = '/';
    let passiveServer = null;
    let passiveSocket = null;

    function write(line) {
      socket.write(`${line}\r\n`);
    }

    function openPassiveServer(callback) {
      if (passiveServer) passiveServer.close();
      passiveSocket = null;
      passiveServer = net.createServer((dataSocket) => {
        passiveSocket = dataSocket;
      });
      passiveServer.listen(0, '127.0.0.1', () => {
        const dataPort = passiveServer.address().port;
        const p1 = Math.floor(dataPort / 256);
        const p2 = dataPort % 256;
        callback(`227 Entering Passive Mode (127,0,0,1,${p1},${p2})`);
      });
    }

    function waitForPassiveSocket() {
      return new Promise((resolve) => {
        if (passiveSocket) {
          resolve(passiveSocket);
          return;
        }
        passiveServer.once('connection', resolve);
      });
    }

    write('220 fake ftp ready');
    socket.on('data', async (chunk) => {
      const commands = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const commandLine of commands) {
        const [commandRaw, ...rest] = commandLine.split(' ');
        const command = commandRaw.toUpperCase();
        const arg = rest.join(' ');
        if (command === 'USER') write('331 password required');
        else if (command === 'PASS') write('230 logged in');
        else if (command === 'TYPE') write('200 type set');
        else if (command === 'CWD') {
          cwd = arg || '/';
          write('250 cwd ok');
        } else if (command === 'PASV') {
          openPassiveServer(write);
        } else if (command === 'LIST') {
          write('150 opening list');
          const dataSocket = await waitForPassiveSocket();
          const listing = Array.from(files.keys())
            .map((name) => `-rw-r--r-- 1 user group ${files.get(name).length} Jan 01 00:00 ${name}`)
            .join('\r\n');
          dataSocket.end(`${listing}\r\n`);
          if (passiveServer) passiveServer.close();
          write('226 list done');
        } else if (command === 'RETR') {
          write('150 opening retr');
          const dataSocket = await waitForPassiveSocket();
          dataSocket.end(files.get(path.posix.basename(arg)) || '');
          if (passiveServer) passiveServer.close();
          write('226 retr done');
        } else if (command === 'STOR') {
          write('150 opening stor');
          const dataSocket = await waitForPassiveSocket();
          let body = '';
          dataSocket.on('data', (data) => {
            body += data.toString('utf8');
          });
          dataSocket.on('end', () => {
            files.set(path.posix.basename(arg), body);
            if (passiveServer) passiveServer.close();
            write('226 stor done');
          });
        } else if (command === 'QUIT') {
          write('221 bye');
          socket.end();
        } else if (command === 'PWD') {
          write(`257 "${cwd}"`);
        } else {
          write('200 ok');
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(ftpPort, '127.0.0.1', () => resolve(server));
  });
}

function startFakeEmail() {
  const messages = [];

  const smtp = net.createServer((socket) => {
    let buffer = '';
    let dataMode = false;

    function write(line) {
      socket.write(`${line}\r\n`);
    }

    function readLines() {
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      return lines.filter(Boolean);
    }

    write('220 fake smtp ready');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (dataMode) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        messages.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 5);
        dataMode = false;
        write('250 stored');
      }

      for (const line of readLines()) {
        const command = line.split(' ')[0].toUpperCase();
        if (command === 'EHLO' || command === 'HELO') write('250 fake smtp');
        else if (command === 'AUTH') write('235 auth ok');
        else if (command === 'MAIL') write('250 sender ok');
        else if (command === 'RCPT') write('250 recipient ok');
        else if (command === 'DATA') {
          dataMode = true;
          write('354 end with dot');
        } else if (command === 'QUIT') {
          write('221 bye');
          socket.end();
        } else {
          write('250 ok');
        }
      }
    });
  });

  const imap = net.createServer((socket) => {
    let buffer = '';

    function write(value) {
      socket.write(value.endsWith('\r\n') ? value : `${value}\r\n`);
    }

    write('* OK fake imap ready');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const [tag, rawCommand, ...rest] = line.split(' ');
        const command = String(rawCommand || '').toUpperCase();
        if (command === 'LOGIN') {
          write(`${tag} OK login`);
        } else if (command === 'CREATE') {
          write(`${tag} OK create`);
        } else if (command === 'SELECT') {
          write(`* ${messages.length} EXISTS\r\n${tag} OK select`);
        } else if (command === 'SEARCH') {
          const ids = messages.map((_, index) => index + 1).join(' ');
          write(`* SEARCH ${ids}\r\n${tag} OK search`);
        } else if (command === 'FETCH') {
          const id = Number(rest[0]);
          const message = messages[id - 1] || '';
          write(`* ${id} FETCH (BODY[] {${Buffer.byteLength(message, 'utf8')}}\r\n${message}\r\n)\r\n${tag} OK fetch`);
        } else if (command === 'LOGOUT') {
          write(`* BYE\r\n${tag} OK logout`);
          socket.end();
        } else {
          write(`${tag} OK ok`);
        }
      }
    });
  });

  return new Promise((resolve) => {
    smtp.listen(smtpPort, '127.0.0.1', () => {
      imap.listen(imapPort, '127.0.0.1', () => resolve({ smtp, imap }));
    });
  });
}

async function run() {
  await fs.promises.rm(directory, { recursive: true, force: true });
  await fs.promises.mkdir(directory, { recursive: true });
  const webDav = await startFakeWebDav();
  const ftp = await startFakeFtp();
  const email = await startFakeEmail();

  const child = spawn(process.execPath, ['tools/dev-server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);
    const packageObject = {
      packageId: 'pkg_test',
      formatVersion: 1,
      vaultName: 'test',
      envelope: { payload: { data: 'encrypted' } },
    };
    const fileName = 'test.actitpass-sync.json';
    const written = await post('/api/mounted-folder/write', { directory, fileName, package: packageObject });
    assert.equal(written.fileName, fileName);

    const listed = await post('/api/mounted-folder/list', { directory });
    assert.deepEqual(listed.files, [fileName]);

    const read = await post('/api/mounted-folder/read', { directory, fileName });
    assert.equal(read.package.packageId, 'pkg_test');

    const webDavConfig = { url: `http://127.0.0.1:${webDavPort}/dav/` };
    const webDavFileName = 'webdav.actitpass-sync.json';
    const webDavWritten = await post('/api/webdav/write', { config: webDavConfig, fileName: webDavFileName, package: packageObject });
    assert.equal(webDavWritten.fileName, webDavFileName);

    const webDavListed = await post('/api/webdav/list', { config: webDavConfig });
    assert.deepEqual(webDavListed.files, [webDavFileName]);

    const webDavRead = await post('/api/webdav/read', { config: webDavConfig, fileName: webDavFileName });
    assert.equal(webDavRead.package.packageId, 'pkg_test');

    const ftpConfig = `ftp://user:pass@127.0.0.1:${ftpPort}/sync/`;
    const ftpFileName = 'ftp.actitpass-sync.json';
    const ftpWritten = await post('/api/ftp/write', { config: ftpConfig, fileName: ftpFileName, package: packageObject });
    assert.equal(ftpWritten.fileName, ftpFileName);

    const ftpListed = await post('/api/ftp/list', { config: ftpConfig });
    assert.deepEqual(ftpListed.files, [ftpFileName]);

    const ftpRead = await post('/api/ftp/read', { config: ftpConfig, fileName: ftpFileName });
    assert.equal(ftpRead.package.packageId, 'pkg_test');

    const emailConfig = {
      email: 'sync@example.test',
      login: 'sync@example.test',
      password: 'app-password',
      imapHost: '127.0.0.1',
      imapPort,
      smtpHost: '127.0.0.1',
      smtpPort,
      folder: 'ActitPassStorage',
      imapTls: false,
      smtpTls: false,
    };
    const emailFileName = 'mail.actitpass-sync.json';
    const emailWritten = await post('/api/email/write', { config: emailConfig, fileName: emailFileName, package: packageObject });
    assert.equal(emailWritten.fileName, emailFileName);

    const emailListed = await post('/api/email/list', { config: emailConfig });
    assert.deepEqual(emailListed.files, [emailFileName]);

    const emailRead = await post('/api/email/read', { config: emailConfig, fileName: emailFileName });
    assert.equal(emailRead.package.packageId, 'pkg_test');

    console.log('dev_server_api.test.js: all tests passed');
  } finally {
    child.kill('SIGTERM');
    webDav.close();
    ftp.close();
    email.smtp.close();
    email.imap.close();
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
