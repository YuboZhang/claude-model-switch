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
  'ANTHROPIC_MODEL',
];
const oneMillionContextTargets = [
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_MODEL',
];

// Extra env vars
const extraEnvContainer = document.getElementById('extraEnvContainer');
const addExtraEnvBtn = document.getElementById('addExtraEnvBtn');
const extraEnvData = JSON.parse(document.body.dataset.extraEnvData || '[]');

function createExtraEnvRow(key, value) {
  const row = document.createElement('div');
  row.className = 'extra-env-row';
  row.innerHTML = `<input type="text" class="extra-env-key" placeholder="${document.body.dataset.envKey || 'Key'}" value="${escapeHtml(key)}" /><input type="text" class="extra-env-value" placeholder="${document.body.dataset.envValue || 'Value'}" value="${escapeHtml(value)}" /><button type="button" class="btn-remove-env">${document.body.dataset.removeEnvVar || 'Remove'}</button>`;
  row.querySelector('.btn-remove-env').addEventListener('click', function() {
    row.remove();
  });
  return row;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

for (const env of extraEnvData) {
  extraEnvContainer.appendChild(createExtraEnvRow(env.key, env.value));
}

addExtraEnvBtn.addEventListener('click', function() {
  extraEnvContainer.appendChild(createExtraEnvRow('', ''));
});

// Collapsible cards：点击分组标题折叠/展开，折叠状态在面板存活期内记忆
(function setupCollapsibleCards() {
  const state = vscode.getState() || {};
  const collapsed = state.collapsedCards || {};
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
    ANTHROPIC_MODEL: getModelValueForSave('ANTHROPIC_MODEL'),
  };

  // Collect extra env vars
  const envRows = extraEnvContainer.querySelectorAll('.extra-env-row');
  for (const row of envRows) {
    const key = row.querySelector('.extra-env-key').value.trim();
    const value = row.querySelector('.extra-env-value').value.trim();
    if (key) {
      env[key] = value;
    }
  }

  const profile = {
    id: '',
    name: name,
    effort: document.getElementById('effort').value,
    env: env,
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
  if (!baseURL) {
    setStatus(document.body.dataset.baseUrlRequired || 'Please enter Base URL before fetching models', 'error');
    return;
  }

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
    case 'modelsFetched': {
      const models = Array.isArray(message.models) ? message.models : [];
      populateModelSelects(models);
      setStatus(formatTemplate(document.body.dataset.fetchSuccess || 'Fetched {0} models', models.length), 'success');
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
    const model = getModelValueFromInput(modelInput);
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

function populateModelSelects(models) {
  for (const select of searchableSelects) {
    const target = document.getElementById(select.dataset.target);
    const currentValue = getModelValueFromInput(target);
    const list = select.querySelector('.searchable-select-list');
    const searchInput = select.querySelector('.searchable-select-search');
    const emptyMsg = select.querySelector('.searchable-select-empty');
    const displayInput = select.querySelector('.searchable-select-input');

    // Populate list
    list.innerHTML = '';
    for (const model of models) {
      const item = document.createElement('div');
      item.className = 'searchable-select-item';
      item.dataset.value = model;
      const span = document.createElement('span');
      span.className = 'item-text';
      span.textContent = model;
      item.appendChild(span);
      item.title = model;
      if (model === currentValue) {
        item.classList.add('selected');
        displayInput.value = model;
      }
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        displayInput.value = this.dataset.value;
        target.value = this.dataset.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        select.classList.remove('open');
        // Update selected state
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
        const text = item.querySelector('.item-text')?.textContent || item.dataset.value || '';
        const match = text.toLowerCase().includes(query);
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
