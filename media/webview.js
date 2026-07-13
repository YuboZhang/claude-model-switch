const vscode = acquireVsCodeApi();
const searchableSelects = Array.from(document.querySelectorAll('.searchable-select'));
const modelSpeedTestBtns = Array.from(document.querySelectorAll('.model-speed-test-btn'));
const modelsStatus = document.getElementById('modelsStatus');
const fetchModelsBtn = document.getElementById('fetchModelsBtn');
const pendingModelSpeedTests = new Map();
const modelNameSourceIds = [
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_MODEL',
];
const oneMillionContextTargets = [
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_MODEL',
];

// Import toolbar variables and event handlers
const importProjectBtn = document.getElementById('importProjectBtn');
const importGlobalBtn = document.getElementById('importGlobalBtn');
const importStatus = document.getElementById('importStatus');

function setImportStatus(text, type) {
  if (!importStatus) return;
  importStatus.textContent = text || '';
  importStatus.className = `import-status ${type || ''}`.trim();
}

function syncSearchableSelectFromTarget(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const select = document.querySelector(`.searchable-select[data-target="${id}"]`);
  if (!select) return;
  const displayInput = select.querySelector('.searchable-select-input');
  if (displayInput) {
    displayInput.value = target.value;
  }
  const list = select.querySelector('.searchable-select-list');
  if (list) {
    list.querySelectorAll('.searchable-select-item').forEach(item => {
      if (item.dataset.value === target.value) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
  }
}

if (importProjectBtn) {
  importProjectBtn.addEventListener('click', function() {
    setImportStatus('Loading...', 'loading');
    vscode.postMessage({ type: 'loadConfig', source: 'project' });
  });
}

if (importGlobalBtn) {
  importGlobalBtn.addEventListener('click', function() {
    setImportStatus('Loading...', 'loading');
    vscode.postMessage({ type: 'loadConfig', source: 'global' });
  });
}

// Extra settings (JSON tree, sibling of env)
const extraSettingsTree = document.getElementById('extraSettingsTree');
const addExtraSettingBtn = document.getElementById('addExtraSettingBtn');
const extraSettingsData = JSON.parse(document.body.dataset.extraSettingsData || '{}');

const ES_TYPE_LABELS = {
  string: document.body.dataset.typeString || 'String',
  number: document.body.dataset.typeNumber || 'Number',
  boolean: document.body.dataset.typeBoolean || 'Boolean',
  null: document.body.dataset.typeNull || 'Null',
  object: document.body.dataset.typeObject || 'Object',
  array: document.body.dataset.typeArray || 'Array',
};

function esTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

function esDefaultValue(type) {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'null': return null;
    case 'object': return {};
    case 'array': return [];
    default: return '';
  }
}

// 构建标量类型（string/number/boolean）的值控件
function buildScalarControl(type, value) {
  if (type === 'boolean') {
    const select = document.createElement('select');
    select.className = 'es-bool';
    for (const v of ['true', 'false']) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
    select.value = value ? 'true' : 'false';
    select.addEventListener('change', notifyTreeChanged);
    return select;
  }
  const input = document.createElement('input');
  input.className = 'es-input';
  input.type = type === 'number' ? 'number' : 'text';
  input.value = value === null || value === undefined ? '' : String(value);
  input.addEventListener('input', notifyTreeChanged);
  return input;
}

// 构建对象/数组的子节点区块（整宽、左缩进，向下展开）
function buildChildrenBlock(type, value) {
  const isArr = type === 'array';
  const block = document.createElement('div');
  block.className = 'es-children';
  block.dataset.type = type;

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'es-add';
  addBtn.textContent = isArr
    ? (document.body.dataset.addItem || '+ Add Item')
    : (document.body.dataset.addChild || '+ Add Child');
  addBtn.addEventListener('click', function() {
    block.insertBefore(isArr ? createEntry(true, '', '') : createEntry(false, '', ''), addBtn);
    notifyTreeChanged();
  });

  if (isArr && Array.isArray(value)) {
    for (const item of value) {
      block.appendChild(createEntry(true, '', item, true));
    }
  } else if (!isArr && value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      block.appendChild(createEntry(false, k, v, true));
    }
  }
  block.appendChild(addBtn);
  return block;
}

