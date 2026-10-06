/**
 * MoVo UI Utilities
 * Strict security: all dynamic/user content is rendered using textContent or safe DOM nodes.
 * Provides Light/Dark Theme management, Mobile Navigation, Toast system, Status Badges, and Notifications.
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
      requestAnimationFrame(() => {
        mobileDrawer.classList.remove('opacity-0', 'pointer-events-none');
        const panel = mobileDrawer.querySelector('.mobile-drawer-panel');
        if (panel) panel.classList.remove('-translate-x-full');
      });
      document.body.classList.add('overflow-hidden');
    };

    const closeDrawer = () => {
      const panel = mobileDrawer.querySelector('.mobile-drawer-panel');
      if (panel) panel.classList.add('-translate-x-full');
      mobileDrawer.classList.add('opacity-0', 'pointer-events-none');
      document.body.classList.remove('overflow-hidden');
      setTimeout(() => {
        mobileDrawer.classList.add('hidden');
      }, 250);
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
    badge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors shadow-sm';

    const dot = document.createElement('span');
    dot.className = 'w-1.5 h-1.5 rounded-full shrink-0';

    let text = status || 'UNKNOWN';
    let colorClasses = 'bg-slate-500/10 text-slate-400 border-slate-500/30 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    let dotClass = 'bg-slate-400';

    switch (status) {
      case 'ACTIVE':
        text = 'Active';
        colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30';
        dotClass = 'bg-emerald-500 animate-pulse';
        break;
      case 'EXPIRED':
        text = 'Expired';
        colorClasses = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/30';
        dotClass = 'bg-slate-400';
        break;
      case 'REVOKED':
        text = 'Revoked';
        colorClasses = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30';
        dotClass = 'bg-rose-500';
        break;
      case 'LIMIT_REACHED':
        text = 'Limit Reached';
        colorClasses = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30';
        dotClass = 'bg-amber-500';
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
      'w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 flex items-center justify-center text-slate-400 dark:text-slate-400 mb-3.5 shadow-sm';
    iconBox.innerHTML = `
      <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
      </svg>
    `;

    const heading = document.createElement('h3');
    heading.className = 'text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1';
    heading.textContent = title;

    const desc = document.createElement('p');
    desc.className = 'text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed';
    desc.textContent = description;

    wrapper.appendChild(iconBox);
    wrapper.appendChild(heading);
    wrapper.appendChild(desc);
    container.appendChild(wrapper);
  },

  /**
   * Show a toast message with smooth entrance and auto-dismiss.
   */
  showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className =
      'pointer-events-auto px-4 py-3 rounded-xl border shadow-xl text-xs sm:text-sm flex items-center justify-between gap-3 transition-all duration-300 transform translate-y-3 opacity-0';

    let iconSvg = '';
    if (type === 'success') {
      toast.className += ' bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950/90 dark:text-emerald-200 dark:border-emerald-800';
      iconSvg = `<svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
    } else if (type === 'error') {
      toast.className += ' bg-rose-50 text-rose-900 border-rose-300 dark:bg-rose-950/90 dark:text-rose-200 dark:border-rose-800';
      iconSvg = `<svg class="w-4 h-4 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
    } else {
      toast.className += ' bg-white text-slate-800 border-slate-200 dark:bg-slate-800/90 dark:text-slate-200 dark:border-slate-700';
      iconSvg = `<svg class="w-4 h-4 text-cyan-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    }

    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = iconSvg;

    const textSpan = document.createElement('span');
    textSpan.className = 'flex-1 font-medium';
    textSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs ml-2 p-1 rounded transition-colors';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 250);
    };

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-3', 'opacity-0');
    });

    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 250);
      }
    }, 4500);
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
        list.innerHTML = `<div class="p-6 text-center text-xs text-slate-500 dark:text-slate-400">No notifications yet</div>`;
        return;
      }

      for (const n of notifs) {
        const item = document.createElement('div');
        item.className = `p-3.5 border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors flex items-start justify-between gap-2.5 ${n.read === 0 ? 'bg-cyan-50/50 dark:bg-slate-800/25' : ''}`;

        const content = document.createElement('div');
        content.className = 'flex-1 space-y-1';

        const msg = document.createElement('p');
        msg.className = `text-xs leading-relaxed ${n.read === 0 ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-600 dark:text-slate-400'}`;
        msg.textContent = n.message;

        const time = document.createElement('p');
        time.className = 'text-[10px] text-slate-400 dark:text-slate-500 font-mono';
        time.textContent = UI.formatRelativeTime(n.created_at || n.createdAt);

        content.appendChild(msg);
        content.appendChild(time);
        item.appendChild(content);

        if (n.read === 0) {
          const btnRead = document.createElement('button');
          btnRead.type = 'button';
          btnRead.className =
            'p-1 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded transition-colors shrink-0';
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

// Auto initialize theme on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  UI.initTheme();
  UI.initMobileNav();
});

if (typeof window !== 'undefined') {
  window.UI = UI;
}
