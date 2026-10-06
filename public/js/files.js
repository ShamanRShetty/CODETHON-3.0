/**
 * MoVo Files & Share Manager - Archive Register Design
 * Secure DOM manipulation: strictly utilizes textContent and standard DOM methods for user content.
 */

let currentSelectedFile = null;
let recipientEmails = [];
let selectedExpiryMinutes = 60; // default 1 hour

// Initialize DOM elements when ready
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  if (UI.initNotifications) {
    UI.initNotifications();
  }
  initUpload();
  initShareModal();
  initCreatedShareModal();
  loadFiles();
});

async function initAuth() {
  const userDisplayName = document.getElementById('user-display-name');
  const btnLogout = document.getElementById('btn-logout');

  try {
    const user = await api.get('/api/auth/me');
    if (userDisplayName) {
      userDisplayName.textContent = user.name || user.email;
    }
  } catch (err) {
    // Redirection handled in api.js
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await api.post('/api/auth/logout');
      } finally {
        window.location.href = '/index.html';
      }
    });
  }
}

async function loadFiles() {
  const filesTableBody = document.getElementById('files-table-body');
  const filesEmptyState = document.getElementById('files-empty-state');
  const filesCountBadge = document.getElementById('files-count-badge');

  if (!filesTableBody) return;

  try {
    const files = await api.get('/api/files');
    renderFiles(files || []);
  } catch (err) {
    console.error('Failed to load files:', err);
    UI.showToast(err.message || 'Failed to load files', 'error');
    renderFiles([]);
  }
}

function renderFiles(files) {
  const filesTableBody = document.getElementById('files-table-body');
  const filesEmptyState = document.getElementById('files-empty-state');
  const filesCountBadge = document.getElementById('files-count-badge');

  if (filesCountBadge) {
    filesCountBadge.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
  }

  filesTableBody.innerHTML = '';

  if (!files || files.length === 0) {
    if (filesEmptyState) {
      filesEmptyState.classList.remove('hidden');
      UI.renderEmptyState(
        filesEmptyState,
        'No Records Uploaded',
        'Upload a file above to create encrypted, identity-verified share links.'
      );
    }
    return;
  }

  if (filesEmptyState) {
    filesEmptyState.classList.add('hidden');
  }

  files.forEach((file) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-[var(--bg-surface-hover)] transition-colors';

    // File name cell
    const tdName = document.createElement('td');
    tdName.className = 'px-4 py-3 font-medium text-[var(--text-main)]';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'truncate max-w-xs sm:max-w-md block';
    nameSpan.textContent = file.originalName || file.name || 'Unnamed file';
    tdName.appendChild(nameSpan);

    // Size cell
    const tdSize = document.createElement('td');
    tdSize.className = 'px-4 py-3 text-[var(--text-muted)] font-mono text-[11px] whitespace-nowrap';
    tdSize.textContent = UI.formatBytes(file.size);

    // Uploaded timestamp cell
    const tdUploaded = document.createElement('td');
    tdUploaded.className = 'px-4 py-3 text-[var(--text-dim)] font-mono text-[11px] whitespace-nowrap';
    tdUploaded.textContent = UI.formatDate(file.uploadedAt || file.uploaded_at);

    // Active shares cell
    const tdShares = document.createElement('td');
    tdShares.className = 'px-4 py-3 whitespace-nowrap font-mono text-[11px]';
    const shareCount = file.shareCount || 0;
    const shareBadge = document.createElement('span');
    shareBadge.className = shareCount > 0 ? 'badge-status badge-status-active' : 'badge-status badge-status-expired';
    shareBadge.textContent = `${shareCount} active`;
    tdShares.appendChild(shareBadge);

    // Actions cell
    const tdActions = document.createElement('td');
    tdActions.className = 'px-4 py-3 text-right space-x-1.5 whitespace-nowrap';

    const btnShare = document.createElement('button');
    btnShare.className = 'btn-ledger-primary py-1 px-2.5 text-[11px] font-mono';
    btnShare.textContent = 'Share';
    btnShare.onclick = () => openShareModal(file);

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-ledger-danger py-1 px-2.5 text-[11px] font-mono';
    btnDelete.textContent = 'Delete';
    btnDelete.onclick = () => confirmDeleteFile(file);

    tdActions.appendChild(btnShare);
    tdActions.appendChild(btnDelete);

    tr.appendChild(tdName);
    tr.appendChild(tdSize);
    tr.appendChild(tdUploaded);
    tr.appendChild(tdShares);
    tr.appendChild(tdActions);

    filesTableBody.appendChild(tr);
  });
}

