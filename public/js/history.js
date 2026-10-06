/**
 * MoVo Share History Script - Archive Register Design
 * Safe DOM rendering: strictly uses textContent and safe DOM elements for all user data.
 */

let pendingRevokeShareId = null;

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  if (UI.initNotifications) {
    UI.initNotifications();
  }
  initFilters();
  initRevokeModal();
  loadShares();
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

function initFilters() {
  const inputQ = document.getElementById('filter-q');
  const selectStatus = document.getElementById('filter-status');
  const selectSort = document.getElementById('filter-sort');
  const selectOrder = document.getElementById('filter-order');
  const inputFrom = document.getElementById('filter-from');
  const inputTo = document.getElementById('filter-to');
  const btnReset = document.getElementById('btn-reset-filters');

  let debounceTimer;
  if (inputQ) {
    inputQ.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadShares(), 300);
    });
  }

  if (selectStatus) selectStatus.addEventListener('change', () => loadShares());
  if (selectSort) selectSort.addEventListener('change', () => loadShares());
  if (selectOrder) selectOrder.addEventListener('change', () => loadShares());
  if (inputFrom) inputFrom.addEventListener('change', () => loadShares());
  if (inputTo) inputTo.addEventListener('change', () => loadShares());

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (inputQ) inputQ.value = '';
      if (selectStatus) selectStatus.value = '';
      if (selectSort) selectSort.value = 'created';
      if (selectOrder) selectOrder.value = 'desc';
      if (inputFrom) inputFrom.value = '';
      if (inputTo) inputTo.value = '';
      loadShares();
    });
  }
}

async function loadShares() {
  const tbody = document.getElementById('shares-table-body');
  const emptyState = document.getElementById('shares-empty-state');
  if (!tbody) return;

  const params = new URLSearchParams();

  const q = document.getElementById('filter-q')?.value?.trim();
  if (q) params.set('q', q);

  const status = document.getElementById('filter-status')?.value;
  if (status) params.set('status', status);

  const sort = document.getElementById('filter-sort')?.value || 'created';
  params.set('sort', sort);

  const order = document.getElementById('filter-order')?.value || 'desc';
  params.set('order', order);

  const fromVal = document.getElementById('filter-from')?.value;
  if (fromVal) {
    const fromMs = new Date(fromVal).getTime();
    if (!isNaN(fromMs)) params.set('from', fromMs);
  }

  const toVal = document.getElementById('filter-to')?.value;
  if (toVal) {
    const toMs = new Date(toVal).getTime() + 24 * 60 * 60 * 1000 - 1;
    if (!isNaN(toMs)) params.set('to', toMs);
  }

  try {
    const shares = await api.get(`/api/shares?${params.toString()}`);
    renderShares(shares || []);
  } catch (err) {
    console.error('Failed to load shares:', err);
    UI.showToast(err.message || 'Failed to load shares', 'error');
    renderShares([]);
  }
}

