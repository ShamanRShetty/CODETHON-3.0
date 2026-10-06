/**
 * VaultLink UI Utilities
 * Strict security: all dynamic/user content is rendered using textContent or safe DOM nodes.
 */

const UI = {
  /**
   * Create a status badge DOM element (Text + Color).
   * ACTIVE: green, EXPIRED: grey, REVOKED: red, LIMIT_REACHED: amber
   *
   * @param {'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'LIMIT_REACHED'} status
   * @returns {HTMLSpanElement}
   */
  createStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border';

    const dot = document.createElement('span');
    dot.className = 'w-1.5 h-1.5 rounded-full';

    let text = status || 'UNKNOWN';
    let colorClasses = 'bg-slate-800 text-slate-300 border-slate-700';
    let dotClass = 'bg-slate-400';

    switch (status) {
      case 'ACTIVE':
        text = 'Active';
        colorClasses = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
        dotClass = 'bg-emerald-400';
        break;
      case 'EXPIRED':
        text = 'Expired';
        colorClasses = 'bg-slate-500/10 text-slate-400 border-slate-500/30';
        dotClass = 'bg-slate-400';
        break;
      case 'REVOKED':
        text = 'Revoked';
        colorClasses = 'bg-rose-500/10 text-rose-400 border-rose-500/30';
        dotClass = 'bg-rose-400';
        break;
      case 'LIMIT_REACHED':
        text = 'Limit Reached';
        colorClasses = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
        dotClass = 'bg-amber-400';
        break;
    }

    badge.className += ` ${colorClasses}`;
    dot.className += ` ${dotClass}`;

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    badge.appendChild(dot);
    badge.appendChild(textSpan);
    return badge;
  },

  /**
   * Format bytes into human-readable string (KB, MB, GB).
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  /**
   * Format unix timestamp (ms) to locale string.
   */
  formatDate(unixMs) {
    if (!unixMs) return '-';
    const d = new Date(unixMs);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  },

  /**
   * Format unix timestamp (ms) into relative string ("2 hours ago", "in 15 minutes").
   */
  formatRelativeTime(unixMs) {
    if (!unixMs) return '-';
    const now = Date.now();
    const diff = unixMs - now;
    const isPast = diff < 0;
    const absDiffSec = Math.floor(Math.abs(diff) / 1000);

    if (absDiffSec < 60) return isPast ? 'just now' : 'in < 1 min';
    const mins = Math.floor(absDiffSec / 60);
    if (mins < 60) return isPast ? `${mins}m ago` : `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return isPast ? `${hours}h ago` : `in ${hours}h`;
    const days = Math.floor(hours / 24);
    return isPast ? `${days}d ago` : `in ${days}d`;
  },

  /**
   * Render an empty state component into a container element safely.
   */
  renderEmptyState(container, title, description) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col items-center justify-center py-12 px-4 text-center';

    const iconBox = document.createElement('div');
    iconBox.className =
      'w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400 mb-3';
    iconBox.innerHTML = `
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
      </svg>
    `;

    const heading = document.createElement('h3');
    heading.className = 'text-sm font-semibold text-slate-200 mb-1';
    heading.textContent = title;

    const desc = document.createElement('p');
    desc.className = 'text-xs text-slate-400 max-w-sm';
    desc.textContent = description;

    wrapper.appendChild(iconBox);
    wrapper.appendChild(heading);
    wrapper.appendChild(desc);
    container.appendChild(wrapper);
  },

  /**
   * Show a toast message.
   */
  showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    let typeClass = 'bg-slate-800 text-slate-200 border-slate-700';
    if (type === 'success') typeClass = 'bg-emerald-950 text-emerald-200 border-emerald-800';
    if (type === 'error') typeClass = 'bg-rose-950 text-rose-200 border-rose-800';

    toast.className = `px-4 py-3 rounded-lg border shadow-lg text-sm flex items-center justify-between gap-3 transition-all duration-300 transform translate-y-2 opacity-0 ${typeClass}`;

    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-slate-400 hover:text-white text-xs ml-2';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => {
      toast.remove();
    };

    toast.appendChild(textSpan);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  /**
   * Initialize interactive Notification Bell with unread counter and mark-as-read.
   */
  async initNotifications() {
    const btnBell = document.getElementById('btn-notifications');
    const badge = document.getElementById('notifications-badge');
    const dropdown = document.getElementById('notifications-dropdown');
    const list = document.getElementById('notifications-list');
    const btnMarkAll = document.getElementById('btn-mark-all-read');

    if (!btnBell || !dropdown) return;

    // Toggle dropdown
    btnBell.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
      if (!dropdown.classList.contains('hidden')) {
        loadNotificationList();
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !btnBell.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });

    async function loadNotificationList() {
      if (!list) return;
      try {
        const notifs = await api.get('/api/notifications');
        renderNotificationItems(notifs || []);
      } catch (err) {
        console.error('Failed to load notifications:', err);
      }
    }

    function renderNotificationItems(notifs) {
      if (!list) return;
      list.innerHTML = '';

      const unreadCount = notifs.filter((n) => n.read === 0).length;
      if (badge) {
        if (unreadCount > 0) {
          badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }

      if (!notifs || notifs.length === 0) {
        list.innerHTML = `<div class="p-6 text-center text-xs text-slate-500">No notifications yet</div>`;
        return;
      }

      for (const n of notifs) {
        const item = document.createElement('div');
        item.className = `p-3 border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors flex items-start justify-between gap-2.5 ${n.read === 0 ? 'bg-slate-800/20' : ''}`;

        const content = document.createElement('div');
        content.className = 'flex-1 space-y-1';

        const msg = document.createElement('p');
        msg.className = `text-xs leading-relaxed ${n.read === 0 ? 'text-slate-100 font-medium' : 'text-slate-400'}`;
        msg.textContent = n.message;

        const time = document.createElement('p');
        time.className = 'text-[10px] text-slate-500 font-mono';
        time.textContent = UI.formatRelativeTime(n.created_at || n.createdAt);

        content.appendChild(msg);
        content.appendChild(time);
        item.appendChild(content);

        if (n.read === 0) {
          const btnRead = document.createElement('button');
          btnRead.type = 'button';
          btnRead.className =
            'p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-700/50 rounded transition-colors shrink-0';
          btnRead.title = 'Mark as read';
          btnRead.innerHTML = `
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
          `;

          btnRead.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await api.post(`/api/notifications/${n.id}/read`);
              n.read = 1;
              loadNotificationList();
            } catch (err) {
              console.error('Failed to mark notification read:', err);
            }
          });

          item.appendChild(btnRead);
        }

        list.appendChild(item);
      }
    }

    if (btnMarkAll) {
      btnMarkAll.addEventListener('click', async () => {
        try {
          const notifs = await api.get('/api/notifications');
          const unread = notifs.filter((n) => n.read === 0);
          for (const u of unread) {
            await api.post(`/api/notifications/${u.id}/read`);
          }
          loadNotificationList();
        } catch (err) {
          console.error('Failed to mark all as read:', err);
        }
      });
    }

    // Initial silent check for badge count
    try {
      const notifs = await api.get('/api/notifications');
      const unreadCount = (notifs || []).filter((n) => n.read === 0).length;
      if (badge) {
        if (unreadCount > 0) {
          badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
    } catch (err) {
      // Ignore initial load error
    }
  },
};

if (typeof window !== 'undefined') {
  window.UI = UI;
}