// 递归构建一条 .es-entry：头部一行（key + 类型 + 标量值 + 删除），
// 对象/数组的子节点放在头部下方整宽缩进区块，避免层级向右堆叠。
function createEntry(parentIsArray, key, value, startCollapsed = false) {
  const entry = document.createElement('div');
  entry.className = startCollapsed ? 'es-entry collapsed' : 'es-entry';

  const header = document.createElement('div');
  header.className = 'es-header';
  entry.appendChild(header);

  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'es-toggle-chevron hidden';
  chevron.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;
  chevron.addEventListener('click', function(e) {
    e.stopPropagation();
    entry.classList.toggle('collapsed');
  });
  header.appendChild(chevron);

  if (!parentIsArray) {
    const keyInput = document.createElement('input');
    keyInput.className = 'es-key';
    keyInput.type = 'text';
    keyInput.placeholder = document.body.dataset.esKey || 'Key';
    keyInput.value = key === undefined || key === null ? '' : String(key);
    keyInput.addEventListener('input', notifyTreeChanged);
    header.appendChild(keyInput);
  } else {
    const indexBadge = document.createElement('span');
    indexBadge.className = 'es-index-badge';
    indexBadge.textContent = '[]';
    header.appendChild(indexBadge);
  }

  const type = esTypeOf(value);
  const typeSelect = document.createElement('select');
  typeSelect.className = 'es-type';
  for (const t of ['string', 'number', 'boolean', 'null', 'object', 'array']) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = ES_TYPE_LABELS[t];
    typeSelect.appendChild(opt);
  }
  typeSelect.value = type;
  header.appendChild(typeSelect);

  const scalar = document.createElement('div');
  scalar.className = 'es-scalar';
  header.appendChild(scalar);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-env';
  removeBtn.textContent = document.body.dataset.remove || 'Remove';
  removeBtn.addEventListener('click', function() {
    entry.remove();
    notifyTreeChanged();
  });
  header.appendChild(removeBtn);

  // 根据类型渲染：标量填入 .es-scalar；对象/数组追加子节点区块到 entry 下方
  function renderBody(t, v) {
    while (scalar.firstChild) scalar.removeChild(scalar.firstChild);
    const oldBlock = entry.querySelector(':scope > .es-children');
    if (oldBlock) oldBlock.remove();

    if (t === 'string' || t === 'number' || t === 'boolean') {
      chevron.classList.add('hidden');
      entry.classList.remove('collapsed');
      scalar.appendChild(buildScalarControl(t, v));
    } else if (t === 'object' || t === 'array') {
      chevron.classList.remove('hidden');
      entry.appendChild(buildChildrenBlock(t, v));
    } else {
      chevron.classList.add('hidden');
      entry.classList.remove('collapsed');
    }
  }

  renderBody(type, value);

  typeSelect.addEventListener('change', function() {
    renderBody(this.value, esDefaultValue(this.value));
    notifyTreeChanged();
  });

  return entry;
}

// 读取一个容器内的直接子条目，asArray 决定按数组还是对象组装
function readContainer(containerEl, asArray) {
  const entries = Array.from(containerEl.children).filter(c => c.classList.contains('es-entry'));
  if (asArray) {
    return entries.map(entry => readEntry(entry));
  }
  const result = {};
  for (const entry of entries) {
    const keyInput = entry.querySelector(':scope > .es-header > .es-key');
    const key = keyInput ? keyInput.value.trim() : '';
    if (!key) continue;
    result[key] = readEntry(entry);
  }
  return result;
}

function readEntry(entry) {
  const type = entry.querySelector(':scope > .es-header > .es-type').value;
  switch (type) {
    case 'string': {
      const input = entry.querySelector(':scope > .es-header > .es-scalar > .es-input');
      return input ? input.value : '';
    }
    case 'number': {
      const input = entry.querySelector(':scope > .es-header > .es-scalar > .es-input');
      const n = Number(input ? input.value : '');
      return Number.isNaN(n) ? 0 : n;
    }
    case 'boolean': {
      const select = entry.querySelector(':scope > .es-header > .es-scalar > .es-bool');
      return select ? select.value === 'true' : false;
    }
    case 'null':
      return null;
    case 'object': {
      const children = entry.querySelector(':scope > .es-children');
      return children ? readContainer(children, false) : {};
    }
    case 'array': {
      const children = entry.querySelector(':scope > .es-children');
      return children ? readContainer(children, true) : [];
    }
    default:
      return '';
  }
}

