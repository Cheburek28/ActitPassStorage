(function attachVaultCore(global) {
  const CURRENT_VERSION = 1;
  const DEFAULT_KDF = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 250000,
  };

  const palette = [
    { id: 'neutral', label: 'Серый', bg: '#e7eaee', fg: '#222831' },
    { id: 'blue', label: 'Синий', bg: '#d9e6f6', fg: '#17375f' },
    { id: 'green', label: 'Зеленый', bg: '#dcebdc', fg: '#1f4d32' },
    { id: 'teal', label: 'Бирюзовый', bg: '#d8eceb', fg: '#1f5052' },
    { id: 'violet', label: 'Фиолетовый', bg: '#e6def0', fg: '#4a3568' },
    { id: 'red', label: 'Красный', bg: '#f2dddc', fg: '#6a2b2b' },
    { id: 'amber', label: 'Янтарный', bg: '#f3e7ca', fg: '#5d4318' },
  ];

  const templateIcons = [
    { id: 'key', label: 'Ключ', symbol: '🔑' },
    { id: 'note', label: 'Заметка', symbol: '📝' },
    { id: 'card', label: 'Банковская карта', symbol: '💳' },
    { id: 'id', label: 'Документ', symbol: '🪪' },
    { id: 'server', label: 'Сервер', symbol: '🖥️' },
    { id: 'license', label: 'Лицензия', symbol: '🏷️' },
    { id: 'wifi', label: 'Wi-Fi', symbol: '📶' },
    { id: 'bank', label: 'Банк', symbol: '🏦' },
    { id: 'mail', label: 'Почта', symbol: '✉️' },
    { id: 'shield', label: 'Защита', symbol: '🛡️' },
  ];

  const fieldTypes = [
    'text',
    'password',
    'multiline_note',
    'url',
    'email',
    'phone',
    'username',
    'number',
    'date',
    'totp',
    'custom_secret',
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${prefix}_${hex}`;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return global.btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = global.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function encodeJson(value) {
    return new TextEncoder().encode(JSON.stringify(value));
  }

  function decodeJson(bytes) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function deriveKey(password, salt, kdf = DEFAULT_KDF) {
    const material = await global.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return global.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: kdf.iterations,
        hash: kdf.hash,
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async function encryptJson(key, value, aadText = '') {
    const nonce = new Uint8Array(12);
    global.crypto.getRandomValues(nonce);
    const encrypted = await global.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: new TextEncoder().encode(aadText),
      },
      key,
      encodeJson(value),
    );
    return {
      alg: 'AES-256-GCM',
      nonce: bytesToBase64(nonce),
      data: bytesToBase64(new Uint8Array(encrypted)),
    };
  }

  async function decryptJson(key, envelope, aadText = '') {
    const decrypted = await global.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.nonce),
        additionalData: new TextEncoder().encode(aadText),
      },
      key,
      base64ToBytes(envelope.data),
    );
    return decodeJson(new Uint8Array(decrypted));
  }

  function storageKey(name) {
    return `actitpass:vault:${name}`;
  }

  function defaultTemplates(timestamp = nowIso()) {
    return [
      {
        templateId: 'tpl_password',
        name: 'Пароль',
        builtIn: true,
        iconId: 'key',
        colorId: 'blue',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [
          field('username', 'Логин', 'username', false, false, true),
          field('password', 'Пароль', 'password', true, true, false),
          field('url', 'Сайт', 'url', false, false, true),
          field('notes', 'Заметки', 'multiline_note', false, false, false),
        ],
      },
      {
        templateId: 'tpl_note',
        name: 'Защищенная заметка',
        builtIn: true,
        iconId: 'note',
        colorId: 'neutral',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [field('note', 'Текст заметки', 'multiline_note', true, false, false)],
      },
      {
        templateId: 'tpl_payment_card',
        name: 'Банковская карта',
        builtIn: true,
        iconId: 'card',
        colorId: 'teal',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [
          field('holder', 'Владелец карты', 'text', false, false, true),
          field('number', 'Номер карты', 'custom_secret', true, false, false),
          field('expires', 'Действует до', 'date', false, false, false),
          field('cvv', 'CVV', 'password', false, true, false),
        ],
      },
      {
        templateId: 'tpl_identity',
        name: 'Документ',
        builtIn: true,
        iconId: 'id',
        colorId: 'violet',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [
          field('full_name', 'ФИО', 'text', true, false, true),
          field('document_number', 'Номер документа', 'custom_secret', true, false, false),
          field('issued_at', 'Дата выдачи', 'date', false, false, false),
          field('notes', 'Заметки', 'multiline_note', false, false, false),
        ],
      },
      {
        templateId: 'tpl_server',
        name: 'Доступ к серверу',
        builtIn: true,
        iconId: 'server',
        colorId: 'green',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [
          field('host', 'Хост', 'url', true, false, true),
          field('username', 'Пользователь', 'username', true, false, true),
          field('password', 'Пароль или фраза ключа', 'password', false, true, false),
          field('notes', 'Заметки', 'multiline_note', false, false, false),
        ],
      },
      {
        templateId: 'tpl_license',
        name: 'Лицензия ПО',
        builtIn: true,
        iconId: 'license',
        colorId: 'amber',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [
          field('product', 'Продукт', 'text', true, false, true),
          field('license_key', 'Лицензионный ключ', 'custom_secret', true, false, false),
          field('email', 'Email аккаунта', 'email', false, false, true),
        ],
      },
      {
        templateId: 'tpl_wifi',
        name: 'Wi-Fi',
        builtIn: true,
        iconId: 'wifi',
        colorId: 'green',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [
          field('ssid', 'Название сети', 'text', true, false, true),
          field('password', 'Пароль Wi-Fi', 'password', true, true, false),
          field('security', 'Тип защиты', 'text', false, false, true),
          field('notes', 'Заметки', 'multiline_note', false, false, false),
        ],
      },
      {
        templateId: 'tpl_bank',
        name: 'Банковский счет',
        builtIn: true,
        iconId: 'bank',
        colorId: 'red',
        createdAt: timestamp,
        modifiedAt: timestamp,
        fields: [
          field('bank_name', 'Название банка', 'text', true, false, true),
          field('account_number', 'Номер счета', 'custom_secret', true, false, false),
          field('routing', 'БИК / SWIFT / маршрутный номер', 'custom_secret', false, false, false),
          field('login', 'Логин интернет-банка', 'username', false, false, true),
          field('password', 'Пароль интернет-банка', 'password', false, true, false),
        ],
      },
    ];
  }

  function field(id, label, type, required, secret, searchable) {
    return {
      fieldId: id,
      label,
      type,
      required,
      secret,
      searchable,
      copyable: secret || type === 'url' || type === 'email',
    };
  }

  function emptyVault(name) {
    const timestamp = nowIso();
    return {
      version: CURRENT_VERSION,
      vaultId: makeId('vault'),
      name,
      deviceId: makeId('device'),
      createdAt: timestamp,
      modifiedAt: timestamp,
      templates: defaultTemplates(timestamp),
      items: [],
      changeLog: [],
      conflicts: [],
      sync: {
        provider: 'mounted_folder',
        config: '',
        lastSyncAt: null,
        appliedPackageIds: [],
        lastPackageId: null,
        lastPackageSourceDeviceId: null,
      },
      settings: {
        autoLockMinutes: 5,
        clipboardClearSeconds: 30,
      },
    };
  }

  function sanitizeTemplate(template) {
    const timestamp = nowIso();
    const templateId = template.templateId || makeId('tpl');
    return {
      templateId,
      name: String(template.name || 'Пользовательский шаблон').trim(),
      builtIn: Boolean(template.builtIn),
      iconId: validIcon(template.iconId),
      colorId: validColor(template.colorId),
      createdAt: template.createdAt || timestamp,
      modifiedAt: timestamp,
      fields: (template.fields || []).map((item, index) => ({
        fieldId: item.fieldId || `field_${index + 1}`,
        label: String(item.label || `Field ${index + 1}`).trim(),
        type: fieldTypes.includes(item.type) ? item.type : 'text',
        required: Boolean(item.required),
        secret: Boolean(item.secret || ['password', 'totp', 'custom_secret'].includes(item.type)),
        searchable: Boolean(item.searchable && !item.secret),
        copyable: Boolean(item.copyable || item.secret),
      })),
    };
  }

  function validColor(colorId) {
    return palette.some((color) => color.id === colorId) ? colorId : 'neutral';
  }

  function validIcon(iconId) {
    return templateIcons.some((icon) => icon.id === iconId) ? iconId : 'key';
  }

  function refreshBuiltInTemplates(templates) {
    const builtInList = defaultTemplates();
    const builtIns = new Map(builtInList.map((template) => [template.templateId, template]));
    const existingIds = new Set(templates.map((template) => template.templateId));
    const refreshed = templates.map((template) => {
      const builtin = builtIns.get(template.templateId);
      if (!builtin || !template.builtIn) return { ...template, iconId: validIcon(template.iconId) };
      return {
        ...template,
        name: builtin.name,
        iconId: builtin.iconId,
        colorId: template.colorId || builtin.colorId,
        fields: builtin.fields,
      };
    });
    builtInList.forEach((template) => {
      if (!existingIds.has(template.templateId)) refreshed.push(template);
    });
    return refreshed;
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean);
    return String(value || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function normalizeVaultData(data) {
    const next = data;
    next.version = next.version || CURRENT_VERSION;
    next.templates = refreshBuiltInTemplates(Array.isArray(next.templates) ? next.templates : []);
    next.items = Array.isArray(next.items) ? next.items : [];
    next.changeLog = Array.isArray(next.changeLog) ? next.changeLog : [];
    next.conflicts = Array.isArray(next.conflicts) ? next.conflicts : [];
    next.sync = {
      provider: 'mounted_folder',
      config: '',
      lastSyncAt: null,
      appliedPackageIds: [],
      lastPackageId: null,
      lastPackageSourceDeviceId: null,
      ...(next.sync || {}),
    };
    next.sync.appliedPackageIds = Array.isArray(next.sync.appliedPackageIds) ? next.sync.appliedPackageIds : [];
    next.settings = {
      autoLockMinutes: 5,
      clipboardClearSeconds: 30,
      ...(next.settings || {}),
    };
    return next;
  }

  class VaultSession {
    constructor(name, key, envelope, data) {
      this.name = name;
      this.key = key;
      this.envelope = JSON.parse(JSON.stringify(envelope));
      this.data = normalizeVaultData(JSON.parse(JSON.stringify(data)));
    }

    get locked() {
      return !this.key;
    }

    async persist() {
      if (!this.key) throw new Error('VaultLocked');
      this.data.modifiedAt = nowIso();
      this.envelope.payload = await encryptJson(this.key, this.data, this.envelope.vaultId);
      this.envelope.modifiedAt = this.data.modifiedAt;
      localStorage.setItem(storageKey(this.name), JSON.stringify(this.envelope));
      return this.snapshot();
    }

    snapshot() {
      return JSON.parse(JSON.stringify(this.data));
    }

    templates() {
      return this.snapshot().templates;
    }

    items() {
      return this.snapshot().items.filter((item) => !item.deletedAt);
    }

    recordChange(type, objectId, before, after) {
      const timestamp = nowIso();
      this.data.changeLog.push({
        changeId: makeId('chg'),
        vaultId: this.data.vaultId,
        deviceId: this.data.deviceId,
        type,
        objectId,
        modifiedAt: timestamp,
        before,
        after,
      });
    }

    async saveTemplate(template) {
      const clean = sanitizeTemplate(template);
      const index = this.data.templates.findIndex((item) => item.templateId === clean.templateId);
      const before = index >= 0 ? JSON.parse(JSON.stringify(this.data.templates[index])) : null;
      if (index >= 0) this.data.templates[index] = { ...this.data.templates[index], ...clean, builtIn: before.builtIn };
      else this.data.templates.push(clean);
      this.recordChange(index >= 0 ? 'template_update' : 'template_create', clean.templateId, before, clean);
      return this.persist();
    }

    async saveItem(input) {
      const timestamp = nowIso();
      const template = this.data.templates.find((item) => item.templateId === input.templateId);
      if (!template) throw new Error('TemplateNotFound');
      const itemId = input.itemId || makeId('item');
      const before = this.data.items.find((item) => item.itemId === itemId) || null;
      const values = {};
      template.fields.forEach((templateField) => {
        values[templateField.fieldId] = String((input.values || {})[templateField.fieldId] || '');
      });
      const next = {
        itemId,
        templateId: input.templateId,
        title: String(input.title || '').trim(),
        category: String(input.category || '').trim(),
        tags: normalizeTags(input.tags),
        colorId: validColor(input.colorId || template.colorId),
        values,
        createdAt: before ? before.createdAt : timestamp,
        modifiedAt: timestamp,
        revision: before ? before.revision + 1 : 1,
        deletedAt: null,
      };
      if (!next.title) throw new Error('TitleRequired');
      template.fields.forEach((templateField) => {
        if (templateField.required && !next.values[templateField.fieldId]) {
          throw new Error(`Required:${templateField.label}`);
        }
      });
      const index = this.data.items.findIndex((item) => item.itemId === itemId);
      if (index >= 0) this.data.items[index] = next;
      else this.data.items.push(next);
      this.recordChange(before ? 'item_update' : 'item_create', itemId, before, next);
      return this.persist();
    }

    async deleteItem(itemId) {
      const index = this.data.items.findIndex((item) => item.itemId === itemId);
      if (index < 0) return this.snapshot();
      const before = JSON.parse(JSON.stringify(this.data.items[index]));
      this.data.items[index].deletedAt = nowIso();
      this.data.items[index].modifiedAt = this.data.items[index].deletedAt;
      this.data.items[index].revision += 1;
      this.recordChange('item_delete', itemId, before, this.data.items[index]);
      return this.persist();
    }

    async configureSync(provider, config) {
      this.data.sync.provider = provider;
      this.data.sync.config = config;
      this.recordChange('sync_config_update', this.data.vaultId, null, this.data.sync);
      return this.persist();
    }

    async updateSettings(settings) {
      this.data.settings = {
        ...this.data.settings,
        autoLockMinutes: clampInt(settings.autoLockMinutes, 1, 120, this.data.settings.autoLockMinutes),
        clipboardClearSeconds: clampInt(settings.clipboardClearSeconds, 5, 300, this.data.settings.clipboardClearSeconds),
      };
      this.recordChange('settings_update', this.data.vaultId, null, this.data.settings);
      return this.persist();
    }

    async exportEncrypted() {
      await this.persist();
      return JSON.parse(localStorage.getItem(storageKey(this.name)));
    }

    async exportSyncPackage() {
      await this.persist();
      return {
        packageId: makeId('pkg'),
        formatVersion: CURRENT_VERSION,
        providerHint: this.data.sync.provider,
        exportedAt: nowIso(),
        vaultId: this.data.vaultId,
        vaultName: this.name,
        sourceDeviceId: this.data.deviceId,
        changeIds: this.data.changeLog.map((change) => change.changeId),
        envelope: JSON.parse(localStorage.getItem(storageKey(this.name))),
      };
    }

    async mergeSnapshot(remoteData, provider = 'manual') {
      if (remoteData.vaultId !== this.data.vaultId) throw new Error('VaultMismatch');
      const byId = new Map(this.data.items.map((item) => [item.itemId, item]));
      remoteData.items.forEach((remoteItem) => {
        const localItem = byId.get(remoteItem.itemId);
        if (!localItem) {
          this.data.items.push(remoteItem);
          return;
        }
        if (remoteItem.modifiedAt === localItem.modifiedAt) return;
        const remoteWins = remoteItem.modifiedAt > localItem.modifiedAt;
        this.data.conflicts.push({
          conflictId: makeId('conflict'),
          objectType: 'item',
          objectId: remoteItem.itemId,
          title: remoteWins ? remoteItem.title : localItem.title,
          provider,
          winningModifiedAt: remoteWins ? remoteItem.modifiedAt : localItem.modifiedAt,
          losingModifiedAt: remoteWins ? localItem.modifiedAt : remoteItem.modifiedAt,
          winningDeviceId: remoteWins ? remoteData.deviceId : this.data.deviceId,
          losingDeviceId: remoteWins ? this.data.deviceId : remoteData.deviceId,
          winningTitle: remoteWins ? remoteItem.title : localItem.title,
          losingTitle: remoteWins ? localItem.title : remoteItem.title,
          winningRevision: remoteWins ? remoteItem.revision : localItem.revision,
          losingRevision: remoteWins ? localItem.revision : remoteItem.revision,
          createdAt: nowIso(),
          reviewed: false,
        });
        if (remoteWins) {
          const index = this.data.items.findIndex((item) => item.itemId === remoteItem.itemId);
          this.data.items[index] = remoteItem;
        }
      });
      remoteData.templates.forEach((remoteTemplate) => {
        const index = this.data.templates.findIndex((item) => item.templateId === remoteTemplate.templateId);
        if (index < 0) this.data.templates.push(remoteTemplate);
        else if (remoteTemplate.modifiedAt > this.data.templates[index].modifiedAt && !this.data.templates[index].builtIn) {
          this.data.templates[index] = remoteTemplate;
        }
      });
      this.data.sync.lastSyncAt = nowIso();
      return this.persist();
    }

    async reviewConflict(conflictId) {
      const conflict = this.data.conflicts.find((item) => item.conflictId === conflictId);
      if (!conflict) return this.snapshot();
      conflict.reviewed = true;
      conflict.reviewedAt = nowIso();
      this.recordChange('conflict_reviewed', conflictId, null, conflict);
      return this.persist();
    }

    async importSyncPackage(packageObject, password) {
      if (!packageObject || !packageObject.packageId) throw new Error('InvalidSyncPackage');
      if (this.data.sync.appliedPackageIds.includes(packageObject.packageId)) {
        return { status: 'skipped_duplicate', snapshot: this.snapshot() };
      }
      if (packageObject.vaultId && packageObject.vaultId !== this.data.vaultId) {
        throw new Error('VaultMismatch');
      }
      if (packageObject.sourceDeviceId && packageObject.sourceDeviceId === this.data.deviceId) {
        this.markPackageApplied(packageObject);
        await this.persist();
        return { status: 'skipped_own_device', snapshot: this.snapshot() };
      }
      const remote = await openEnvelope(packageObject.envelope, password);
      await this.mergeSnapshot(remote.data, packageObject.providerHint || 'manual');
      this.markPackageApplied(packageObject);
      await this.persist();
      return { status: 'applied', snapshot: this.snapshot() };
    }

    markPackageApplied(packageObject) {
      this.data.sync.appliedPackageIds.push(packageObject.packageId);
      this.data.sync.appliedPackageIds = Array.from(new Set(this.data.sync.appliedPackageIds)).slice(-500);
      this.data.sync.lastPackageId = packageObject.packageId;
      this.data.sync.lastPackageSourceDeviceId = packageObject.sourceDeviceId || null;
    }
  }

  function demoItems(data) {
    const timestamp = nowIso();
    return [
      {
        itemId: makeId('item'),
        templateId: 'tpl_password',
        title: 'Почта Яндекс',
        category: 'Личное',
        tags: ['почта', 'пример'],
        colorId: 'blue',
        values: {
          username: 'ivan@example.com',
          password: 'Primer-Parol-24!',
          url: 'https://mail.yandex.ru',
          notes: 'Демо-карточка: пароль скрыт и открывается глазком.',
        },
        createdAt: timestamp,
        modifiedAt: timestamp,
        revision: 1,
        deletedAt: null,
      },
      {
        itemId: makeId('item'),
        templateId: 'tpl_payment_card',
        title: 'Основная карта',
        category: 'Финансы',
        tags: ['банк', 'карта', 'пример'],
        colorId: 'teal',
        values: {
          holder: 'Иван Иванов',
          number: '4111 1111 1111 1111',
          expires: '2028-12-01',
          cvv: '123',
        },
        createdAt: timestamp,
        modifiedAt: timestamp,
        revision: 1,
        deletedAt: null,
      },
      {
        itemId: makeId('item'),
        templateId: 'tpl_bank',
        title: 'Счет в банке',
        category: 'Финансы',
        tags: ['банк', 'счет', 'пример'],
        colorId: 'red',
        values: {
          bank_name: 'Демо Банк',
          account_number: '40817810000000000001',
          routing: '044525225',
          login: 'ivan-demo',
          password: 'Bank-Demo-Secret-9',
        },
        createdAt: timestamp,
        modifiedAt: timestamp,
        revision: 1,
        deletedAt: null,
      },
      {
        itemId: makeId('item'),
        templateId: 'tpl_wifi',
        title: 'Домашний Wi-Fi',
        category: 'Дом',
        tags: ['wi-fi', 'пример'],
        colorId: 'green',
        values: {
          ssid: 'ActitHome',
          password: 'Wifi-Demo-2026',
          security: 'WPA2/WPA3',
          notes: 'Пароль Wi-Fi скрыт, остальные поля видны.',
        },
        createdAt: timestamp,
        modifiedAt: timestamp,
        revision: 1,
        deletedAt: null,
      },
    ].filter((item) => data.templates.some((template) => template.templateId === item.templateId));
  }

  async function createVault(name, password, options = {}) {
    const salt = new Uint8Array(16);
    global.crypto.getRandomValues(salt);
    const data = emptyVault(name);
    if (options.demoData) {
      data.items = demoItems(data);
      data.items.forEach((item) => {
        data.changeLog.push({
          changeId: makeId('chg'),
          vaultId: data.vaultId,
          deviceId: data.deviceId,
          type: 'item_create',
          objectId: item.itemId,
          modifiedAt: item.modifiedAt,
          before: null,
          after: item,
        });
      });
    }
    const key = await deriveKey(password, salt);
    const envelope = {
      format: 'ActitPassStorageVault',
      version: CURRENT_VERSION,
      vaultId: data.vaultId,
      name,
      kdf: DEFAULT_KDF,
      salt: bytesToBase64(salt),
      createdAt: data.createdAt,
      modifiedAt: data.modifiedAt,
      payload: await encryptJson(key, data, data.vaultId),
    };
    localStorage.setItem(storageKey(name), JSON.stringify(envelope));
    return new VaultSession(name, key, envelope, data);
  }

  async function openEnvelope(envelope, password) {
    const key = await deriveKey(password, base64ToBytes(envelope.salt), envelope.kdf);
    const data = normalizeVaultData(await decryptJson(key, envelope.payload, envelope.vaultId));
    return new VaultSession(envelope.name, key, envelope, data);
  }

  async function openVault(name, password) {
    const raw = localStorage.getItem(storageKey(name));
    if (!raw) throw new Error('VaultNotFound');
    return openEnvelope(JSON.parse(raw), password);
  }

  async function importEncryptedVault(envelope, password) {
    const session = await openEnvelope(envelope, password);
    localStorage.setItem(storageKey(session.name), JSON.stringify(envelope));
    return session;
  }

  function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function generatePassword(options = {}) {
    const length = clampInt(options.length, 8, 128, 24);
    const groups = [
      options.uppercase === false ? '' : 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      options.lowercase === false ? '' : 'abcdefghijkmnopqrstuvwxyz',
      options.numbers === false ? '' : '23456789',
      options.symbols === false ? '' : '!@#$%^&*_-+=?',
    ].filter(Boolean);
    const alphabet = groups.join('');
    if (!alphabet) throw new Error('PasswordAlphabetEmpty');
    const bytes = new Uint8Array(length);
    global.crypto.getRandomValues(bytes);
    const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
    groups.forEach((group, index) => {
      chars[index % chars.length] = group[bytes[index] % group.length];
    });
    return chars.join('');
  }

  function base32ToBytes(value) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = '';
    clean.split('').forEach((char) => {
      const index = alphabet.indexOf(char);
      if (index >= 0) bits += index.toString(2).padStart(5, '0');
    });
    const bytes = [];
    for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
      bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
    }
    return new Uint8Array(bytes);
  }

  async function generateTotp(secret, timestamp = Date.now(), period = 30, digits = 6) {
    const keyBytes = base32ToBytes(secret);
    if (!keyBytes.length) throw new Error('InvalidTotpSecret');
    const counter = Math.floor(timestamp / 1000 / period);
    const counterBytes = new ArrayBuffer(8);
    const counterView = new DataView(counterBytes);
    counterView.setUint32(4, counter);
    const key = await global.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const hash = new Uint8Array(await global.crypto.subtle.sign('HMAC', key, counterBytes));
    const offset = hash[hash.length - 1] & 0x0f;
    const binary = ((hash[offset] & 0x7f) << 24)
      | (hash[offset + 1] << 16)
      | (hash[offset + 2] << 8)
      | hash[offset + 3];
    const otp = binary % (10 ** digits);
    return String(otp).padStart(digits, '0');
  }

  global.ActitVaultCore = {
    CURRENT_VERSION,
    palette,
    templateIcons,
    fieldTypes,
    createVault,
    openVault,
    importEncryptedVault,
    openEnvelope,
    generatePassword,
    generateTotp,
    makeId,
    defaultTemplates,
    demoItems,
    storageKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
