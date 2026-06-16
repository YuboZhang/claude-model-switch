const vscode = acquireVsCodeApi();
const modelSelects = Array.from(document.querySelectorAll('.model-select'));
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

for (const targetId of oneMillionContextTargets) {
  const input = document.getElementById(targetId);
  const checkbox = document.getElementById(`${targetId}_ONE_MILLION_CONTEXT`);
  const parsed = parseOneMillionContextModel(input?.value || '');
  if (input) input.value = parsed.model;
  if (checkbox) checkbox.checked = checkbox.checked || parsed.supportsOneMillionContext;
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

  const profile = {
    id: '',
    name: name,
    effort: document.getElementById('effort').value,
    env: {
      ANTHROPIC_AUTH_TOKEN: document.getElementById('ANTHROPIC_AUTH_TOKEN').value,
      ANTHROPIC_BASE_URL: document.getElementById('ANTHROPIC_BASE_URL').value,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: getModelValue('ANTHROPIC_DEFAULT_HAIKU_MODEL'),
      ANTHROPIC_DEFAULT_SONNET_MODEL: getModelValueForSave('ANTHROPIC_DEFAULT_SONNET_MODEL'),
      ANTHROPIC_DEFAULT_OPUS_MODEL: getModelValueForSave('ANTHROPIC_DEFAULT_OPUS_MODEL'),
      ANTHROPIC_MODEL: getModelValueForSave('ANTHROPIC_MODEL'),
    }
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
      if (message.status === 'success') {
        const modelText = requestedModel || returnedModel;
        const returnedText = returnedModel && returnedModel !== requestedModel ? ` → ${returnedModel}` : '';
        setStatus(`${message.durationMs}ms ${modelText}${returnedText}`.trim(), 'success');
      } else {
        const error = message.error || 'Speed test failed';
        const modelText = requestedModel ? `${requestedModel}: ` : '';
        setStatus(`${modelText}${error} (${message.durationMs}ms)`, 'error');
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
    pendingModelSpeedTests.set(requestId, { button: this, model });
    this.disabled = true;
    this.classList.add('loading');
    setStatus(model ? `${this.textContent}: ${model}` : this.textContent, 'loading');

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

for (const select of modelSelects) {
  select.addEventListener('change', function() {
    if (!this.value) return;
    const target = document.getElementById(this.dataset.target);
    if (!target) return;
    target.value = this.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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
  const placeholder = document.body.dataset.selectPlaceholder || 'Select model';
  for (const select of modelSelects) {
    const target = document.getElementById(select.dataset.target);
    const currentValue = getModelValueFromInput(target);
    select.replaceChildren(createOption('', placeholder));

    for (const model of models) {
      select.appendChild(createOption(model, model));
    }

    select.value = models.includes(currentValue) ? currentValue : '';
  }
}

function createOption(value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  return option;
}

function setStatus(text, type) {
  modelsStatus.textContent = text;
  modelsStatus.className = `models-status ${type}`;
}

function formatTemplate(template, value) {
  return template.replace('{0}', String(value));
}