// JSON 预览/编辑区：与树双向同步
const esJsonEl = document.getElementById('esJson');
const esApplyJsonBtn = document.getElementById('esApplyJsonBtn');
const esJsonStatus = document.getElementById('esJsonStatus');
let esSuppressJsonSync = false;

function esSetJsonStatus(text, type) {
  if (!esJsonStatus) return;
  esJsonStatus.textContent = text || '';
  esJsonStatus.className = `es-json-status ${type || ''}`.trim();
}

function updateArrayIndices(root) {
  const arrayBlocks = root.querySelectorAll('.es-children[data-type="array"]');
  arrayBlocks.forEach(block => {
    const entries = Array.from(block.children).filter(c => c.classList.contains('es-entry'));
    entries.forEach((entry, idx) => {
      const badge = entry.querySelector(':scope > .es-header > .es-index-badge');
      if (badge) {
        badge.textContent = `[${idx}]`;
      }
    });
  });
}

// 树 → JSON：任意树改动后把当前树序列化进文本框
function notifyTreeChanged() {
  if (esSuppressJsonSync || !esJsonEl) return;
  updateArrayIndices(extraSettingsTree);
  const data = readContainer(extraSettingsTree, false);
  esJsonEl.value = JSON.stringify(data, null, 2);
  esSetJsonStatus(document.body.dataset.esJsonSynced || 'Synced from tree', 'success');
}

// 用一个对象重建整棵树
function rebuildTreeFromData(data) {
  while (extraSettingsTree.firstChild) extraSettingsTree.removeChild(extraSettingsTree.firstChild);
  for (const [k, v] of Object.entries(data)) {
    extraSettingsTree.appendChild(createEntry(false, k, v, true));
  }
  updateArrayIndices(extraSettingsTree);
}

for (const [k, v] of Object.entries(extraSettingsData)) {
  extraSettingsTree.appendChild(createEntry(false, k, v, true));
}
updateArrayIndices(extraSettingsTree);

addExtraSettingBtn.addEventListener('click', function() {
  extraSettingsTree.appendChild(createEntry(false, '', ''));
  notifyTreeChanged();
});

// JSON → 树：失焦/输入实时校验与同步
if (esJsonEl) {
  esJsonEl.addEventListener('input', function() {
    const raw = esJsonEl.value.trim();
    if (raw === '') {
      esSetJsonStatus('', '');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        esSetJsonStatus(document.body.dataset.esJsonNotObject || 'Top level must be an object', 'error');
      } else {
        esSetJsonStatus(document.body.dataset.esJsonValid || 'JSON is valid (will apply on blur)', 'success');
      }
    } catch (e) {
      esSetJsonStatus(`${document.body.dataset.esJsonInvalid || 'Invalid JSON'}: ${e.message}`, 'error');
    }
  });

  esJsonEl.addEventListener('blur', function() {
    const raw = esJsonEl.value.trim();
    let parsed;
    try {
      parsed = raw === '' ? {} : JSON.parse(raw);
    } catch (e) {
      return; // Do not apply on blur if invalid JSON
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }

    const currentData = readContainer(extraSettingsTree, false);
    if (JSON.stringify(currentData) === JSON.stringify(parsed)) {
      return;
    }

    esSuppressJsonSync = true;
    rebuildTreeFromData(parsed);
    esSuppressJsonSync = false;
    esJsonEl.value = JSON.stringify(parsed, null, 2);
    esSetJsonStatus(document.body.dataset.esJsonApplied || 'Applied', 'success');
  });
}

const esFullscreenBtn = document.getElementById('esFullscreenBtn');
if (esFullscreenBtn) {
  esFullscreenBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    const sub = document.getElementById('esJsonSubSection');
    if (sub) {
      sub.classList.remove('collapsed');
      sub.classList.toggle('fullscreen');
      if (sub.classList.contains('fullscreen')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
  });
}

// 初始化文本框为初始树内容
if (esJsonEl) {
  esJsonEl.value = JSON.stringify(extraSettingsData, null, 2);
}

