/**
 * MoVo Access Timeline Script - Archive Register Design
 * Safe DOM rendering: strictly uses textContent for all user-provided data (email, reason, ip, filename).
 */

let currentShareId = null;

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  if (UI.initNotifications) {
    UI.initNotifications();
  }
  const urlParams = new URLSearchParams(window.location.search);
  currentShareId = urlParams.get('share');

  if (!currentShareId) {
    window.location.href = '/history.html';
    return;
  }

  const btnRefresh = document.getElementById('btn-refresh-logs');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadTimeline();
    });
  }

  loadTimeline();
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
    // Handled in api.js
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

async function loadTimeline() {
  try {
    // 1. Fetch share metadata
    const share = await api.get(`/api/shares/${currentShareId}`);
    renderShareHeader(share);

    // 2. Fetch logs (newest first)
    const logs = await api.get(`/api/shares/${currentShareId}/logs`);
    renderLogs(logs || []);
  } catch (err) {
    console.error('Failed to load timeline:', err);
    UI.showToast(err.message || 'Failed to load access logs', 'error');
  }
}

function renderShareHeader(share) {
  if (!share) return;

  const fileName = document.getElementById('share-file-name');
  const created = document.getElementById('share-created');
  const expires = document.getElementById('share-expires');
  const downloads = document.getElementById('share-downloads');
  const statusContainer = document.getElementById('share-status-container');

  if (fileName) fileName.textContent = share.fileName || 'Shared Record';
  if (created) created.textContent = `Created: ${UI.formatDate(share.createdAt)}`;
  if (expires) expires.textContent = `Expires: ${UI.formatDate(share.expiresAt)}`;
  if (downloads) {
    downloads.textContent = `Downloads: ${share.downloadCount} / ${share.maxDownloads !== null && share.maxDownloads !== undefined ? share.maxDownloads : '∞'}`;
  }

  if (statusContainer) {
    statusContainer.innerHTML = '';
    statusContainer.appendChild(UI.createStatusBadge(share.status));
  }
}

function renderLogs(logs) {
  const container = document.getElementById('timeline-container');
  const emptyState = document.getElementById('timeline-empty-state');
  const countBadge = document.getElementById('log-count-badge');

  if (!container || !emptyState) return;

  container.innerHTML = '';

  if (countBadge) {
    countBadge.textContent = `${logs.length} ${logs.length === 1 ? 'event' : 'events'}`;
  }

  if (!logs || logs.length === 0) {
    container.classList.add('hidden');
    emptyState.classList.remove('hidden');
    UI.renderEmptyState(
      emptyState,
      'No Access Activity',
      'No access or verification attempts have been recorded for this share.'
    );
    return;
  }

  container.classList.remove('hidden');
  emptyState.classList.add('hidden');

  for (const log of logs) {
    const isSuccess = log.success === 1;

    // Timeline Ledger Row Card
    const row = document.createElement('div');
    row.className = `p-3 sm:p-4 rounded-sm border ${
      isSuccess
        ? 'bg-[var(--bg-surface)] border-[var(--status-active-border)]'
        : 'bg-[var(--bg-surface-subtle)] border-[var(--status-revoked-border)]'
    } space-y-2`;

    // Header Row: Status badge + Reason + Timestamp
    const topRow = document.createElement('div');
    topRow.className = 'flex flex-wrap items-center justify-between gap-2';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'flex items-center gap-2 font-mono text-xs';

    const resultBadge = document.createElement('span');
    resultBadge.className = `badge-status ${isSuccess ? 'badge-status-active' : 'badge-status-revoked'}`;
    resultBadge.textContent = isSuccess ? 'GRANTED (200)' : 'BLOCKED (404)';

    const reasonSpan = document.createElement('span');
    reasonSpan.className = 'text-[11px] font-mono text-[var(--text-muted)]';
    reasonSpan.textContent = `[ Reason: ${log.reason || (isSuccess ? 'OK' : 'DENIED')} ]`;

    leftGroup.appendChild(resultBadge);
    leftGroup.appendChild(reasonSpan);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-[11px] font-mono text-[var(--text-dim)]';
    timeSpan.textContent = `${UI.formatDate(log.at)} (${UI.formatRelativeTime(log.at)})`;

    topRow.appendChild(leftGroup);
    topRow.appendChild(timeSpan);

    // Metadata details row: Visitor email & IP
    const metaRow = document.createElement('div');
    metaRow.className = 'flex flex-wrap items-center gap-4 text-xs font-mono text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]';

    const emailItem = document.createElement('div');
    emailItem.textContent = `Visitor: ${log.email || (isSuccess ? 'Public' : 'Unspecified')}`;

    const ipItem = document.createElement('div');
    ipItem.textContent = `IP: ${log.ip || 'Unknown'}`;

    metaRow.appendChild(emailItem);
    metaRow.appendChild(ipItem);

    row.appendChild(topRow);
    row.appendChild(metaRow);
    container.appendChild(row);
  }
}