function renderShares(shares) {
  const tbody = document.getElementById('shares-table-body');
  const emptyState = document.getElementById('shares-empty-state');
  if (!tbody || !emptyState) return;

  tbody.innerHTML = '';

  if (!shares || shares.length === 0) {
    tbody.classList.add('hidden');
    emptyState.classList.remove('hidden');
    UI.renderEmptyState(
      emptyState,
      'No Records Found',
      'No share links match the active filters or no shares have been issued.'
    );
    return;
  }

  tbody.classList.remove('hidden');
  emptyState.classList.add('hidden');

  for (const share of shares) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-[var(--bg-surface-hover)] transition-colors';

    // Row click opens timeline
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      window.location.href = `/timeline.html?share=${share.id}`;
    });

    // 1. File Name
    const tdName = document.createElement('td');
    tdName.className = 'px-4 py-3 whitespace-nowrap font-medium text-[var(--text-main)]';
    const nameText = document.createElement('span');
    nameText.className = 'hover:underline underline-offset-2';
    nameText.textContent = share.fileName || 'Untitled File';
    tdName.appendChild(nameText);

    // 2. Status Badge
    const tdStatus = document.createElement('td');
    tdStatus.className = 'px-4 py-3 whitespace-nowrap';
    tdStatus.appendChild(UI.createStatusBadge(share.status));

    // 3. Recipients
    const tdRecipients = document.createElement('td');
    tdRecipients.className = 'px-4 py-3 whitespace-nowrap text-[var(--text-muted)] font-mono text-[11px]';
    if (share.recipients && share.recipients.length > 0) {
      const recSpan = document.createElement('span');
      recSpan.textContent =
        share.recipients.length === 1
          ? share.recipients[0]
          : `${share.recipients[0]} (+${share.recipients.length - 1})`;
      recSpan.title = share.recipients.join(', ');
      tdRecipients.appendChild(recSpan);
    } else {
      const openSpan = document.createElement('span');
      openSpan.className = 'text-[var(--text-dim)] italic';
      openSpan.textContent = 'Open link';
      tdRecipients.appendChild(openSpan);
    }

    // 4. Downloads
    const tdDownloads = document.createElement('td');
    tdDownloads.className = 'px-4 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-main)]';
    tdDownloads.textContent = `${share.downloadCount} / ${share.maxDownloads !== null && share.maxDownloads !== undefined ? share.maxDownloads : '∞'}`;

    // 5. Expiry
    const tdExpires = document.createElement('td');
    tdExpires.className = 'px-4 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-muted)]';
    tdExpires.textContent = UI.formatDate(share.expiresAt);

    // 6. Created
    const tdCreated = document.createElement('td');
    tdCreated.className = 'px-4 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-dim)]';
    tdCreated.textContent = UI.formatDate(share.createdAt);

    // 7. Actions
    const tdActions = document.createElement('td');
    tdActions.className = 'px-4 py-3 whitespace-nowrap text-right space-x-1.5';

    // Timeline button
    const btnTimeline = document.createElement('a');
    btnTimeline.href = `/timeline.html?share=${share.id}`;
    btnTimeline.className = 'btn-ledger-secondary py-1 px-2 text-[11px] font-mono';
    btnTimeline.textContent = 'Timeline';
    tdActions.appendChild(btnTimeline);

    // Revoke button
    if (share.status !== 'REVOKED') {
      const btnRevoke = document.createElement('button');
      btnRevoke.type = 'button';
      btnRevoke.className = 'btn-ledger-danger py-1 px-2 text-[11px] font-mono';
      btnRevoke.textContent = 'Revoke';
      btnRevoke.addEventListener('click', (e) => {
        e.stopPropagation();
        openRevokeModal(share.id);
      });
      tdActions.appendChild(btnRevoke);
    }

    tr.appendChild(tdName);
    tr.appendChild(tdStatus);
    tr.appendChild(tdRecipients);
    tr.appendChild(tdDownloads);
    tr.appendChild(tdExpires);
    tr.appendChild(tdCreated);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  }
}

function initRevokeModal() {
  const modal = document.getElementById('revoke-modal');
  const btnCancel = document.getElementById('btn-cancel-revoke');
  const btnConfirm = document.getElementById('btn-confirm-revoke');

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      closeRevokeModal();
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      if (!pendingRevokeShareId) return;
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Revoking...';

      try {
        await api.post(`/api/shares/${pendingRevokeShareId}/revoke`);
        UI.showToast('Share link revoked successfully', 'success');
        closeRevokeModal();
        loadShares();
      } catch (err) {
        console.error('Failed to revoke share:', err);
        UI.showToast(err.message || 'Failed to revoke share', 'error');
      } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Confirm Revocation';
      }
    });
  }
}

function openRevokeModal(shareId) {
  pendingRevokeShareId = shareId;
  const modal = document.getElementById('revoke-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeRevokeModal() {
  pendingRevokeShareId = null;
  const modal = document.getElementById('revoke-modal');
  if (modal) modal.classList.add('hidden');
}
