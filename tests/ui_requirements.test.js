const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'web', 'vault-core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web', 'styles.css'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'web', 'manifest.json'), 'utf8');

function includesAll(source, values, label) {
  values.forEach((value) => {
    assert.ok(source.includes(value), `${label}: missing ${value}`);
  });
}

includesAll(core, [
  'Пароль',
  'Защищенная заметка',
  'Банковская карта',
  'Документ',
  'Банковский счет',
  'Лицензия ПО',
  'Доступ к серверу',
  'Wi-Fi',
  "iconId: 'card'",
  "iconId: 'bank'",
], 'localized built-in templates');

includesAll(html, [
  'item-color-swatches',
  'template-color-swatches',
  'template-icon-picker',
  'sync-form',
  'open-sync-help',
  'test-sync-settings',
  'sync-help-dialog',
  'master-password-confirm',
  'create-demo-data',
  'password-prompt-dialog',
  'password-prompt-input',
  'settings-palette',
  'settings-icons',
], 'required UI controls');

includesAll(css, [
  '.swatch-button',
  '.color-dot',
  '.icon-choice',
  '.eye-button',
  '.value-row',
  '.sync-form',
  '.help-content',
  '.palette-gallery',
  '.icon-gallery',
  '.gallery-chip',
  'flex-wrap: wrap',
], 'layout and visual controls');

includesAll(app, [
  "provider === 'mounted_folder'",
  "provider === 'email'",
  "provider === 'webdav'",
  "provider === 'sftp'",
  "FTP/FTPS",
  'Как настроить',
  'Почта IMAP/SMTP',
  'Папка / SMB / NFS',
  'Обычный FTP',
  'Проверка не прошла',
  'пакетов синхронизации',
  'data-toggle-field',
  'data-toggle-input',
  'data-toggle-sync-field',
  'data-reveal',
], 'sync forms and help');

[
  ['mounted_folder', 'Папка / SMB / NFS', 'directory'],
  ['email', 'Почта IMAP/SMTP', 'imapHost'],
  ['webdav', 'WebDAV', 'url'],
  ['sftp', 'SFTP', 'host'],
  ['ftp', 'FTP/FTPS', 'security'],
].forEach(([provider, title, field]) => {
  assert.ok(app.includes(`provider === '${provider}'`) || app.includes(`${provider}: [`), `provider form missing: ${provider}`);
  assert.ok(app.includes(`${provider}: [`), `provider validation missing: ${provider}`);
  assert.ok(app.includes(`${provider}: ['${title}'`), `provider help missing: ${provider}`);
  assert.ok(app.includes(`id: '${field}'`), `provider field missing: ${provider}/${field}`);
});

assert.ok(!manifest.includes('Local-first'), 'manifest description should be localized');
assert.ok(!app.includes('prompt('), 'password prompts must use the revealable in-app dialog');
assert.ok(!app.includes('.slice(0, 2)'), 'secret fields must not be truncated in cards');
assert.ok(!app.includes('.slice(0, 3)'), 'visible fields must not be truncated in cards');
assert.ok(!fs.readFileSync(path.join(root, 'package.json'), 'utf8').includes('Local-first'), 'package metadata should be localized');

console.log('ui_requirements.test.js: all tests passed');
