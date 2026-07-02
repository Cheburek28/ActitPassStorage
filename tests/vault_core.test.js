const assert = require('assert');
const { webcrypto } = require('crypto');
const path = require('path');

globalThis.crypto = webcrypto;
globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');
globalThis.localStorage = {
  values: new Map(),
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  },
  setItem(key, value) {
    this.values.set(key, String(value));
  },
  removeItem(key) {
    this.values.delete(key);
  },
  clear() {
    this.values.clear();
  },
};

require(path.resolve(__dirname, '..', 'web', 'vault-core.js'));

const core = globalThis.ActitVaultCore;

async function expectRejects(fn, message) {
  let failed = false;
  try {
    await fn();
  } catch (error) {
    failed = true;
  }
  assert.equal(failed, true, message);
}

async function run() {
  localStorage.clear();

  const password = 'correct horse battery staple';
  const session = await core.createVault('test', password);
  assert.equal(session.data.name, 'test');
  assert.ok(session.data.templates.length >= 8);
  assert.ok(session.data.templates.some((template) => template.templateId === 'tpl_wifi'));
  assert.ok(session.data.templates.some((template) => template.templateId === 'tpl_bank'));
  assert.ok(session.data.templates.some((template) => template.name === 'Банковская карта' && template.iconId === 'card'));
  assert.ok(core.templateIcons.some((icon) => icon.id === 'bank'));
  const paymentTemplate = session.data.templates.find((template) => template.templateId === 'tpl_payment_card');
  assert.equal(paymentTemplate.fields.find((field) => field.fieldId === 'number').secret, false);
  assert.equal(paymentTemplate.fields.find((field) => field.fieldId === 'cvv').secret, true);
  const bankTemplate = session.data.templates.find((template) => template.templateId === 'tpl_bank');
  assert.equal(bankTemplate.fields.find((field) => field.fieldId === 'account_number').secret, false);
  assert.equal(bankTemplate.fields.find((field) => field.fieldId === 'password').secret, true);

  const demo = await core.createVault('demo', password, { demoData: true });
  assert.ok(demo.items().some((item) => item.title === 'Основная карта'));
  assert.ok(demo.items().some((item) => item.title === 'Счет в банке'));
  const demoCard = demo.items().find((item) => item.templateId === 'tpl_payment_card');
  assert.equal(demoCard.values.number, '4111 1111 1111 1111');
  assert.equal(demoCard.values.cvv, '123');

  const generated = core.generatePassword({ length: 32 });
  assert.equal(generated.length, 32);
  assert.match(generated, /[A-Z]/);
  assert.match(generated, /[a-z]/);
  assert.match(generated, /[0-9]/);
  assert.match(generated, /[!@#$%^&*_\-+=?]/);

  const totp = await core.generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000, 30, 6);
  assert.equal(totp, '287082');

  await session.saveItem({
    templateId: 'tpl_password',
    title: 'Email account',
    category: 'Personal',
    tags: 'mail, primary',
    colorId: 'blue',
    values: {
      username: 'alice@example.test',
      password: 'super-secret-value',
      url: 'https://mail.example.test',
      notes: 'private note',
    },
  });

  const raw = localStorage.getItem(core.storageKey('test'));
  assert.ok(raw.includes('ActitPassStorageVault'));
  assert.equal(raw.includes('super-secret-value'), false, 'vault envelope must not contain plaintext password');
  assert.equal(raw.includes('private note'), false, 'vault envelope must not contain plaintext note');

  const reopened = await core.openVault('test', password);
  assert.equal(reopened.items().length, 1);
  assert.equal(reopened.items()[0].values.password, 'super-secret-value');

  await expectRejects(() => core.openVault('test', 'wrong password'), 'wrong password should be rejected');

  await reopened.saveTemplate({
    name: 'API token',
    colorId: 'green',
    fields: [
      { label: 'Service', type: 'text', required: true, secret: false },
      { label: 'Token', type: 'custom_secret', required: true, secret: true },
    ],
  });
  assert.ok(reopened.templates().some((template) => template.name === 'API token'));

  const packageObject = await reopened.exportSyncPackage();
  assert.equal(JSON.stringify(packageObject).includes('super-secret-value'), false, 'sync package must not contain plaintext secret');

  const second = await core.openEnvelope(packageObject.envelope, password);
  assert.equal(second.items()[0].title, 'Email account');

  const remote = await core.openEnvelope(packageObject.envelope, password);
  remote.data.deviceId = 'remote-device';
  remote.data.items[0].title = 'Email account remote';
  remote.data.items[0].modifiedAt = '2999-01-01T00:00:00.000Z';
  await remote.persist();
  const remotePackage = await remote.exportSyncPackage();
  assert.equal(remotePackage.sourceDeviceId, 'remote-device');

  const local = await core.openEnvelope(packageObject.envelope, password);
  const applied = await local.importSyncPackage(remotePackage, password);
  assert.equal(applied.status, 'applied');
  assert.equal(local.items()[0].title, 'Email account remote');
  assert.equal(local.data.conflicts.length, 1);
  assert.equal(local.data.sync.appliedPackageIds.includes(remotePackage.packageId), true);

  const duplicate = await local.importSyncPackage(remotePackage, password);
  assert.equal(duplicate.status, 'skipped_duplicate');
  assert.equal(local.data.conflicts.length, 1);

  const ownPackage = await local.exportSyncPackage();
  const own = await local.importSyncPackage(ownPackage, password);
  assert.equal(own.status, 'skipped_own_device');

  await local.reviewConflict(local.data.conflicts[0].conflictId);
  assert.equal(local.data.conflicts[0].reviewed, true);

  await local.updateSettings({ autoLockMinutes: 12, clipboardClearSeconds: 45 });
  assert.equal(local.data.settings.autoLockMinutes, 12);
  assert.equal(local.data.settings.clipboardClearSeconds, 45);

  console.log('vault_core.test.js: all tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
