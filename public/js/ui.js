/**
 * MoVo UI Utilities - Archive Ledger & Register Design System
 * Strict security: all dynamic/user content is rendered using textContent or safe DOM nodes.
 * Provides Theme management, Mobile Navigation, Toast system, Status Badges, and Notifications.
 */

// Initialize Theme immediately on script execution to prevent flash
(function () {
  const savedTheme = localStorage.getItem('movo_theme') || localStorage.getItem('vaultlink_theme') || 'dark';
  if (savedTheme === 'light') {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  }
})();

const UI = {
  /**
   * Get current theme ('dark' | 'light')
   */
  getTheme() {
    return document.documentElement.classList.contains('light') ? 'light' : 'dark';
  },

  /**
   * Set theme and persist to localStorage
   * @param {'dark' | 'light'} theme
   */
  setTheme(theme) {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
      localStorage.setItem('movo_theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      localStorage.setItem('movo_theme', 'dark');
    }
    this.updateThemeToggleIcons();
  },

  /**
   * Toggle between dark and light theme
   */
  toggleTheme() {
    const current = this.getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
  },

  /**
   * Update all theme toggle buttons across the DOM
   */
  updateThemeToggleIcons() {
    const isLight = this.getTheme() === 'light';
    const toggles = document.querySelectorAll('.theme-toggle-btn');
    toggles.forEach((btn) => {
      btn.setAttribute('aria-label', isLight ? 'Switch to Dark mode' : 'Switch to Light mode');
      btn.setAttribute('title', isLight ? 'Switch to Dark mode' : 'Switch to Light mode');
      const sunIcon = btn.querySelector('.theme-icon-sun');
      const moonIcon = btn.querySelector('.theme-icon-moon');
      const textLabel = btn.querySelector('.theme-toggle-text');

      if (sunIcon && moonIcon) {
        if (isLight) {
          sunIcon.classList.add('hidden');
          moonIcon.classList.remove('hidden');
        } else {
          sunIcon.classList.remove('hidden');
          moonIcon.classList.add('hidden');
        }
      }
      if (textLabel) {
        textLabel.textContent = isLight ? 'Dark Mode' : 'Light Mode';
      }
    });
  },

  /**
   * Initialize theme toggle buttons
   */
  initTheme() {
    this.updateThemeToggleIcons();
    const toggles = document.querySelectorAll('.theme-toggle-btn');
    toggles.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleTheme();
      });
    });
  },

  /**
   * Initialize Mobile Navigation Drawer / Hamburger menu
   */
  initMobileNav() {
    const mobileMenuBtn = document.getElementById('btn-mobile-menu');
    const mobileDrawer = document.getElementById('mobile-drawer');
    const mobileBackdrop = document.getElementById('mobile-drawer-backdrop');
    const closeBtn = document.getElementById('btn-close-mobile-menu');

    if (!mobileMenuBtn || !mobileDrawer) return;

    const openDrawer = () => {
      mobileDrawer.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
    };

    const closeDrawer = () => {
      mobileDrawer.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
    };

    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDrawer();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (mobileBackdrop) mobileBackdrop.addEventListener('click', closeDrawer);

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mobileDrawer.classList.contains('hidden')) {
        closeDrawer();
      }
    });
  },

  /**
   * Create a status badge DOM element (Text + Color).
   * ACTIVE: green, EXPIRED: grey, REVOKED: red, LIMIT_REACHED: amber
   *
   * @param {'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'LIMIT_REACHED'} status
   * @returns {HTMLSpanElement}
   */
  createStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className = 'badge-status';

    const dot = document.createElement('span');
    dot.className = 'w-1.5 h-1.5 rounded-full inline-block shrink-0';

    let text = status || 'UNKNOWN';

    switch (status) {
      case 'ACTIVE':
        text = 'Active';
        badge.classList.add('badge-status-active');
        dot.style.backgroundColor = 'currentColor';
        break;
      case 'EXPIRED':
        text = 'Expired';
        badge.classList.add('badge-status-expired');
        dot.style.backgroundColor = 'currentColor';
        break;
      case 'REVOKED':
        text = 'Revoked';
        badge.classList.add('badge-status-revoked');
        dot.style.backgroundColor = 'currentColor';
        break;
      case 'LIMIT_REACHED':
        text = 'Limit Reached';
        badge.classList.add('badge-status-limit');
        dot.style.backgroundColor = 'currentColor';
        break;
      default:
        badge.classList.add('badge-status-expired');
        dot.style.backgroundColor = 'currentColor';
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    badge.appendChild(dot);
    badge.appendChild(textSpan);
    return badge;
  },

  /**
   * Format bytes into human-readable string (B, KB, MB, GB).
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
   * Format unix timestamp (ms) into relative string ("2h ago", "in 15m").
   */
  formatRelativeTime(unixMs) {
    if (!unixMs) return '-';
    const now = Date.now();
    const diff = unixMs - now;
    const isPast = diff < 0;
    const absDiffSec = Math.floor(Math.abs(diff) / 1000);

    if (absDiffSec < 60) return isPast ? 'just now' : 'in < 1m';
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

    const heading = document.createElement('h3');
    heading.className = 'text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-main)] mb-1';
    heading.textContent = `— ${title} —`;

    const desc = document.createElement('p');
    desc.className = 'text-xs text-[var(--text-muted)] max-w-sm leading-relaxed';
    desc.textContent = description;

    wrapper.appendChild(heading);
    wrapper.appendChild(desc);
    container.appendChild(wrapper);
  },

  /**
   * Show a toast message with subtle reveal and automatic dismissal.
   */
  showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className =
      'px-3.5 py-2.5 rounded text-xs flex items-center justify-between gap-3 ledger-border bg-[var(--bg-surface)] text-[var(--text-main)] transition-opacity duration-150';

    if (type === 'success') {
      toast.style.borderColor = 'var(--status-active-border)';
      toast.style.backgroundColor = 'var(--status-active-bg)';
      toast.style.color = 'var(--status-active-text)';
    } else if (type === 'error') {
      toast.style.borderColor = 'var(--status-revoked-border)';
      toast.style.backgroundColor = 'var(--status-revoked-bg)';
      toast.style.color = 'var(--status-revoked-text)';
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'flex-1 font-medium';
    textSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-[var(--text-dim)] hover:text-[var(--text-main)] text-xs ml-2 p-1 transition-colors';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => {
      toast.remove();
    };

    toast.appendChild(textSpan);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, 4500);
  },

  /**
   * Initialize dynamic Notification Bell with unread counter and mark-as-read.
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
        list.innerHTML = `<div class="p-4 text-center text-xs text-[var(--text-dim)] font-mono">No entries in notification log</div>`;
        return;
      }

      for (const n of notifs) {
        const item = document.createElement('div');
        item.className = `p-3 border-b border-[var(--border-subtle)] flex items-start justify-between gap-2.5 ${n.read === 0 ? 'bg-[var(--bg-surface-subtle)]' : ''}`;

        const content = document.createElement('div');
        content.className = 'flex-1 space-y-0.5';

        const msg = document.createElement('p');
        msg.className = `text-xs leading-relaxed ${n.read === 0 ? 'text-[var(--text-main)] font-semibold' : 'text-[var(--text-muted)]'}`;
        msg.textContent = n.message;

        const time = document.createElement('p');
        time.className = 'text-[10px] text-[var(--text-dim)] font-mono';
        time.textContent = UI.formatRelativeTime(n.created_at || n.createdAt);

        content.appendChild(msg);
        content.appendChild(time);
        item.appendChild(content);

        if (n.read === 0) {
          const btnRead = document.createElement('button');
          btnRead.type = 'button';
          btnRead.className =
            'p-1 text-[var(--text-dim)] hover:text-[var(--text-main)] text-xs shrink-0 transition-colors font-mono';
          btnRead.title = 'Mark as read';
          btnRead.textContent = '✓';

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

// Auto initialize theme on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  UI.initTheme();
  UI.initMobileNav();
});

if (typeof window !== 'undefined') {
  window.UI = UI;
}
