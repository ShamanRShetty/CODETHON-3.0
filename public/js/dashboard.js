/**
 * MoVo Dashboard Script - Archive Register Design
 * Safe DOM rendering: strictly utilizes textContent for all user/dynamic fields.
 */

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  if (UI.initNotifications) {
    UI.initNotifications();
  }
  loadDashboard();
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

async function loadDashboard() {
  try {
    const data = await api.get('/api/dashboard');
    renderMetrics(data);
    renderRecentActivity(data.recentActivity || []);
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    UI.showToast(err.message || 'Failed to load dashboard metrics', 'error');
  }
}

function renderMetrics(data) {
  if (!data) return;

  const elStorage = document.getElementById('stat-storage');
  const elFiles = document.getElementById('stat-files');
  const elTotalShares = document.getElementById('stat-total-shares');

  const elActive = document.getElementById('status-active-count');
  const elExpired = document.getElementById('status-expired-count');
  const elRevoked = document.getElementById('status-revoked-count');
  const elLimit = document.getElementById('status-limit-count');

  if (elStorage) elStorage.textContent = UI.formatBytes(data.storageBytes);
  if (elFiles) elFiles.textContent = (data.fileCount || 0).toLocaleString();

  const statuses = data.sharesByStatus || {};
  const activeCount = statuses.ACTIVE || 0;
  const expiredCount = statuses.EXPIRED || 0;
  const revokedCount = statuses.REVOKED || 0;
  const limitCount = statuses.LIMIT_REACHED || 0;
  const totalShares = activeCount + expiredCount + revokedCount + limitCount;

  if (elTotalShares) elTotalShares.textContent = totalShares.toLocaleString();
  if (elActive) elActive.textContent = activeCount.toLocaleString();
  if (elExpired) elExpired.textContent = expiredCount.toLocaleString();
  if (elRevoked) elRevoked.textContent = revokedCount.toLocaleString();
  if (elLimit) elLimit.textContent = limitCount.toLocaleString();

  // Pure CSS Status Bar Segments
  const segActive = document.getElementById('bar-segment-active');
  const segExpired = document.getElementById('bar-segment-expired');
  const segRevoked = document.getElementById('bar-segment-revoked');
  const segLimit = document.getElementById('bar-segment-limit');

  if (totalShares > 0) {
    const pActive = (activeCount / totalShares) * 100;
    const pExpired = (expiredCount / totalShares) * 100;
    const pRevoked = (revokedCount / totalShares) * 100;
    const pLimit = (limitCount / totalShares) * 100;

    if (segActive) segActive.style.width = `${pActive}%`;
    if (segExpired) segExpired.style.width = `${pExpired}%`;
    if (segRevoked) segRevoked.style.width = `${pRevoked}%`;
    if (segLimit) segLimit.style.width = `${pLimit}%`;
  } else {
    if (segActive) segActive.style.width = '0%';
    if (segExpired) segExpired.style.width = '0%';
    if (segRevoked) segRevoked.style.width = '0%';
    if (segLimit) segLimit.style.width = '0%';
  }
}

function renderRecentActivity(activities) {
  const tbody = document.getElementById('activity-table-body');
  const emptyState = document.getElementById('activity-empty-state');

  if (!tbody || !emptyState) return;

  tbody.innerHTML = '';

  if (!activities || activities.length === 0) {
    tbody.classList.add('hidden');
    emptyState.classList.remove('hidden');
    UI.renderEmptyState(
      emptyState,
      'No Recent Activity Recorded',
      'Access attempts and file downloads across your shares will appear in this ledger.'
    );
    return;
  }

  tbody.classList.remove('hidden');
  emptyState.classList.add('hidden');

  for (const act of activities) {
    const isSuccess = act.success === 1;
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-[var(--bg-surface-hover)] transition-colors';

    tr.addEventListener('click', () => {
      if (act.shareId) {
        window.location.href = `/timeline.html?share=${act.shareId}`;
      }
    });

    // 1. File Name
    const tdFile = document.createElement('td');
    tdFile.className = 'px-4 py-3 whitespace-nowrap font-medium text-[var(--text-main)]';
    tdFile.textContent = act.fileName || 'Untitled File';

    // 2. Reason / Result Badge
    const tdResult = document.createElement('td');
    tdResult.className = 'px-4 py-3 whitespace-nowrap font-mono text-xs';
    const badge = document.createElement('span');
    badge.className = `badge-status ${isSuccess ? 'badge-status-active' : 'badge-status-revoked'}`;
    badge.textContent = act.reason || (isSuccess ? 'OK' : 'BLOCKED');
    tdResult.appendChild(badge);

    // 3. Recipient Email
    const tdEmail = document.createElement('td');
    tdEmail.className = 'px-4 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-muted)]';
    tdEmail.textContent = act.userEmail || (isSuccess ? 'Public Visitor' : 'Unspecified');

    // 4. IP Address
    const tdIp = document.createElement('td');
    tdIp.className = 'px-4 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-dim)]';
    tdIp.textContent = act.ip || '-';

    // 5. Timestamp
    const tdTime = document.createElement('td');
    tdTime.className = 'px-4 py-3 whitespace-nowrap text-right font-mono text-[11px] text-[var(--text-dim)]';
    tdTime.textContent = `${UI.formatDate(act.at)} (${UI.formatRelativeTime(act.at)})`;

    tr.appendChild(tdFile);
    tr.appendChild(tdResult);
    tr.appendChild(tdEmail);
    tr.appendChild(tdIp);
    tr.appendChild(tdTime);

    tbody.appendChild(tr);
  }
}