// Collapsible cards & sub-sections：点击标题折叠/展开，折叠状态在面板存活期内记忆
(function setupCollapsibleCards() {
  const state = vscode.getState() || {};
  const collapsed = state.collapsedCards || {};
  
  // Outer cards
  document.querySelectorAll('.card').forEach(function(card, idx) {
    const header = card.querySelector('.card-header');
    if (!header) return;
    const stored = collapsed[idx];
    const isCollapsed = stored === undefined ? card.hasAttribute('data-default-collapsed') : stored;
    if (isCollapsed) card.classList.add('collapsed');
    header.addEventListener('click', function() {
      card.classList.toggle('collapsed');
      collapsed[idx] = card.classList.contains('collapsed');
      const s = vscode.getState() || {};
      s.collapsedCards = collapsed;
      vscode.setState(s);
    });
  });

  // Inner sub-sections (Tree View and JSON View inside Extra Settings)
  document.querySelectorAll('.sub-section').forEach(function(sub, idx) {
    const header = sub.querySelector('.sub-section-header');
    if (!header) return;
    const stored = collapsed['sub_' + idx];
    const isCollapsed = stored === undefined ? sub.hasAttribute('data-default-collapsed') : stored;
    if (isCollapsed) sub.classList.add('collapsed');
    header.addEventListener('click', function() {
      sub.classList.toggle('collapsed');
      collapsed['sub_' + idx] = sub.classList.contains('collapsed');
      const s = vscode.getState() || {};
      s.collapsedCards = collapsed;
      vscode.setState(s);
    });
  });
})();

for (const targetId of oneMillionContextTargets) {
  const input = document.getElementById(targetId);
  const checkbox = document.getElementById(`${targetId}_ONE_MILLION_CONTEXT`);
  const parsed = parseOneMillionContextModel(input?.value || '');
  if (input) input.value = parsed.model;
  if (checkbox) checkbox.checked = checkbox.checked || parsed.supportsOneMillionContext;
}

// Initialize display inputs from target inputs on page load
for (const id of modelNameSourceIds) {
  const targetInput = document.getElementById(id);
  if (targetInput && targetInput.value) {
    const select = document.querySelector(`.searchable-select[data-target="${id}"]`);
    const displayInput = select?.querySelector('.searchable-select-input');
    if (displayInput) {
      displayInput.value = parseOneMillionContextModel(targetInput.value).model;
    }
  }
}

// Toggle token visibility with eye icon inside input
document.getElementById('toggleAuthToken').addEventListener('click', function() {
  const input = document.getElementById('ANTHROPIC_AUTH_TOKEN');
  if (input.type === 'password') {
    input.type = 'text';
    this.classList.add('showing');
  } else {
    input.type = 'password';
    this.classList.remove('showing');
  }
});

// Save
document.getElementById('saveBtn').addEventListener('click', function() {
  let name = document.getElementById('name').value.trim();
  if (!name) {
    name = getFirstModelValue() || document.body.dataset.unnamed || 'Unnamed';
  }

  const env = {
    ANTHROPIC_AUTH_TOKEN: document.getElementById('ANTHROPIC_AUTH_TOKEN').value,
    ANTHROPIC_BASE_URL: document.getElementById('ANTHROPIC_BASE_URL').value,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: getModelValue('ANTHROPIC_DEFAULT_HAIKU_MODEL'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: getModelValueForSave('ANTHROPIC_DEFAULT_SONNET_MODEL'),
    ANTHROPIC_DEFAULT_OPUS_MODEL: getModelValueForSave('ANTHROPIC_DEFAULT_OPUS_MODEL'),
    ANTHROPIC_DEFAULT_FABLE_MODEL: getModelValueForSave('ANTHROPIC_DEFAULT_FABLE_MODEL'),
    ANTHROPIC_MODEL: getModelValueForSave('ANTHROPIC_MODEL'),
  };


  let extraSettings = readContainer(extraSettingsTree, false);
  const rawJson = esJsonEl ? esJsonEl.value.trim() : '';
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        esSetJsonStatus(document.body.dataset.esJsonNotObject || 'Top level must be an object', 'error');
        return;
      }
      extraSettings = parsed;
    } catch (e) {
      esSetJsonStatus(`${document.body.dataset.esJsonInvalid || 'Invalid JSON'}: ${e.message}`, 'error');
      return; // Block save if JSON is invalid
    }
  }

  const profile = {
    id: '',
    name: name,
    effort: document.getElementById('effort').value,
    env: env,
    extraSettings: extraSettings,
  };

  vscode.postMessage({ type: 'save', profile });
});