function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Drag and drop handlers
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = 'var(--border-strong)';
      dropZone.style.backgroundColor = 'var(--bg-surface-hover)';
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = '';
      dropZone.style.backgroundColor = '';
    });
  });

  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
}

async function handleFileUpload(file) {
  const maxBytes = 25 * 1024 * 1024; // 25 MB
  if (file.size > maxBytes) {
    UI.showToast('File size exceeds maximum allowed limit of 25 MB', 'error');
    return;
  }

  UI.showToast(`Encrypting "${file.name}" (AES-256-GCM)...`, 'info');

  const formData = new FormData();
  formData.append('file', file);

  try {
    await api.upload('/api/files', formData);
    UI.showToast(`"${file.name}" uploaded and encrypted successfully`, 'success');
    loadFiles();
  } catch (err) {
    UI.showToast(err.message || 'Upload failed', 'error');
  }
}

async function confirmDeleteFile(file) {
  const confirmed = confirm(
    `Delete "${file.originalName || 'this file'}"?\n\nThis will remove the encrypted file and revoke all active share links immediately.`
  );

  if (!confirmed) return;

  try {
    await api.delete(`/api/files/${file.id}`);
    UI.showToast('File deleted and shares revoked', 'success');
    loadFiles();
  } catch (err) {
    UI.showToast(err.message || 'Failed to delete file', 'error');
  }
}

function initShareModal() {
  const shareModal = document.getElementById('share-modal');
  const btnCloseModal = document.getElementById('btn-close-share-modal');
  const btnCancelShare = document.getElementById('btn-cancel-share');
  const formShare = document.getElementById('form-share');
  const presetButtons = document.querySelectorAll('.expiry-preset-btn');
  const customExpiryInput = document.getElementById('custom-expiry-minutes');
  const customExpiryContainer = document.getElementById('custom-expiry-container');
  const emailInput = document.getElementById('recipient-email-input');
  const btnAddRecipient = document.getElementById('btn-add-recipient');

  if (!shareModal) return;

  const closeModal = () => {
    shareModal.classList.add('hidden');
    currentSelectedFile = null;
    recipientEmails = [];
    formShare.reset();
  };

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelShare) btnCancelShare.addEventListener('click', closeModal);

  // Expiry preset buttons (10 min, 1 h, 24 h, custom)
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => {
        b.className = 'expiry-preset-btn py-1.5 px-2 rounded-sm ledger-border bg-[var(--bg-surface)] text-[var(--text-muted)]';
      });

      btn.className = 'expiry-preset-btn py-1.5 px-2 rounded-sm border border-[var(--border-strong)] bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold';

      const val = btn.getAttribute('data-minutes');
      if (val === 'custom') {
        customExpiryContainer.classList.remove('hidden');
        selectedExpiryMinutes = parseInt(customExpiryInput.value, 10) || 60;
      } else {
        customExpiryContainer.classList.add('hidden');
        selectedExpiryMinutes = parseInt(val, 10);
      }
    });
  });

  if (customExpiryInput) {
    customExpiryInput.addEventListener('input', () => {
      selectedExpiryMinutes = parseInt(customExpiryInput.value, 10) || 60;
    });
  }

  // Recipient email chips
  function addRecipientFromInput() {
    const val = (emailInput.value || '').trim().toLowerCase();
    if (!val) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(val)) {
      UI.showToast('Please enter a valid email address', 'error');
      return;
    }

    if (recipientEmails.includes(val)) {
      emailInput.value = '';
      return;
    }

    recipientEmails.push(val);
    emailInput.value = '';
    renderRecipientChips();
  }

  if (btnAddRecipient) {
    btnAddRecipient.addEventListener('click', (e) => {
      e.preventDefault();
      addRecipientFromInput();
    });
  }

  if (emailInput) {
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addRecipientFromInput();
      }
    });
  }

  // Form Submission
  if (formShare) {
    formShare.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentSelectedFile) return;

      // Auto-add any recipient email still in the input field
      addRecipientFromInput();

      const passwordVal = document.getElementById('share-password').value.trim();
      const maxDownloadsVal = parseInt(
        document.getElementById('share-max-downloads').value,
        10
      );

      const payload = {
        expiresInMinutes: selectedExpiryMinutes,
        recipients: recipientEmails.length > 0 ? recipientEmails : undefined,
        password: passwordVal || undefined,
        maxDownloads: !isNaN(maxDownloadsVal) && maxDownloadsVal > 0 ? maxDownloadsVal : undefined,
      };

      try {
        const fileId = currentSelectedFile.id;
        const fileName = currentSelectedFile.originalName || currentSelectedFile.name || 'File';
        const res = await api.post(`/api/files/${fileId}/shares`, payload);
        closeModal();
        showCreatedShareModal({
          link: res.link,
          token: res.token,
          fileName,
        });
        loadFiles();
      } catch (err) {
        UI.showToast(err.message || 'Failed to create share', 'error');
      }
    });
  }
}

