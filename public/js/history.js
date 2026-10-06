/**
 * VaultLink Share History Manager
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
    // End of selected day
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
      'No Share Links Found',
      'No share links match your filter criteria or you have not created any shares yet.'
    );
    return;
  }

  tbody.classList.remove('hidden');
  emptyState.classList.add('hidden');

  for (const share of shares) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40 cursor-pointer transition-colors group';

    // Clicking anywhere on row opens timeline
    tr.addEventListener('click', (e) => {
      // Don't trigger if clicked on a button or action element
      if (e.target.closest('button') || e.target.closest('a')) return;
      window.location.href = `/timeline.html?share=${share.id}`;
    });

    // 1. File Name
    const tdName = document.createElement('td');
    tdName.className = 'px-6 py-4 whitespace-nowrap';
    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'flex items-center gap-2.5';
    nameWrapper.innerHTML = `
      <div class="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      </div>
    `;
    const nameText = document.createElement('span');
    nameText.className = 'font-medium text-slate-200 group-hover:text-cyan-400 transition-colors';
    nameText.textContent = share.fileName || 'Untitled File';
    nameWrapper.appendChild(nameText);
    tdName.appendChild(nameWrapper);

    // 2. Status Badge
    const tdStatus = document.createElement('td');
    tdStatus.className = 'px-6 py-4 whitespace-nowrap';
    tdStatus.appendChild(UI.createStatusBadge(share.status));

    // 3. Recipients
    const tdRecipients = document.createElement('td');
    tdRecipients.className = 'px-6 py-4 whitespace-nowrap text-slate-300';
    if (share.recipients && share.recipients.length > 0) {
      const recSpan = document.createElement('span');
      recSpan.className = 'inline-flex items-center gap-1 text-slate-300';
      recSpan.textContent =
        share.recipients.length === 1
          ? share.recipients[0]
          : `${share.recipients[0]} +${share.recipients.length - 1} more`;
      recSpan.title = share.recipients.join(', ');
      tdRecipients.appendChild(recSpan);
    } else {
      const openSpan = document.createElement('span');
      openSpan.className = 'text-slate-500 italic';
      openSpan.textContent = 'Open (Anyone with link)';
      tdRecipients.appendChild(openSpan);
    }

    // 4. Downloads
    const tdDownloads = document.createElement('td');
    tdDownloads.className = 'px-6 py-4 whitespace-nowrap text-slate-300 font-mono';
    tdDownloads.textContent = `${share.downloadCount} / ${share.maxDownloads !== null && share.maxDownloads !== undefined ? share.maxDownloads : '∞'}`;

    // 5. Expiry
    const tdExpires = document.createElement('td');
    tdExpires.className = 'px-6 py-4 whitespace-nowrap text-slate-400';
    tdExpires.textContent = UI.formatDate(share.expiresAt);

    // 6. Created
    const tdCreated = document.createElement('td');
    tdCreated.className = 'px-6 py-4 whitespace-nowrap text-slate-400';
    tdCreated.textContent = UI.formatDate(share.createdAt);

    // 7. Actions
    const tdActions = document.createElement('td');
    tdActions.className = 'px-6 py-4 whitespace-nowrap text-right space-x-2';

    // Timeline button
    const btnTimeline = document.createElement('a');
    btnTimeline.href = `/timeline.html?share=${share.id}`;
    btnTimeline.className =
      'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors';
    btnTimeline.innerHTML = `
      <svg class="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      Timeline
    `;
    tdActions.appendChild(btnTimeline);

    // Revoke button
    if (share.status !== 'REVOKED') {
      const btnRevoke = document.createElement('button');
      btnRevoke.type = 'button';
      btnRevoke.className =
        'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-colors';
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
        btnConfirm.textContent = 'Yes, Revoke Link';
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