// Cancel
document.getElementById('cancelBtn').addEventListener('click', function() {
  vscode.postMessage({ type: 'cancel' });
});

// Fetch available models
fetchModelsBtn.addEventListener('click', function() {
  const baseURL = document.getElementById('ANTHROPIC_BASE_URL').value.trim();

  setStatus(document.body.dataset.fetchLoading || 'Fetching models...', 'loading');
  fetchModelsBtn.disabled = true;
  vscode.postMessage({
    type: 'fetchModels',
    baseURL,
    token: document.getElementById('ANTHROPIC_AUTH_TOKEN').value,
  });
});

window.addEventListener('message', function(event) {
  const message = event.data;
  switch (message.type) {
    case 'configLoaded': {
      const config = message.config;
      const sourceLabel = message.source === 'global' 
        ? (document.body.dataset.esGlobalSource || 'Global') 
        : (document.body.dataset.esProjectSource || 'Project');
      
      document.getElementById('name').value = config.name || '';
      document.getElementById('ANTHROPIC_AUTH_TOKEN').value = config.env.ANTHROPIC_AUTH_TOKEN || '';
      document.getElementById('ANTHROPIC_BASE_URL').value = config.env.ANTHROPIC_BASE_URL || '';

      const haikuInput = document.getElementById('ANTHROPIC_DEFAULT_HAIKU_MODEL');
      if (haikuInput) {
        haikuInput.value = config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '';
        syncSearchableSelectFromTarget('ANTHROPIC_DEFAULT_HAIKU_MODEL');
      }

      const sonnetParsed = parseOneMillionContextModel(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '');
      const sonnetInput = document.getElementById('ANTHROPIC_DEFAULT_SONNET_MODEL');
      if (sonnetInput) {
        sonnetInput.value = sonnetParsed.model;
        syncSearchableSelectFromTarget('ANTHROPIC_DEFAULT_SONNET_MODEL');
      }
      const sonnetCheck = document.getElementById('ANTHROPIC_DEFAULT_SONNET_MODEL_ONE_MILLION_CONTEXT');
      if (sonnetCheck) {
        sonnetCheck.checked = sonnetParsed.supportsOneMillionContext;
      }

      const opusParsed = parseOneMillionContextModel(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL || '');
      const opusInput = document.getElementById('ANTHROPIC_DEFAULT_OPUS_MODEL');
      if (opusInput) {
        opusInput.value = opusParsed.model;
        syncSearchableSelectFromTarget('ANTHROPIC_DEFAULT_OPUS_MODEL');
      }
      const opusCheck = document.getElementById('ANTHROPIC_DEFAULT_OPUS_MODEL_ONE_MILLION_CONTEXT');
      if (opusCheck) {
        opusCheck.checked = opusParsed.supportsOneMillionContext;
      }

      const fableParsed = parseOneMillionContextModel(config.env.ANTHROPIC_DEFAULT_FABLE_MODEL || '');
      const fableInput = document.getElementById('ANTHROPIC_DEFAULT_FABLE_MODEL');
      if (fableInput) {
        fableInput.value = fableParsed.model;
        syncSearchableSelectFromTarget('ANTHROPIC_DEFAULT_FABLE_MODEL');
      }
      const fableCheck = document.getElementById('ANTHROPIC_DEFAULT_FABLE_MODEL_ONE_MILLION_CONTEXT');
      if (fableCheck) {
        fableCheck.checked = fableParsed.supportsOneMillionContext;
      }

      const fallbackParsed = parseOneMillionContextModel(config.env.ANTHROPIC_MODEL || '');
      const fallbackInput = document.getElementById('ANTHROPIC_MODEL');
      if (fallbackInput) {
        fallbackInput.value = fallbackParsed.model;
        syncSearchableSelectFromTarget('ANTHROPIC_MODEL');
      }
      const fallbackCheck = document.getElementById('ANTHROPIC_MODEL_ONE_MILLION_CONTEXT');
      if (fallbackCheck) {
        fallbackCheck.checked = fallbackParsed.supportsOneMillionContext;
      }

      const extraSettings = config.extraSettings || {};
      rebuildTreeFromData(extraSettings);
      if (esJsonEl) {
        esJsonEl.value = JSON.stringify(extraSettings, null, 2);
        esSetJsonStatus(document.body.dataset.esJsonSynced || 'Synced from tree', 'success');
      }

      setImportStatus(formatTemplate(document.body.dataset.esImportSuccess || 'Imported {0} settings successfully', sourceLabel), 'success');
      break;
    }
    case 'configLoadFailed': {
      setImportStatus(message.error || 'Failed to load configuration', 'error');
      break;
    }
    case 'modelsFetched': {
      const modelEntries = normalizeModelEntries(message);
      populateModelSelects(modelEntries);
      setStatus(
        formatTemplate(
          document.body.dataset.fetchSuccess || 'Fetched {0} models',
          modelEntries.length,
        ),
        'success',
      );
      fetchModelsBtn.disabled = false;
      break;
    }
    case 'modelsFetchFailed': {
      setStatus(formatTemplate(document.body.dataset.fetchFailed || 'Failed to fetch models: {0}', message.error || ''), 'error');
      fetchModelsBtn.disabled = false;
      break;
    }
    case 'modelSpeedTestResult': {
      const pending = pendingModelSpeedTests.get(message.requestId);
      if (pending) {
        pending.button.disabled = false;
        pending.button.classList.remove('loading');
        pendingModelSpeedTests.delete(message.requestId);
      }

      const requestedModel = message.requestedModel || pending?.model || '';
      const returnedModel = message.model || '';
      const statusEl = pending?.statusEl;
      if (message.status === 'success') {
        const modelText = requestedModel || returnedModel;
        const returnedText = returnedModel && returnedModel !== requestedModel ? ` → ${returnedModel}` : '';
        const speedText = message.formattedText || `${message.durationMs}ms`;
        const text = `${speedText} ${modelText}${returnedText}`.trim();
        if (statusEl) setRowStatus(statusEl, text, 'success');
        else setStatus(text, 'success');
      } else {
        const error = message.error || 'Speed test failed';
        const modelText = requestedModel ? `${requestedModel}: ` : '';
        const text = `${modelText}${error} (${message.durationMs}ms)`;
        if (statusEl) setRowStatus(statusEl, text, 'error');
        else setStatus(text, 'error');
      }
      break;
    }
  }
});

