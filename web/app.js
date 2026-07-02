(function initApp() {
  const core = window.ActitVaultCore;
  let session = null;
  let mode = 'open';
  let activeView = 'cards';
  let revealed = new Set();
  let autoLockTimer = null;
  let generatedPassword = '';
  let passwordPromptResolver = null;

  const $ = (id) => document.getElementById(id);

  function setMessage(id, text, tone = '') {
    const element = $(id);
    element.textContent = text || '';
    element.dataset.tone = tone;
  }

  function activeTemplate() {
    return session.data.templates.find((template) => template.templateId === $('item-template').value);
  }

  function setMode(nextMode) {
    mode = nextMode;
    $('tab-open').classList.toggle('active', mode === 'open');
    $('tab-create').classList.toggle('active', mode === 'create');
    $('unlock-submit').textContent = mode === 'open' ? 'Открыть базу' : 'Создать базу';
    $('master-password').autocomplete = mode === 'open' ? 'current-password' : 'new-password';
    $('confirm-password-row').classList.toggle('hidden', mode !== 'create');
    $('demo-data-row').classList.toggle('hidden', mode !== 'create');
    $('master-password-confirm').required = mode === 'create';
    setMessage('locked-message', '');
  }

  function showWorkspace() {
    $('locked-view').classList.add('hidden');
    $('workspace-view').classList.remove('hidden');
    $('vault-label').textContent = session.name;
    resetAutoLock();
    renderAll();
  }

  function lock() {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = null;
    session = null;
    revealed = new Set();
    $('workspace-view').classList.add('hidden');
    $('locked-view').classList.remove('hidden');
    $('master-password').value = '';
  }

  function switchView(view) {
    activeView = view;
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === view);
    });
    document.querySelectorAll('.view-section').forEach((section) => {
      section.classList.toggle('hidden', section.id !== `${view}-view`);
    });
    const titles = {
      cards: ['Карточки', 'Секреты скрыты по умолчанию. Все изменения пишутся в локальный журнал.', 'Новая карточка'],
      templates: ['Шаблоны', 'Настраиваемые типы карточек и встроенные структуры.', 'Новый шаблон'],
      sync: ['Синхронизация', 'Настройки провайдеров и зашифрованные пакеты обмена.', 'Sync-пакет'],
      conflicts: ['Конфликты', 'Журнал расхождений, решенных по правилу “позднее изменение побеждает”.', 'Обновить'],
      settings: ['Настройки', 'Автоблокировка, буфер обмена и генерация надежных паролей.', 'Сгенерировать'],
    };
    $('view-title').textContent = titles[view][0];
    $('view-subtitle').textContent = titles[view][1];
    $('primary-create').textContent = titles[view][2];
    $('primary-create').style.visibility = view === 'conflicts' ? 'hidden' : 'visible';
    renderAll();
  }

  function renderAll() {
    if (!session) return;
    renderSelectors();
    renderCards();
    renderTemplates();
    renderSync();
    renderConflicts();
    renderSettings();
  }

  function renderSelectors() {
    const templateOptions = session.data.templates
      .map((template) => `<option value="${template.templateId}">${templateIcon(template)} ${escapeHtml(template.name)}</option>`)
      .join('');
    $('item-template').innerHTML = templateOptions;
    $('template-filter').innerHTML = `<option value="">Все шаблоны</option>${templateOptions}`;
    renderColorControl('item-color', 'item-color-swatches');
    renderColorControl('template-color', 'template-color-swatches');
    renderIconControl($('template-icon')?.value || 'key');
  }

  function renderCards() {
    const query = $('search-input').value.trim().toLowerCase();
    const templateFilter = $('template-filter').value;
    const sortMode = $('sort-mode').value;
    const templates = new Map(session.data.templates.map((template) => [template.templateId, template]));
    let items = session.items();
    if (templateFilter) items = items.filter((item) => item.templateId === templateFilter);
    if (query) {
      items = items.filter((item) => {
        const template = templates.get(item.templateId);
        const text = [item.title, item.category, item.tags.join(' '), template ? template.name : ''].join(' ').toLowerCase();
        return text.includes(query);
      });
    }
    items.sort((a, b) => {
      if (sortMode === 'title_asc') return a.title.localeCompare(b.title);
      if (sortMode === 'template_asc') return (templates.get(a.templateId)?.name || '').localeCompare(templates.get(b.templateId)?.name || '');
      return b.modifiedAt.localeCompare(a.modifiedAt);
    });
    $('card-list').innerHTML = items.length
      ? items.map((item) => cardHtml(item, templates.get(item.templateId))).join('')
      : '<div class="empty-state">Карточек пока нет. Создайте первую запись.</div>';
    document.querySelectorAll('[data-edit-item]').forEach((button) => {
      button.addEventListener('click', () => openItemDialog(button.dataset.editItem));
    });
    document.querySelectorAll('[data-reveal]').forEach((button) => {
      button.addEventListener('click', () => {
        if (revealed.has(button.dataset.reveal)) revealed.delete(button.dataset.reveal);
        else revealed.add(button.dataset.reveal);
        renderCards();
      });
    });
    document.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(button.dataset.copyValue || '');
        scheduleClipboardClear(button.dataset.copyValue || '');
        button.textContent = 'Скопировано';
        setTimeout(() => {
          button.textContent = 'Копировать';
        }, 1200);
      });
    });
    document.querySelectorAll('[data-totp]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          button.textContent = await core.generateTotp(button.dataset.totpSecret || '');
        } catch (error) {
          button.textContent = 'Ошибка';
        }
      });
    });
  }

  function cardHtml(item, template) {
    const color = core.palette.find((entry) => entry.id === item.colorId) || core.palette[0];
    const visibleRows = (template?.fields || [])
      .filter((field) => !field.secret && item.values[field.fieldId])
      .map((field) => `
        <div class="value-row">
          <span>${escapeHtml(field.label)}</span>
          <strong>${escapeHtml(item.values[field.fieldId])}</strong>
        </div>
      `)
      .join('');
    const secretRows = (template?.fields || [])
      .filter((field) => field.secret && item.values[field.fieldId])
      .map((field) => {
        const revealKey = `${item.itemId}:${field.fieldId}`;
        const isVisible = revealed.has(revealKey);
        const isTotp = field.type === 'totp';
        return `
          <div class="secret-row">
            <span>${escapeHtml(field.label)}</span>
            <code>${isVisible && !isTotp ? escapeHtml(item.values[field.fieldId]) : '••••••••'}</code>
            <button class="eye-button" data-reveal="${revealKey}" type="button" title="${isVisible ? 'Скрыть' : 'Показать'}" aria-label="${isVisible ? 'Скрыть' : 'Показать'}">${isVisible ? '🙈' : '👁'}</button>
            <button class="mini-button" data-copy data-copy-value="${escapeAttr(item.values[field.fieldId])}" type="button">Копировать</button>
            ${isTotp ? `<button class="mini-button" data-totp data-totp-secret="${escapeAttr(item.values[field.fieldId])}" type="button">TOTP</button>` : ''}
          </div>
        `;
      })
      .join('');
    return `
      <article class="secret-card" style="--card-bg:${color.bg};--card-fg:${color.fg}">
        <button class="card-edit" data-edit-item="${item.itemId}" type="button">Редактировать</button>
        <div class="card-accent"></div>
        <h3><span class="template-symbol">${templateIcon(template)}</span>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(template?.name || 'Неизвестный шаблон')} · ${escapeHtml(item.category || 'Без категории')}</p>
        <div class="tag-row">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        ${visibleRows}
        ${secretRows || '<div class="muted-line">Нет заполненных секретных полей</div>'}
        <time>${new Date(item.modifiedAt).toLocaleString()}</time>
      </article>
    `;
  }

  function renderTemplates() {
    $('template-list').innerHTML = session.data.templates
      .map((template) => {
        const color = core.palette.find((entry) => entry.id === template.colorId) || core.palette[0];
        return `
          <article class="template-card" style="--card-bg:${color.bg};--card-fg:${color.fg}">
            <div>
              <h3><span class="template-symbol">${templateIcon(template)}</span>${escapeHtml(template.name)}</h3>
              <p>${template.fields.length} полей · ${template.builtIn ? 'встроенный' : 'пользовательский'}</p>
            </div>
            <button class="ghost-action" data-edit-template="${template.templateId}" type="button">${template.builtIn ? 'Дублировать' : 'Редактировать'}</button>
          </article>
        `;
      })
      .join('');
    document.querySelectorAll('[data-edit-template]').forEach((button) => {
      button.addEventListener('click', () => openTemplateDialog(button.dataset.editTemplate));
    });
  }

  function renderSync() {
    $('sync-provider').value = session.data.sync.provider;
    $('sync-config').value = session.data.sync.config || '';
    renderSyncForm(session.data.sync.provider, parseSyncConfig(session.data.sync.provider, session.data.sync.config || ''));
    const appliedCount = session.data.sync.appliedPackageIds?.length || 0;
    const packageSuffix = session.data.sync.lastPackageId
      ? ` · последний пакет ${session.data.sync.lastPackageId}`
      : '';
    $('sync-status').textContent = session.data.sync.lastSyncAt
      ? `Последняя синхронизация: ${new Date(session.data.sync.lastSyncAt).toLocaleString()}`
      : 'Синхронизация еще не выполнялась.';
    $('sync-status').textContent += ` · примененных пакетов: ${appliedCount}${packageSuffix}`;
  }

  function renderConflicts() {
    const conflicts = session.data.conflicts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $('conflict-list').innerHTML = conflicts.length
      ? conflicts.map((conflict) => `
        <article class="conflict-card ${conflict.reviewed ? 'reviewed' : ''}">
          <div>
            <h3>${escapeHtml(conflict.title || conflict.objectId)}</h3>
            <p>${escapeHtml(conflict.provider)} · победитель ${escapeHtml(conflict.winningDeviceId)}</p>
            <p>Победило "${escapeHtml(conflict.winningTitle || '')}" ревизия ${escapeHtml(conflict.winningRevision || '')}; проиграло "${escapeHtml(conflict.losingTitle || '')}" ревизия ${escapeHtml(conflict.losingRevision || '')}.</p>
            <p>Победило изменение от ${new Date(conflict.winningModifiedAt).toLocaleString()}, проиграло ${new Date(conflict.losingModifiedAt).toLocaleString()}.</p>
          </div>
          ${conflict.reviewed ? '<span class="reviewed-badge">Просмотрено</span>' : `<button class="ghost-action" data-review-conflict="${conflict.conflictId}" type="button">Отметить</button>`}
        </article>
      `).join('')
      : '<div class="empty-state">Конфликтов нет.</div>';
    document.querySelectorAll('[data-review-conflict]').forEach((button) => {
      button.addEventListener('click', async () => {
        await session.reviewConflict(button.dataset.reviewConflict);
        renderConflicts();
      });
    });
  }

  function renderSettings() {
    if (!session) return;
    $('auto-lock-minutes').value = session.data.settings?.autoLockMinutes || 5;
    $('clipboard-clear-seconds').value = session.data.settings?.clipboardClearSeconds || 30;
    renderSettingsGalleries();
  }

  function renderSettingsGalleries() {
    const palette = $('settings-palette');
    if (palette) {
      palette.innerHTML = core.palette.map((color) => `
        <div class="gallery-chip">
          <span class="color-dot" style="--dot-bg:${color.bg};--dot-fg:${color.fg}"></span>
          <span>${escapeHtml(color.label)}</span>
        </div>
      `).join('');
    }
    const icons = $('settings-icons');
    if (icons) {
      icons.innerHTML = core.templateIcons.map((icon) => `
        <div class="gallery-chip icon-gallery-chip">
          <span class="gallery-symbol">${icon.symbol}</span>
          <span>${escapeHtml(icon.label)}</span>
        </div>
      `).join('');
    }
  }

  function openItemDialog(itemId = '') {
    const item = itemId ? session.data.items.find((entry) => entry.itemId === itemId) : null;
    $('editing-item-id').value = item?.itemId || '';
    $('item-dialog-title').textContent = item ? 'Редактировать карточку' : 'Новая карточка';
    $('delete-item').classList.toggle('hidden', !item);
    $('item-template').disabled = Boolean(item);
    $('item-template').value = item?.templateId || session.data.templates[0].templateId;
    $('item-title').value = item?.title || '';
    $('item-category').value = item?.category || '';
    $('item-tags').value = item?.tags.join(', ') || '';
    $('item-color').value = item?.colorId || activeTemplate().colorId;
    renderColorControl('item-color', 'item-color-swatches', $('item-color').value);
    renderItemFields(item);
    $('item-dialog').showModal();
  }

  function renderItemFields(item = null) {
    const template = activeTemplate();
    $('item-fields').innerHTML = template.fields.map((field) => {
      const value = item?.values[field.fieldId] || '';
      const type = field.secret || field.type === 'password' || field.type === 'totp' ? 'password' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
      const control = field.type === 'multiline_note'
        ? `<textarea data-field="${field.fieldId}" rows="4" ${field.required ? 'required' : ''}>${escapeHtml(value)}</textarea>`
        : `<input data-field="${field.fieldId}" type="${type}" value="${escapeAttr(value)}" ${field.required ? 'required' : ''}>`;
      const canReveal = field.secret || field.type === 'password' || field.type === 'totp';
      const reveal = canReveal
        ? `<button class="eye-button" data-toggle-field="${field.fieldId}" type="button" title="Показать" aria-label="Показать">👁</button>`
        : '';
      const generator = field.type === 'password' || field.secret
        ? `<button class="ghost-action" data-generate-field="${field.fieldId}" type="button">Сгенерировать</button>`
        : '';
      return `<label><span>${escapeHtml(field.label)}${field.secret ? ' · секретное' : ''}</span><div class="field-input-row">${control}${reveal}${generator}</div></label>`;
    }).join('');
    document.querySelectorAll('[data-toggle-field]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.querySelector(`[data-field="${button.dataset.toggleField}"]`);
        togglePasswordInput(input, button);
      });
    });
    document.querySelectorAll('[data-generate-field]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.querySelector(`[data-field="${button.dataset.generateField}"]`);
        input.value = generateFromSettings();
      });
    });
  }

  function openTemplateDialog(templateId = '') {
    const source = templateId ? session.data.templates.find((entry) => entry.templateId === templateId) : null;
    const clone = source?.builtIn ? { ...source, templateId: '', name: `${source.name} copy`, builtIn: false } : source;
    $('editing-template-id').value = clone?.templateId || '';
    $('template-dialog-title').textContent = clone ? 'Редактировать шаблон' : 'Новый шаблон';
    $('template-name').value = clone?.name || '';
    $('template-icon').value = clone?.iconId || 'key';
    $('template-color').value = clone?.colorId || 'neutral';
    renderIconControl($('template-icon').value);
    renderColorControl('template-color', 'template-color-swatches', $('template-color').value);
    renderTemplateFields(clone?.fields || []);
    $('template-dialog').showModal();
  }

  function renderTemplateFields(fields) {
    $('template-fields').innerHTML = fields.map((field, index) => templateFieldRow(field, index)).join('');
    document.querySelectorAll('[data-remove-template-field]').forEach((button) => {
      button.addEventListener('click', () => {
        const rows = readTemplateFields();
        rows.splice(Number(button.dataset.removeTemplateField), 1);
        renderTemplateFields(rows);
      });
    });
  }

  function templateFieldRow(field, index) {
    return `
      <div class="template-field-row">
        <input data-tpl-label="${index}" value="${escapeAttr(field.label || '')}" placeholder="Название поля">
        <select data-tpl-type="${index}">
          ${core.fieldTypes.map((type) => `<option value="${type}" ${field.type === type ? 'selected' : ''}>${fieldTypeLabel(type)}</option>`).join('')}
        </select>
        <label class="check"><input data-tpl-required="${index}" type="checkbox" ${field.required ? 'checked' : ''}> обязательное</label>
        <label class="check"><input data-tpl-secret="${index}" type="checkbox" ${field.secret ? 'checked' : ''}> секретное</label>
        <button class="icon-button" data-remove-template-field="${index}" type="button">×</button>
      </div>
    `;
  }

  function readTemplateFields() {
    return Array.from(document.querySelectorAll('.template-field-row')).map((row, index) => {
      const label = row.querySelector(`[data-tpl-label="${index}"]`)?.value || `Field ${index + 1}`;
      const type = row.querySelector(`[data-tpl-type="${index}"]`)?.value || 'text';
      return {
        fieldId: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${index + 1}`,
        label,
        type,
        required: row.querySelector(`[data-tpl-required="${index}"]`)?.checked || false,
        secret: row.querySelector(`[data-tpl-secret="${index}"]`)?.checked || ['password', 'totp', 'custom_secret'].includes(type),
        searchable: false,
        copyable: true,
      };
    });
  }

  function downloadJson(fileName, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async function apiPost(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'API request failed');
    return payload;
  }

  function syncAdapter(provider, config) {
    if (provider === 'mounted_folder') {
      return {
        label: 'Папка',
        listUrl: '/api/mounted-folder/list',
        readUrl: '/api/mounted-folder/read',
        writeUrl: '/api/mounted-folder/write',
        body(extra = {}) {
          return { directory: config, ...extra };
        },
      };
    }
    if (provider === 'webdav') {
      return {
        label: 'WebDAV',
        listUrl: '/api/webdav/list',
        readUrl: '/api/webdav/read',
        writeUrl: '/api/webdav/write',
        body(extra = {}) {
          return { config, ...extra };
        },
      };
    }
    if (provider === 'ftp') {
      return {
        label: 'FTP',
        listUrl: '/api/ftp/list',
        readUrl: '/api/ftp/read',
        writeUrl: '/api/ftp/write',
        body(extra = {}) {
          return { config, ...extra };
        },
      };
    }
    if (provider === 'email') {
      return {
        label: 'Почта',
        listUrl: '/api/email/list',
        readUrl: '/api/email/read',
        writeUrl: '/api/email/write',
        body(extra = {}) {
          return { config, ...extra };
        },
      };
    }
    throw new Error(`Unsupported provider: ${provider}`);
  }

  function syncConfigHint(provider) {
    if (provider === 'email') return 'Заполните параметры IMAP/SMTP почтового ящика.';
    if (provider === 'webdav') return 'Укажите WebDAV URL или JSON-конфиг.';
    if (provider === 'ftp') return 'Укажите ftp:// URL или JSON-конфиг FTP.';
    return 'Укажите путь к локальной или смонтированной папке.';
  }

  function parseSyncConfig(provider, rawConfig) {
    const raw = String(rawConfig || '').trim();
    if (!raw) return {};
    if (raw.startsWith('{')) {
      try {
        return JSON.parse(raw);
      } catch (error) {
        return {};
      }
    }
    if (provider === 'mounted_folder') return { directory: raw };
    if (provider === 'webdav') return { url: raw };
    if (provider === 'ftp') {
      try {
        const url = new URL(raw);
        return {
          host: url.hostname,
          port: url.port || '21',
          username: decodeURIComponent(url.username || ''),
          password: decodeURIComponent(url.password || ''),
          path: decodeURIComponent(url.pathname || '/'),
          security: 'ftp',
        };
      } catch (error) {
        return {};
      }
    }
    return {};
  }

  function renderSyncForm(provider, config = {}) {
    const form = $('sync-form');
    if (!form) return;
    const fields = syncFields(provider, config);
    form.innerHTML = fields.map((field) => {
      if (field.type === 'select') {
        return `
          <label>
            <span>${escapeHtml(field.label)}</span>
            <select data-sync-field="${field.id}">
              ${field.options.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === field.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
            </select>
            <small>${escapeHtml(field.help)}</small>
          </label>
        `;
      }
      return `
        <label>
          <span>${escapeHtml(field.label)}</span>
          ${field.type === 'password'
            ? `<div class="field-input-row"><input data-sync-field="${field.id}" type="password" value="${escapeAttr(field.value || '')}" placeholder="${escapeAttr(field.placeholder || '')}"><button class="eye-button" data-toggle-sync-field="${field.id}" type="button" title="Показать" aria-label="Показать">👁</button></div>`
            : `<input data-sync-field="${field.id}" type="${field.type}" value="${escapeAttr(field.value || '')}" placeholder="${escapeAttr(field.placeholder || '')}">`}
          <small>${escapeHtml(field.help)}</small>
        </label>
      `;
    }).join('');
    bindPasswordToggles(form);
  }

  function syncFields(provider, config) {
    if (provider === 'mounted_folder') {
      return [
        { id: 'directory', label: 'Путь к папке', type: 'text', value: config.directory || '', placeholder: '/home/user/ActitPassSync', help: 'Можно указать локальную папку, USB-диск или уже смонтированный SMB/NFS каталог.' },
      ];
    }
    if (provider === 'email') {
      return [
        { id: 'email', label: 'Почтовый ящик', type: 'email', value: config.email || '', placeholder: 'user@example.com', help: 'Ящик, через который устройства будут обмениваться зашифрованными письмами.' },
        { id: 'imapHost', label: 'IMAP сервер', type: 'text', value: config.imapHost || '', placeholder: 'imap.example.com', help: 'Адрес сервера входящей почты.' },
        { id: 'imapPort', label: 'IMAP порт', type: 'number', value: config.imapPort || '993', help: 'Обычно 993 для IMAPS.' },
        { id: 'smtpHost', label: 'SMTP сервер', type: 'text', value: config.smtpHost || '', placeholder: 'smtp.example.com', help: 'Адрес сервера исходящей почты.' },
        { id: 'smtpPort', label: 'SMTP порт', type: 'number', value: config.smtpPort || '465', help: 'Обычно 465 или 587.' },
        { id: 'login', label: 'Логин', type: 'text', value: config.login || '', help: 'Чаще всего совпадает с email.' },
        { id: 'password', label: 'Пароль приложения', type: 'password', value: config.password || '', help: 'Лучше использовать отдельный пароль приложения, а не основной пароль почты.' },
        { id: 'folder', label: 'Папка/метка', type: 'text', value: config.folder || 'ActitPassStorage', help: 'Куда складывать письма синхронизации.' },
      ];
    }
    if (provider === 'webdav') {
      return [
        { id: 'url', label: 'WebDAV URL папки', type: 'url', value: config.url || '', placeholder: 'https://example.com/remote.php/dav/files/user/ActitPass/', help: 'Папка, где будут лежать зашифрованные пакеты синхронизации.' },
        { id: 'username', label: 'Пользователь', type: 'text', value: config.username || '', help: 'Оставьте пустым, если сервер не требует авторизацию.' },
        { id: 'password', label: 'Пароль или токен', type: 'password', value: config.password || '', help: 'Для Nextcloud лучше создать пароль приложения.' },
      ];
    }
    if (provider === 'sftp') {
      return [
        { id: 'host', label: 'SFTP хост', type: 'text', value: config.host || '', placeholder: 'storage.example.com', help: 'Сервер с SSH/SFTP доступом.' },
        { id: 'port', label: 'Порт', type: 'number', value: config.port || '22', help: 'Обычно 22.' },
        { id: 'username', label: 'Пользователь', type: 'text', value: config.username || '', help: 'Имя пользователя на сервере.' },
        { id: 'password', label: 'Пароль или фраза ключа', type: 'password', value: config.password || '', help: 'В запускаемой версии форма готова; автоматический SFTP будет подключен в промышленном ядре.' },
        { id: 'path', label: 'Удаленная папка', type: 'text', value: config.path || '/ActitPass', help: 'Папка для пакетов синхронизации.' },
      ];
    }
    return [
      { id: 'host', label: 'FTP/FTPS хост', type: 'text', value: config.host || '', placeholder: 'ftp.example.com', help: 'Адрес FTP сервера.' },
      { id: 'port', label: 'Порт', type: 'number', value: config.port || '21', help: 'Обычно 21 для FTP.' },
      { id: 'username', label: 'Пользователь', type: 'text', value: config.username || '', help: 'Логин FTP.' },
      { id: 'password', label: 'Пароль', type: 'password', value: config.password || '', help: 'Пароль FTP. Обычный FTP не защищает учетные данные в сети.' },
      { id: 'path', label: 'Удаленная папка', type: 'text', value: config.path || '/ActitPass', help: 'Папка для пакетов синхронизации.' },
      { id: 'security', label: 'Режим', type: 'select', value: config.security || 'ftp', help: 'В запускаемой версии автоматизирован обычный FTP; FTPS отмечен для промышленного ядра.', options: [
        { value: 'ftp', label: 'FTP' },
        { value: 'ftps_explicit', label: 'FTPS явный' },
        { value: 'ftps_implicit', label: 'FTPS неявный' },
      ] },
    ];
  }

  function collectSyncConfig() {
    const provider = $('sync-provider').value;
    const values = collectSyncValues();
    if (provider === 'mounted_folder') return values.directory || '';
    if (provider === 'ftp' && values.host && !values.security.startsWith('ftps')) {
      const user = encodeURIComponent(values.username || 'anonymous');
      const pass = encodeURIComponent(values.password || 'anonymous@');
      const pathPart = values.path && values.path.startsWith('/') ? values.path : `/${values.path || ''}`;
      return `ftp://${user}:${pass}@${values.host}:${values.port || 21}${pathPart}`;
    }
    return JSON.stringify(values);
  }

  function collectSyncValues() {
    const values = {};
    document.querySelectorAll('[data-sync-field]').forEach((input) => {
      values[input.dataset.syncField] = input.value.trim();
    });
    return values;
  }

  function validateSyncValues(provider, values) {
    const required = {
      mounted_folder: [['directory', 'путь к папке']],
      email: [['email', 'почтовый ящик'], ['imapHost', 'IMAP сервер'], ['imapPort', 'IMAP порт'], ['smtpHost', 'SMTP сервер'], ['smtpPort', 'SMTP порт'], ['login', 'логин'], ['password', 'пароль приложения'], ['folder', 'папку/метку']],
      webdav: [['url', 'WebDAV URL']],
      sftp: [['host', 'SFTP хост'], ['port', 'порт'], ['username', 'пользователя'], ['path', 'удаленную папку']],
      ftp: [['host', 'FTP хост'], ['port', 'порт'], ['path', 'удаленную папку']],
    }[provider] || [];
    const missing = required.filter(([key]) => !values[key]).map(([, label]) => label);
    if (missing.length) return { ok: false, message: `Заполните: ${missing.join(', ')}.` };
    if (provider === 'webdav' && !/^https?:\/\//i.test(values.url || '')) {
      return { ok: false, message: 'WebDAV URL должен начинаться с http:// или https://.' };
    }
    if (provider === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email || '')) {
      return { ok: false, message: 'Укажите корректный email.' };
    }
    return { ok: true, message: 'Форма заполнена.' };
  }

  function syncHelp(provider) {
    const docs = {
      mounted_folder: ['Папка / SMB / NFS', [
        'Создайте отдельную папку для синхронизации ActitPassStorage.',
        'Для SMB или NFS сначала подключите сетевой ресурс средствами операционной системы.',
        'В поле “Путь к папке” укажите локальный путь к этой папке.',
        'Приложение будет читать и записывать только зашифрованные файлы *.actitpass-sync.json.',
      ]],
      email: ['Почта IMAP/SMTP', [
        'Создайте отдельный почтовый ящик или отдельную папку/метку для писем синхронизации.',
        'Укажите IMAP для чтения и SMTP для отправки.',
        'Используйте пароль приложения, если почтовый сервис это поддерживает.',
        'Запускаемая версия умеет автоматический IMAP/SMTP обмен через обычное TCP-подключение или implicit TLS на портах 993/465.',
      ]],
      webdav: ['WebDAV', [
        'Создайте папку в Nextcloud, ownCloud, NAS или другом WebDAV-хранилище.',
        'Скопируйте полный WebDAV URL этой папки.',
        'Укажите пользователя и пароль приложения, если сервер требует вход.',
        'Приложение будет выполнять PROPFIND, GET и PUT только для зашифрованных пакетов синхронизации.',
      ]],
      sftp: ['SFTP', [
        'Подготовьте SSH/SFTP доступ к серверу.',
        'Создайте удаленную папку для пакетов синхронизации.',
        'Укажите хост, порт, пользователя и путь.',
        'В текущей запускаемой версии форма готовит конфигурацию; SFTP-адаптер будет подключен в промышленном ядре.',
      ]],
      ftp: ['FTP/FTPS', [
        'Создайте отдельную FTP-папку для пакетов синхронизации.',
        'Укажите хост, порт, логин, пароль и удаленный путь.',
        'Обычный FTP передает учетные данные и метаданные без защиты. Сами данные базы остаются зашифрованными.',
        'Для чувствительных сетей лучше WebDAV через HTTPS, SFTP или смонтированная защищенная папка.',
      ]],
    };
    return docs[provider] || docs.mounted_folder;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function togglePasswordInput(input, button) {
    if (!input) return;
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? '👁' : '🙈';
    button.title = visible ? 'Показать' : 'Скрыть';
    button.setAttribute('aria-label', button.title);
  }

  function bindPasswordToggles(root = document) {
    root.querySelectorAll('[data-toggle-input]').forEach((button) => {
      button.onclick = () => togglePasswordInput($(button.dataset.toggleInput), button);
    });
    root.querySelectorAll('[data-toggle-sync-field]').forEach((button) => {
      button.onclick = () => {
        const input = root.querySelector(`[data-sync-field="${button.dataset.toggleSyncField}"]`);
        togglePasswordInput(input, button);
      };
    });
  }

  function requestPassword(title) {
    $('password-prompt-title').textContent = title;
    $('password-prompt-input').value = '';
    $('password-prompt-input').type = 'password';
    const eye = document.querySelector('[data-toggle-input="password-prompt-input"]');
    if (eye) {
      eye.textContent = '👁';
      eye.title = 'Показать';
      eye.setAttribute('aria-label', 'Показать');
    }
    $('password-prompt-dialog').showModal();
    $('password-prompt-input').focus();
    return new Promise((resolve) => {
      passwordPromptResolver = resolve;
    });
  }

  function templateIcon(template) {
    const icon = core.templateIcons.find((entry) => entry.id === template?.iconId);
    return icon ? icon.symbol : '🔑';
  }

  function fieldTypeLabel(type) {
    return {
      text: 'Текст',
      password: 'Пароль',
      multiline_note: 'Многострочная заметка',
      url: 'Ссылка',
      email: 'Email',
      phone: 'Телефон',
      username: 'Логин',
      number: 'Число',
      date: 'Дата',
      totp: 'Одноразовый код TOTP',
      custom_secret: 'Секретное поле',
    }[type] || type;
  }

  function renderColorControl(inputId, targetId, selectedValue = null) {
    const input = $(inputId);
    const target = $(targetId);
    if (!input || !target) return;
    const selected = selectedValue || input.value || 'neutral';
    input.value = selected;
    target.innerHTML = core.palette.map((color) => `
      <button class="swatch-button ${color.id === selected ? 'active' : ''}" type="button" data-color="${color.id}" title="${escapeAttr(color.label)}">
        <span class="color-dot" style="--dot-bg:${color.bg};--dot-fg:${color.fg}"></span>
        <span>${escapeHtml(color.label)}</span>
      </button>
    `).join('');
    target.querySelectorAll('[data-color]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.color;
        renderColorControl(inputId, targetId, input.value);
      });
    });
  }

  function renderIconControl(selectedValue = 'key') {
    const input = $('template-icon');
    const target = $('template-icon-picker');
    if (!input || !target) return;
    input.value = selectedValue || 'key';
    target.innerHTML = core.templateIcons.map((icon) => `
      <button class="icon-choice ${icon.id === input.value ? 'active' : ''}" type="button" data-icon="${icon.id}" title="${escapeAttr(icon.label)}">
        <span>${icon.symbol}</span>
        <small>${escapeHtml(icon.label)}</small>
      </button>
    `).join('');
    target.querySelectorAll('[data-icon]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.icon;
        renderIconControl(input.value);
      });
    });
  }

  function generateFromSettings() {
    return core.generatePassword({
      length: $('generator-length') ? $('generator-length').value : 24,
      uppercase: $('generator-uppercase') ? $('generator-uppercase').checked : true,
      lowercase: $('generator-lowercase') ? $('generator-lowercase').checked : true,
      numbers: $('generator-numbers') ? $('generator-numbers').checked : true,
      symbols: $('generator-symbols') ? $('generator-symbols').checked : true,
    });
  }

  function scheduleClipboardClear(expectedValue) {
    const seconds = session?.data.settings?.clipboardClearSeconds || 30;
    setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === expectedValue) await navigator.clipboard.writeText('');
      } catch (error) {
        // Some browsers disallow clipboard reads without a direct user gesture.
      }
    }, seconds * 1000);
  }

  function resetAutoLock() {
    if (!session) return;
    if (autoLockTimer) clearTimeout(autoLockTimer);
    const minutes = session.data.settings?.autoLockMinutes || 5;
    autoLockTimer = setTimeout(() => {
      if (session) lock();
    }, minutes * 60 * 1000);
  }

  $('tab-open').addEventListener('click', () => setMode('open'));
  $('tab-create').addEventListener('click', () => setMode('create'));
  bindPasswordToggles(document);

  $('password-prompt-confirm').addEventListener('click', () => {
    const value = $('password-prompt-input').value;
    const resolver = passwordPromptResolver;
    passwordPromptResolver = null;
    $('password-prompt-dialog').close();
    if (resolver) resolver(value);
  });

  $('password-prompt-dialog').addEventListener('close', () => {
    if (passwordPromptResolver) passwordPromptResolver('');
    passwordPromptResolver = null;
  });

  $('password-prompt-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('password-prompt-confirm').click();
    }
  });

  $('unlock-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('vault-name').value.trim() || 'personal';
    const password = $('master-password').value;
    if (mode === 'create' && password !== $('master-password-confirm').value) {
      setMessage('locked-message', 'Пароли не совпадают.', 'error');
      return;
    }
    try {
      session = mode === 'open'
        ? await core.openVault(name, password)
        : await core.createVault(name, password, { demoData: $('create-demo-data').checked });
      showWorkspace();
    } catch (error) {
      setMessage('locked-message', mode === 'open' ? 'Не удалось открыть базу. Проверьте имя и пароль.' : 'Не удалось создать базу.', 'error');
    }
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  $('lock-vault').addEventListener('click', lock);
  $('search-input').addEventListener('input', renderCards);
  $('template-filter').addEventListener('change', renderCards);
  $('sort-mode').addEventListener('change', renderCards);
  $('item-template').addEventListener('change', () => renderItemFields(null));
  $('sync-provider').addEventListener('change', () => {
    const provider = $('sync-provider').value;
    $('sync-config').value = '';
    renderSyncForm(provider, {});
  });
  $('primary-create').addEventListener('click', () => {
    if (activeView === 'cards') openItemDialog();
    if (activeView === 'templates') openTemplateDialog();
    if (activeView === 'sync') $('download-sync-package').click();
    if (activeView === 'settings') $('generate-password').click();
  });

  $('save-item').addEventListener('click', async () => {
    try {
      const values = {};
      document.querySelectorAll('[data-field]').forEach((field) => {
        values[field.dataset.field] = field.value;
      });
      await session.saveItem({
        itemId: $('editing-item-id').value || undefined,
        templateId: $('item-template').value,
        title: $('item-title').value,
        category: $('item-category').value,
        tags: $('item-tags').value,
        colorId: $('item-color').value,
        values,
      });
      $('item-dialog').close();
      renderAll();
    } catch (error) {
      alert(error.message.startsWith('Required:') ? `Заполните поле ${error.message.slice(9)}` : 'Не удалось сохранить карточку');
    }
  });

  $('delete-item').addEventListener('click', async () => {
    if (!confirm('Удалить карточку?')) return;
    await session.deleteItem($('editing-item-id').value);
    $('item-dialog').close();
    renderAll();
  });

  $('add-template-field').addEventListener('click', () => {
    const fields = readTemplateFields();
    fields.push({ label: `Поле ${fields.length + 1}`, type: 'text', required: false, secret: false });
    renderTemplateFields(fields);
  });

  $('save-template').addEventListener('click', async () => {
    const fields = readTemplateFields();
    if (!$('template-name').value.trim() || fields.length === 0) {
      alert('Укажите название и хотя бы одно поле.');
      return;
    }
    await session.saveTemplate({
      templateId: $('editing-template-id').value || undefined,
      name: $('template-name').value,
      iconId: $('template-icon').value,
      colorId: $('template-color').value,
      fields,
    });
    $('template-dialog').close();
    renderAll();
  });

  $('save-sync').addEventListener('click', async () => {
    const validation = validateSyncValues($('sync-provider').value, collectSyncValues());
    if (!validation.ok) {
      setMessage('sync-status', validation.message, 'error');
      return;
    }
    const config = collectSyncConfig();
    $('sync-config').value = config;
    await session.configureSync($('sync-provider').value, config);
    setMessage('sync-status', 'Настройки синхронизации сохранены.');
    renderAll();
  });

  $('test-sync-settings').addEventListener('click', async () => {
    const provider = $('sync-provider').value;
    const values = collectSyncValues();
    const validation = validateSyncValues(provider, values);
    if (!validation.ok) {
      setMessage('sync-status', validation.message, 'error');
      return;
    }
    const config = collectSyncConfig();
    $('sync-config').value = config;
    if (!['mounted_folder', 'webdav', 'ftp', 'email'].includes(provider)) {
      const providerName = 'SFTP';
      setMessage('sync-status', `${providerName}: форма заполнена. Автоматическая проверка соединения будет доступна в промышленном ядре.`);
      return;
    }
    const ftpSecurity = document.querySelector('[data-sync-field="security"]')?.value;
    if (provider === 'ftp' && ftpSecurity && ftpSecurity !== 'ftp') {
      setMessage('sync-status', 'FTPS выбран в форме, но автоматическая проверка FTPS будет доступна в промышленном ядре.', 'error');
      return;
    }
    try {
      const adapter = syncAdapter(provider, config);
      const listed = await apiPost(adapter.listUrl, adapter.body());
      setMessage('sync-status', `${adapter.label}: соединение проверено, найдено пакетов синхронизации: ${listed.files.length}.`);
    } catch (error) {
      setMessage('sync-status', `Проверка не прошла: ${error.message}`, 'error');
    }
  });

  $('open-sync-help').addEventListener('click', () => {
    const [title, steps] = syncHelp($('sync-provider').value);
    $('sync-help-title').textContent = `Как настроить: ${title}`;
    $('sync-help-content').innerHTML = `<ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`;
    $('sync-help-dialog').showModal();
  });

  $('save-settings').addEventListener('click', async () => {
    await session.updateSettings({
      autoLockMinutes: $('auto-lock-minutes').value,
      clipboardClearSeconds: $('clipboard-clear-seconds').value,
    });
    resetAutoLock();
    setMessage('settings-status', 'Настройки сохранены.');
  });

  $('generate-password').addEventListener('click', () => {
    try {
      generatedPassword = generateFromSettings();
      $('generated-password').textContent = generatedPassword;
    } catch (error) {
      $('generated-password').textContent = 'Ошибка настроек';
    }
  });

  $('copy-generated-password').addEventListener('click', async () => {
    if (!generatedPassword) generatedPassword = generateFromSettings();
    $('generated-password').textContent = generatedPassword;
    await navigator.clipboard.writeText(generatedPassword);
    scheduleClipboardClear(generatedPassword);
  });

  $('export-vault').addEventListener('click', async () => {
    downloadJson(`${session.name}.actitpass-vault.json`, await session.exportEncrypted());
  });

  $('download-sync-package').addEventListener('click', async () => {
    downloadJson(`${session.name}.actitpass-sync.json`, await session.exportSyncPackage());
  });

  $('run-provider-sync').addEventListener('click', async () => {
    const provider = $('sync-provider').value;
    if (!['mounted_folder', 'webdav', 'ftp', 'email'].includes(provider)) {
      setMessage('sync-status', 'В текущей запускаемой версии автоматическая синхронизация реализована для папки / SMB / NFS, WebDAV, FTP и почты IMAP/SMTP.', 'error');
      return;
    }
    const config = collectSyncConfig();
    $('sync-config').value = config;
    const validation = validateSyncValues(provider, collectSyncValues());
    if (!validation.ok) {
      setMessage('sync-status', validation.message, 'error');
      return;
    }
    const ftpSecurity = document.querySelector('[data-sync-field="security"]')?.value;
    if (provider === 'ftp' && ftpSecurity && ftpSecurity !== 'ftp') {
      setMessage('sync-status', 'FTPS выбран в форме, но автоматический FTPS будет подключен в промышленном ядре. Для текущей запускаемой версии выберите FTP или используйте WebDAV через HTTPS.', 'error');
      return;
    }
    if (!config) {
      setMessage('sync-status', syncConfigHint(provider), 'error');
      return;
    }
    const password = await requestPassword('Введите мастер-пароль для чтения пакетов синхронизации');
    if (!password) return;
    try {
      await session.configureSync(provider, config);
      const adapter = syncAdapter(provider, config);
      const listed = await apiPost(adapter.listUrl, adapter.body());
      let applied = 0;
      let duplicate = 0;
      let own = 0;
      let skipped = 0;
      for (const fileName of listed.files) {
        try {
          const remote = await apiPost(adapter.readUrl, adapter.body({ fileName }));
          const result = await session.importSyncPackage(remote.package, password);
          if (result.status === 'applied') applied += 1;
          else if (result.status === 'skipped_duplicate') duplicate += 1;
          else if (result.status === 'skipped_own_device') own += 1;
        } catch (error) {
          skipped += 1;
        }
      }
      const syncPackage = await session.exportSyncPackage();
      const safeVault = session.data.vaultId.replace(/[^a-zA-Z0-9_-]/g, '');
      const safeDevice = session.data.deviceId.replace(/[^a-zA-Z0-9_-]/g, '');
      const fileName = `${safeVault}-${safeDevice}-${Date.now()}.actitpass-sync.json`;
      await apiPost(adapter.writeUrl, adapter.body({ fileName, package: syncPackage }));
      renderAll();
      setMessage('sync-status', `${adapter.label} синхронизирован: применено ${applied}, повторов ${duplicate}, своих ${own}, ошибок ${skipped}, записан ${fileName}.`);
    } catch (error) {
      setMessage('sync-status', `Ошибка синхронизации: ${error.message}`, 'error');
    }
  });

  $('import-vault').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const password = await requestPassword('Введите мастер-пароль импортируемой базы');
      if (!password) return;
      session = await core.importEncryptedVault(await readJsonFile(file), password);
      showWorkspace();
    } catch (error) {
      alert('Не удалось импортировать базу.');
    } finally {
      event.target.value = '';
    }
  });

  $('upload-sync-package').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const password = await requestPassword('Введите мастер-пароль пакета синхронизации');
      if (!password) return;
      await session.importSyncPackage(await readJsonFile(file), password);
      setMessage('sync-status', 'Sync-пакет применен.');
      renderAll();
    } catch (error) {
      setMessage('sync-status', 'Не удалось применить пакет синхронизации.', 'error');
    } finally {
      event.target.value = '';
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session) lock();
  });
  ['click', 'keydown', 'input', 'pointermove'].forEach((eventName) => {
    document.addEventListener(eventName, resetAutoLock, { passive: true });
  });

  setMode('open');
})();
