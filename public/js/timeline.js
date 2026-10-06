/**
 * VaultLink Access Timeline Script
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

  if (fileName) fileName.textContent = share.fileName || 'Shared File';
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
      'No Access Activity Yet',
      'No one has attempted to access or download this share link yet.'
    );
    return;
  }

  container.classList.remove('hidden');
  emptyState.classList.add('hidden');

  for (const log of logs) {
    const isSuccess = log.success === 1;

    // Timeline Node Wrapper
    const nodeWrapper = document.createElement('div');
    nodeWrapper.className = 'relative flex items-start gap-4 group';

    // Timeline Dot / Icon
    const dot = document.createElement('div');
    dot.className = isSuccess
      ? 'absolute -left-[30px] w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 border-2 border-emerald-500 dark:border-emerald-400 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400 shadow-sm shadow-emerald-500/30'
      : 'absolute -left-[30px] w-5 h-5 rounded-full bg-rose-100 dark:bg-rose-500/20 border-2 border-rose-500 dark:border-rose-400 flex items-center justify-center shrink-0 text-rose-600 dark:text-rose-400 shadow-sm shadow-rose-500/30';

    dot.innerHTML = isSuccess
      ? `<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>`
      : `<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/></svg>`;

    // Log Card
    const card = document.createElement('div');
    card.className = isSuccess
      ? 'flex-1 bg-white dark:bg-slate-900/80 border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-4 sm:p-5 shadow-md hover:shadow-lg hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-all space-y-2.5'
      : 'flex-1 bg-white dark:bg-slate-900/80 border border-rose-200 dark:border-rose-500/30 rounded-xl p-4 sm:p-5 shadow-md hover:shadow-lg hover:border-rose-400 dark:hover:border-rose-500/50 transition-all space-y-2.5';

    // Header Row: Title + Reason Badge + Timestamp
    const headerRow = document.createElement('div');
    headerRow.className = 'flex flex-wrap items-center justify-between gap-2';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'flex items-center gap-2';

    const title = document.createElement('h4');
    title.className = 'text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100';
    title.textContent = isSuccess ? 'Download Succeeded' : 'Blocked Access Attempt';

    // Reason Badge
    const reasonBadge = document.createElement('span');
    reasonBadge.className = isSuccess
      ? 'px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
      : 'px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
    reasonBadge.textContent = log.reason || (isSuccess ? 'OK' : 'BLOCKED');

    titleGroup.appendChild(title);
    titleGroup.appendChild(reasonBadge);

    // Timestamp
    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-[11px] text-slate-500 dark:text-slate-400 font-mono';
    timeSpan.textContent = `${UI.formatDate(log.at)} (${UI.formatRelativeTime(log.at)})`;

    headerRow.appendChild(titleGroup);
    headerRow.appendChild(timeSpan);

    // Detail Row: Email & IP info
    const detailRow = document.createElement('div');
    detailRow.className = 'flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300 pt-2 border-t border-slate-100 dark:border-slate-800/60';

    // Email
    const emailGroup = document.createElement('div');
    emailGroup.className = 'flex items-center gap-1.5';
    emailGroup.innerHTML = `
      <svg class="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206"/>
      </svg>
    `;
    const emailText = document.createElement('span');
    emailText.className = 'font-semibold text-slate-800 dark:text-slate-200';
    emailText.textContent = log.email || (isSuccess ? 'Anonymous / Public' : 'Unspecified');
    emailGroup.appendChild(emailText);

    // IP
    const ipGroup = document.createElement('div');
    ipGroup.className = 'flex items-center gap-1.5';
    ipGroup.innerHTML = `
      <svg class="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
      </svg>
    `;
    const ipText = document.createElement('span');
    ipText.className = 'font-mono text-slate-500 dark:text-slate-400';
    ipText.textContent = log.ip || 'Unknown IP';
    ipGroup.appendChild(ipText);

    detailRow.appendChild(emailGroup);
    detailRow.appendChild(ipGroup);

    card.appendChild(headerRow);
    card.appendChild(detailRow);

    nodeWrapper.appendChild(dot);
    nodeWrapper.appendChild(card);
    container.appendChild(nodeWrapper);
  }
}