function openShareModal(file) {
  currentSelectedFile = file;
  recipientEmails = [];
  selectedExpiryMinutes = 60;

  const shareModal = document.getElementById('share-modal');
  const targetFileName = document.getElementById('share-target-file-name');
  const customExpiryContainer = document.getElementById('custom-expiry-container');
  const presetButtons = document.querySelectorAll('.expiry-preset-btn');

  if (targetFileName) {
    targetFileName.textContent = file.originalName || file.name || 'Selected file';
  }

  // Reset preset button states to 1 Hour default
  presetButtons.forEach((b) => {
    if (b.getAttribute('data-minutes') === '60') {
      b.className = 'expiry-preset-btn py-1.5 px-2 rounded-sm border border-[var(--border-strong)] bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold';
    } else {
      b.className = 'expiry-preset-btn py-1.5 px-2 rounded-sm ledger-border bg-[var(--bg-surface)] text-[var(--text-muted)]';
    }
  });

  if (customExpiryContainer) customExpiryContainer.classList.add('hidden');
  renderRecipientChips();

  if (shareModal) shareModal.classList.remove('hidden');
}

function renderRecipientChips() {
  const container = document.getElementById('recipient-chips-container');
  if (!container) return;

  container.innerHTML = '';
  recipientEmails.forEach((email, index) => {
    const chip = document.createElement('span');
    chip.className =
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-mono bg-[var(--bg-surface-subtle)] text-[var(--text-main)] border border-[var(--border-color)]';

    const text = document.createElement('span');
    text.textContent = email;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'text-[var(--text-dim)] hover:text-[var(--status-revoked-text)] font-bold ml-1 transition-colors';
    removeBtn.textContent = '✕';
    removeBtn.onclick = () => {
      recipientEmails.splice(index, 1);
      renderRecipientChips();
    };

    chip.appendChild(text);
    chip.appendChild(removeBtn);
    container.appendChild(chip);
  });
}

function initCreatedShareModal() {
  const modal = document.getElementById('created-share-modal');
  const btnClose = document.getElementById('btn-close-created-modal');
  const btnDone = document.getElementById('btn-done-created');
  const btnCopy = document.getElementById('btn-copy-link');

  const close = () => {
    if (modal) modal.classList.add('hidden');
  };

  if (btnClose) btnClose.addEventListener('click', close);
  if (btnDone) btnDone.addEventListener('click', close);

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const linkInput = document.getElementById('created-share-link-input');
      if (linkInput && linkInput.value) {
        navigator.clipboard.writeText(linkInput.value).then(() => {
          UI.showToast('Share link copied to clipboard', 'success');
        });
      }
    });
  }
}

function showCreatedShareModal({ link, token, fileName }) {
  const modal = document.getElementById('created-share-modal');
  const linkInput = document.getElementById('created-share-link-input');
  const targetFileName = document.getElementById('created-target-file-name');

  if (linkInput) linkInput.value = link;
  if (targetFileName) targetFileName.textContent = fileName || 'File';
  if (modal) modal.classList.remove('hidden');
}