for (const button of modelSpeedTestBtns) {
  button.addEventListener('click', function() {
    const targetId = this.dataset.target;
    const modelInput = document.getElementById(targetId);
    let model = getModelValueFromInput(modelInput);
    
    // 在配置页（Webview）测速时，直接读取对应的复选框状态
    const isOneMillionContext = document.getElementById(`${targetId}_ONE_MILLION_CONTEXT`)?.checked;
    if (isOneMillionContext && model && !model.endsWith('[1m]')) {
      model = `${model.trim()}[1m]`;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const statusEl = document.querySelector(`.row-status[data-target="${targetId}"]`);
    pendingModelSpeedTests.set(requestId, { button: this, model, statusEl });
    this.disabled = true;
    this.classList.add('loading');
    const loadingText = model ? `${this.textContent}: ${model}` : this.textContent;
    if (statusEl) setRowStatus(statusEl, loadingText, 'loading');
    else setStatus(loadingText, 'loading');

    vscode.postMessage({
      type: 'testModelSpeed',
      requestId,
      target: targetId,
      model,
      baseURL: document.getElementById('ANTHROPIC_BASE_URL').value,
      authToken: document.getElementById('ANTHROPIC_AUTH_TOKEN').value,
    });
  });
}

// Searchable select toggle
for (const select of searchableSelects) {
  const displayInput = select.querySelector('.searchable-select-input');
  const searchInput = select.querySelector('.searchable-select-search');

  displayInput.addEventListener('click', function(e) {
    e.stopPropagation();
    // Close other selects
    searchableSelects.forEach(s => { if (s !== select) s.classList.remove('open'); });

    // Check if the model list is empty
    const list = select.querySelector('.searchable-select-list');
    const hasModels = list && list.querySelectorAll('.searchable-select-item').length > 0;
    const searchInput = select.querySelector('.searchable-select-search');
    const emptyMsg = select.querySelector('.searchable-select-empty');

    if (!hasModels) {
      if (searchInput) searchInput.style.display = 'none';
      if (emptyMsg) {
        emptyMsg.textContent = document.body.dataset.pleaseFetchModels || 'Please fetch models';
        emptyMsg.style.display = 'block';
      }
    } else {
      if (searchInput) searchInput.style.display = '';
      if (emptyMsg) {
        emptyMsg.textContent = document.body.dataset.noModelsFound || 'No models found';
        emptyMsg.style.display = 'none';
      }
    }

    select.classList.toggle('open');
    if (select.classList.contains('open') && hasModels) {
      searchInput.value = '';
      searchInput.focus();
      // Show all items
      select.querySelectorAll('.searchable-select-item').forEach(item => {
        item.style.display = '';
        item.classList.remove('highlighted');
      });
      // 高亮当前 .selected 项（若有），否则高亮第一项
      const items = select.querySelectorAll('.searchable-select-item');
      let toHighlight = null;
      items.forEach(i => { if (i.classList.contains('selected')) toHighlight = i; });
      if (!toHighlight && items.length) toHighlight = items[0];
      if (toHighlight) {
        toHighlight.classList.add('highlighted');
        toHighlight.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  searchInput.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  const dropdown = select.querySelector('.searchable-select-dropdown');
  dropdown.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  // 键盘导航：ArrowDown/Up 移动高亮、Enter 选中、Escape 关闭
  const list = select.querySelector('.searchable-select-list');
  function getVisibleItems() {
    return Array.from(list.querySelectorAll('.searchable-select-item')).filter(i => i.style.display !== 'none');
  }
  function clearHighlight() {
    list.querySelectorAll('.searchable-select-item.highlighted').forEach(i => i.classList.remove('highlighted'));
  }
  function setHighlight(item) {
    clearHighlight();
    if (!item) return;
    item.classList.add('highlighted');
    item.scrollIntoView({ block: 'nearest' });
  }
  function highlightIndex(dir) {
    const items = getVisibleItems();
    if (!items.length) return;
    const currentIdx = items.findIndex(i => i.classList.contains('highlighted'));
    let nextIdx;
    if (currentIdx === -1) {
      nextIdx = dir > 0 ? 0 : items.length - 1;
    } else {
      nextIdx = (currentIdx + dir + items.length) % items.length;
    }
    setHighlight(items[nextIdx]);
  }
  function selectHighlighted() {
    const items = getVisibleItems();
    const h = list.querySelector('.searchable-select-item.highlighted') || (items.length ? items[0] : null);
    if (h) h.click();
  }
  function highlightInitial() {
    clearHighlight();
    const items = getVisibleItems();
    if (!items.length) return;
    const selected = items.find(i => i.classList.contains('selected'));
    setHighlight(selected || items[0]);
  }

  displayInput.addEventListener('keydown', function(e) {
    if (!select.classList.contains('open')) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        displayInput.click();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightIndex(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlightIndex(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); selectHighlighted(); }
    else if (e.key === 'Escape') { e.preventDefault(); select.classList.remove('open'); clearHighlight(); }
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightIndex(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlightIndex(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); selectHighlighted(); }
    else if (e.key === 'Escape') { e.preventDefault(); select.classList.remove('open'); clearHighlight(); }
  });
}

// 鼠标悬停时同步高亮（避免键盘高亮与鼠标脱节）
for (const select of searchableSelects) {
  const list = select.querySelector('.searchable-select-list');
  list.addEventListener('mouseover', function(e) {
    const item = e.target.closest('.searchable-select-item');
    if (item) {
      list.querySelectorAll('.searchable-select-item.highlighted').forEach(i => i.classList.remove('highlighted'));
      item.classList.add('highlighted');
    }
  });
}

// Close dropdowns on outside click
document.addEventListener('click', function() {
  searchableSelects.forEach(s => {
    s.classList.remove('open');
    s.querySelectorAll('.searchable-select-item.highlighted').forEach(i => i.classList.remove('highlighted'));
  });
});

// Auto-fill name from the first configured model if name is empty
for (const inputId of modelNameSourceIds) {
  document.getElementById(inputId).addEventListener('input', function() {
    const nameInput = document.getElementById('name');
    if (!nameInput.value.trim()) {
      nameInput.value = getFirstModelValue();
    }
  });
}

function getModelValue(id) {
  return getModelValueFromInput(document.getElementById(id));
}

function getModelValueForSave(id) {
  const checkbox = document.getElementById(`${id}_ONE_MILLION_CONTEXT`);
  return formatOneMillionContextModel(getModelValue(id), checkbox?.checked);
}

function getModelValueFromInput(input) {
  return parseOneMillionContextModel(input?.value || '').model.trim();
}

function getFirstModelValue() {
  for (const inputId of modelNameSourceIds) {
    const value = getModelValue(inputId);
    if (value) return value;
  }
  return '';
}

function parseOneMillionContextModel(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.endsWith('[1m]')) {
    return { model: trimmed, supportsOneMillionContext: false };
  }
  return {
    model: trimmed.slice(0, -4).trim(),
    supportsOneMillionContext: true,
  };
}

function formatOneMillionContextModel(value, supportsOneMillionContext) {
  const model = parseOneMillionContextModel(value).model;
  if (!model) return '';
  return supportsOneMillionContext ? `${model}[1m]` : model;
}

function normalizeModelEntries(message) {
  if (Array.isArray(message.modelEntries)) {
    return message.modelEntries
      .map(function(entry) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        if (!id) return null;
        const displayName =
          typeof entry.displayName === 'string' && entry.displayName.trim()
            ? entry.displayName.trim()
            : undefined;
        return { id, displayName };
      })
      .filter(Boolean);
  }
  if (Array.isArray(message.models)) {
    return message.models
      .map(function(id) {
        const trimmed = typeof id === 'string' ? id.trim() : '';
        return trimmed ? { id: trimmed } : null;
      })
      .filter(Boolean);
  }
  return [];
}

function formatModelEntryLabel(entry) {
  if (entry.displayName && entry.displayName !== entry.id) {
    return `${entry.displayName} — ${entry.id}`;
  }
  return entry.displayName || entry.id;
}

function populateModelSelects(modelEntries) {
  for (const select of searchableSelects) {
    const target = document.getElementById(select.dataset.target);
    const currentValue = getModelValueFromInput(target);
    const list = select.querySelector('.searchable-select-list');
    const searchInput = select.querySelector('.searchable-select-search');
    const emptyMsg = select.querySelector('.searchable-select-empty');
    const displayInput = select.querySelector('.searchable-select-input');

    // Populate list
    list.innerHTML = '';
    for (const entry of modelEntries) {
      const item = document.createElement('div');
      item.className = 'searchable-select-item';
      item.dataset.value = entry.id;
      item.dataset.searchText = `${entry.id} ${entry.displayName || ''}`.toLowerCase();
      const span = document.createElement('span');
      span.className = 'item-text';
      span.textContent = formatModelEntryLabel(entry);
      item.appendChild(span);
      item.title = entry.id;
      if (entry.id === currentValue) {
        item.classList.add('selected');
        displayInput.value = entry.displayName && entry.displayName !== entry.id
          ? entry.displayName
          : entry.id;
      }
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        const label = span.textContent || this.dataset.value;
        displayInput.value = label;
        target.value = this.dataset.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        select.classList.remove('open');
        list.querySelectorAll('.searchable-select-item').forEach(i => i.classList.remove('selected'));
        this.classList.add('selected');
      });
      list.appendChild(item);
    }

    if (!currentValue) {
      displayInput.value = '';
    }

    // Search filter
    searchInput.value = '';
    searchInput.addEventListener('input', function() {
      const query = this.value.toLowerCase();
      let hasVisible = false;
      list.querySelectorAll('.searchable-select-item').forEach(item => {
        const text = item.dataset.searchText || item.dataset.value || '';
        const match = text.includes(query);
        item.style.display = match ? '' : 'none';
        if (match) hasVisible = true;
      });
      emptyMsg.style.display = hasVisible ? 'none' : '';
    });
  }
}

function setStatus(text, type) {
  modelsStatus.textContent = text;
  modelsStatus.className = `models-status ${type}`;
}

function setRowStatus(el, text, type) {
  el.textContent = text;
  el.className = `row-status ${type}`;
}

function formatTemplate(template, value) {
  return template.replace('{0}', String(value));
}
