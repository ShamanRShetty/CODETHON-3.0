/**
 * MoVo Dashboard Script
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
      'No Recent Activity',
      'Access attempts and file downloads across your shares will appear here.'
    );
    return;
  }

  tbody.classList.remove('hidden');
  emptyState.classList.add('hidden');

  for (const act of activities) {
    const isSuccess = act.success === 1;
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group';

    tr.addEventListener('click', () => {
      if (act.shareId) {
        window.location.href = `/timeline.html?share=${act.shareId}`;
      }
    });

    // 1. File Name
    const tdFile = document.createElement('td');
    tdFile.className = 'px-6 py-3.5 whitespace-nowrap font-semibold text-slate-900 dark:text-slate-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors';
    tdFile.textContent = act.fileName || 'Untitled File';

    // 2. Reason / Result Badge
    const tdResult = document.createElement('td');
    tdResult.className = 'px-6 py-3.5 whitespace-nowrap';
    const badge = document.createElement('span');
    badge.className = isSuccess
      ? 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
      : 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30';
    badge.textContent = act.reason || (isSuccess ? 'OK' : 'BLOCKED');
    tdResult.appendChild(badge);

    // 3. Recipient Email
    const tdEmail = document.createElement('td');
    tdEmail.className = 'px-6 py-3.5 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium';
    tdEmail.textContent = act.userEmail || (isSuccess ? 'Public Visitor' : 'Unspecified');

    // 4. IP Address
    const tdIp = document.createElement('td');
    tdIp.className = 'px-6 py-3.5 whitespace-nowrap font-mono text-slate-500 dark:text-slate-400';
    tdIp.textContent = act.ip || '-';

    // 5. Timestamp
    const tdTime = document.createElement('td');
    tdTime.className = 'px-6 py-3.5 whitespace-nowrap text-right text-slate-500 dark:text-slate-400 font-mono text-[11px]';
    tdTime.textContent = `${UI.formatDate(act.at)} (${UI.formatRelativeTime(act.at)})`;

    tr.appendChild(tdFile);
    tr.appendChild(tdResult);
    tr.appendChild(tdEmail);
    tr.appendChild(tdIp);
    tr.appendChild(tdTime);

    tbody.appendChild(tr);
  }
}
