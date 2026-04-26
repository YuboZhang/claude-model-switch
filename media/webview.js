const vscode = acquireVsCodeApi();

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
  const model = document.getElementById('model').value;
  let name = document.getElementById('name').value.trim();
  if (!name) {
    name = model || 'Unnamed';
  }

  const profile = {
    id: '',
    name: name,
    model: model,
    env: {
      ANTHROPIC_AUTH_TOKEN: document.getElementById('ANTHROPIC_AUTH_TOKEN').value,
      ANTHROPIC_BASE_URL: document.getElementById('ANTHROPIC_BASE_URL').value,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: document.getElementById('ANTHROPIC_DEFAULT_HAIKU_MODEL').value,
      ANTHROPIC_DEFAULT_OPUS_MODEL: document.getElementById('ANTHROPIC_DEFAULT_OPUS_MODEL').value,
      ANTHROPIC_DEFAULT_SONNET_MODEL: document.getElementById('ANTHROPIC_DEFAULT_SONNET_MODEL').value,
      ANTHROPIC_MODEL: document.getElementById('ANTHROPIC_MODEL').value,
    }
  };

  vscode.postMessage({ type: 'save', profile });
});

// Cancel
document.getElementById('cancelBtn').addEventListener('click', function() {
  vscode.postMessage({ type: 'cancel' });
});

// Auto-fill name from model if name is empty
document.getElementById('model').addEventListener('input', function() {
  const nameInput = document.getElementById('name');
  if (!nameInput.value.trim()) {
    nameInput.value = this.value;
  }
});