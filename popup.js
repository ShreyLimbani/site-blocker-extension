// Popup Script - Manages UI and blocked sites list

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadBlockedSites();
  loadSettings();
  loadStats('today');
  loadFocusMode();
  loadCustomMessage();
  setupEventListeners();
  setupTabNavigation();
  setupThemeListeners();
  setupStatsListeners();
  setupFocusModeListeners();
});

/**
 * Load theme from storage and apply it
 */
function loadTheme() {
  chrome.storage.local.get(['theme'], (result) => {
    const savedTheme = result.theme || 'auto';
    applyTheme(savedTheme);

    // Set the correct radio button
    const themeRadio = document.querySelector(`input[name="theme"][value="${savedTheme}"]`);
    if (themeRadio) {
      themeRadio.checked = true;
    }
  });
}

/**
 * Apply theme to the document
 */
function applyTheme(theme) {
  let effectiveTheme = theme;

  if (theme === 'auto') {
    effectiveTheme = getSystemTheme();
  }

  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

/**
 * Get the system's preferred color scheme
 */
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Save theme preference to storage
 */
function saveTheme(theme) {
  chrome.storage.local.set({ theme }, () => {
    applyTheme(theme);
  });
}

/**
 * Set up theme radio button listeners
 */
function setupThemeListeners() {
  const themeRadios = document.querySelectorAll('input[name="theme"]');

  themeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      saveTheme(e.target.value);
    });
  });

  // Listen for system theme changes when in auto mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    chrome.storage.local.get(['theme'], (result) => {
      if (result.theme === 'auto' || !result.theme) {
        applyTheme('auto');
      }
    });
  });
}

/**
 * Set up tab navigation
 */
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all tabs
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  document.getElementById('addSiteBtn').addEventListener('click', addNewSite);
  document.getElementById('newSiteInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addNewSite();
    }
  });

  document.getElementById('saveHoursBtn').addEventListener('click', saveWorkingHours);
  document.getElementById('saveLimitBtn').addEventListener('click', saveCustomLimit);
  document.getElementById('saveMessageBtn').addEventListener('click', saveCustomMessage);
}

/**
 * Set up Focus Mode event listeners
 */
function setupFocusModeListeners() {
  document.getElementById('focusModeToggle').addEventListener('change', toggleFocusMode);
  document.getElementById('addWhitelistBtn').addEventListener('click', addWhitelistSite);
  document.getElementById('whitelistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addWhitelistSite();
    }
  });

  // Listen for storage changes to update UI
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.focusModeActive || changes.focusModeWhitelist)) {
      loadFocusMode();
    }
  });
}

/**
 * Load settings from storage
 */
function loadSettings() {
  // Load working hours
  chrome.runtime.sendMessage(
    { action: 'getWorkingHours' },
    (response) => {
      if (response.workingHours) {
        document.getElementById('startHour').value = String(response.workingHours.startHour).padStart(2, '0');
        document.getElementById('startMinute').value = String(response.workingHours.startMinute).padStart(2, '0');
        document.getElementById('endHour').value = String(response.workingHours.endHour).padStart(2, '0');
        document.getElementById('endMinute').value = String(response.workingHours.endMinute).padStart(2, '0');
      }
    }
  );

  // Load daily limit
  chrome.runtime.sendMessage(
    { action: 'getDailyLimit' },
    (response) => {
      if (response) {
        document.getElementById('dailyUsed').textContent = `${response.dailyLimitUsed} min`;
        document.getElementById('dailyRemaining').textContent = `${response.dailyLimitRemaining} min`;
        document.getElementById('dailyLimitInput').value = response.dailyLimitTotal;
      }
    }
  );
}

/**
 * Show subtle toast notification
 */
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('toast-show'), 10);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Save working hours
 */
function saveWorkingHours() {
  const workingHours = {
    startHour: parseInt(document.getElementById('startHour').value),
    startMinute: parseInt(document.getElementById('startMinute').value),
    endHour: parseInt(document.getElementById('endHour').value),
    endMinute: parseInt(document.getElementById('endMinute').value)
  };

  chrome.runtime.sendMessage(
    { action: 'setWorkingHours', workingHours },
    (response) => {
      if (response.success) {
        showToast('✓ Working hours saved');
      } else {
        showToast('Failed to save working hours', 'error');
      }
    }
  );
}

/**
 * Save custom daily limit
 */
function saveCustomLimit() {
  const limit = parseInt(document.getElementById('dailyLimitInput').value);

  if (isNaN(limit) || limit < 1 || limit > 480) {
    showToast('Please enter a valid limit (1-480 minutes)', 'error');
    return;
  }

  chrome.runtime.sendMessage(
    { action: 'setCustomDailyLimit', limit },
    (response) => {
      if (response.success) {
        showToast('✓ Daily limit saved');
        loadSettings();
      } else {
        showToast('Failed to save daily limit', 'error');
      }
    }
  );
}

/**
 * Load and display blocked sites
 */
function loadBlockedSites() {
  chrome.runtime.sendMessage(
    { action: 'getBlockedSites' },
    (response) => {
      displayBlockedSites(response.blockedSites);
    }
  );
}

/**
 * Display blocked sites in the list
 */
function displayBlockedSites(sites) {
  const listContainer = document.getElementById('blockedSitesList');
  
  if (!sites || sites.length === 0) {
    listContainer.innerHTML = '<p class="empty-state">No websites blocked yet. Add one to get started!</p>';
    return;
  }
  
  listContainer.innerHTML = '';
  
  sites.forEach(site => {
    const item = document.createElement('div');
    item.className = 'site-item';
    item.innerHTML = `
      <div class="site-info">
        <span class="site-name">${escapeHtml(site)}</span>
      </div>
      <button class="btn btn-danger btn-small" data-site="${site}">Remove</button>
    `;
    
    item.querySelector('button').addEventListener('click', (e) => {
      removeSite(e.target.dataset.site);
    });
    
    listContainer.appendChild(item);
  });
}

/**
 * Add a new blocked site
 */
function addNewSite() {
  const input = document.getElementById('newSiteInput');
  const domain = input.value.trim().toLowerCase();

  if (!domain) {
    showToast('Please enter a domain', 'error');
    return;
  }

  if (!isValidDomain(domain)) {
    showToast('Please enter a valid domain (e.g., facebook.com)', 'error');
    return;
  }

  chrome.runtime.sendMessage(
    { action: 'addBlockedSite', domain },
    (response) => {
      if (response.success) {
        input.value = '';
        displayBlockedSites(response.blockedSites);
        showToast(`✓ ${domain} blocked`);
      } else {
        showToast(response.message || 'Failed to add site', 'error');
      }
    }
  );
}

/**
 * Remove a blocked site
 */
function removeSite(domain) {
  if (confirm(`Remove ${domain} from blocked list?`)) {
    chrome.runtime.sendMessage(
      { action: 'removeBlockedSite', domain },
      (response) => {
        if (response.success) {
          displayBlockedSites(response.blockedSites);
          showToast(`✓ ${domain} removed`);
        }
      }
    );
  }
}

/**
 * Validate domain format
 */
function isValidDomain(domain) {
  // Simple domain validation
  const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
  return domainRegex.test(domain);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// STATS FUNCTIONS
// ============================================

/**
 * Set up stats-related event listeners
 */
function setupStatsListeners() {
  // Period selector buttons
  const periodBtns = document.querySelectorAll('.period-btn');
  periodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      periodBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadStats(btn.dataset.period);
    });
  });

  // Clear stats button
  document.getElementById('clearStatsBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all statistics? This cannot be undone.')) {
      clearStats();
    }
  });
}

/**
 * Load stats from background script
 */
function loadStats(period) {
  chrome.runtime.sendMessage(
    { action: 'getStats', period },
    (response) => {
      if (response && response.stats) {
        displayStats(response.stats);
      }
    }
  );
}

/**
 * Display stats in the UI
 */
function displayStats(stats) {
  // Update summary cards
  document.getElementById('totalTime').textContent = formatTime(stats.totalTimeMs);
  document.getElementById('totalVisits').textContent = stats.totalVisits;
  document.getElementById('workTime').textContent = formatTime(stats.workTimeMs);
  document.getElementById('offTime').textContent = formatTime(stats.offTimeMs);

  // Display top sites
  const listContainer = document.getElementById('topSitesList');

  if (!stats.sites || stats.sites.length === 0) {
    listContainer.innerHTML = '<p class="empty-state">No data yet. Browse some websites to see stats.</p>';
    return;
  }

  listContainer.innerHTML = '';

  // Get max time for calculating progress bar widths
  const maxTime = stats.sites[0]?.timeMs || 1;

  stats.sites.slice(0, 5).forEach(site => {
    const percentage = Math.round((site.timeMs / maxTime) * 100);
    const item = document.createElement('div');
    item.className = 'top-site-item';
    item.innerHTML = `
      <div class="top-site-header">
        <span class="top-site-domain">${escapeHtml(site.domain)}</span>
        <span class="top-site-time">${formatTime(site.timeMs)}</span>
      </div>
      <div class="top-site-bar">
        <div class="top-site-bar-fill" style="width: ${percentage}%"></div>
      </div>
      <span class="top-site-visits">${site.visits} visit${site.visits !== 1 ? 's' : ''}</span>
    `;
    listContainer.appendChild(item);
  });
}

/**
 * Format milliseconds to human readable time
 */
function formatTime(ms) {
  if (!ms || ms < 1000) return '0m';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Clear all stats
 */
function clearStats() {
  chrome.runtime.sendMessage(
    { action: 'clearStats' },
    (response) => {
      if (response && response.success) {
        // Reset the display
        document.getElementById('totalTime').textContent = '0m';
        document.getElementById('totalVisits').textContent = '0';
        document.getElementById('workTime').textContent = '0m';
        document.getElementById('offTime').textContent = '0m';
        document.getElementById('topSitesList').innerHTML =
          '<p class="empty-state">No data yet. Browse some websites to see stats.</p>';
        showToast('✓ All stats cleared');
      }
    }
  );
}

// ============================================
// FOCUS MODE FUNCTIONS
// ============================================

/**
 * Load Focus Mode status and whitelist
 */
function loadFocusMode() {
  chrome.runtime.sendMessage(
    { action: 'getFocusMode' },
    (response) => {
      if (response) {
        const toggle = document.getElementById('focusModeToggle');
        const status = document.getElementById('focusModeStatus');

        toggle.checked = response.focusModeActive;

        if (response.focusModeActive) {
          status.textContent = 'Active';
          status.className = 'status-badge status-active';
        } else {
          status.textContent = 'Inactive';
          status.className = 'status-badge status-inactive';
        }

        displayWhitelistSites(response.whitelist);
      }
    }
  );
}

/**
 * Toggle Focus Mode on/off
 */
function toggleFocusMode() {
  chrome.runtime.sendMessage(
    { action: 'toggleFocusMode' },
    (response) => {
      if (response && response.success) {
        const message = response.focusModeActive
          ? '🎯 Focus Mode activated'
          : 'Focus Mode deactivated';
        showToast(message);
        loadFocusMode();
      }
    }
  );
}

/**
 * Add a site to whitelist
 */
function addWhitelistSite() {
  const input = document.getElementById('whitelistInput');
  const domain = input.value.trim().toLowerCase();

  if (!domain) {
    showToast('Please enter a domain', 'error');
    return;
  }

  if (!isValidDomain(domain)) {
    showToast('Please enter a valid domain (e.g., gmail.com)', 'error');
    return;
  }

  chrome.runtime.sendMessage(
    { action: 'addToWhitelist', domain },
    (response) => {
      if (response.success) {
        input.value = '';
        displayWhitelistSites(response.whitelist);
        showToast(`✓ ${domain} added to whitelist`);
      } else {
        showToast(response.message || 'Failed to add site', 'error');
      }
    }
  );
}

/**
 * Remove a site from whitelist
 */
function removeWhitelistSite(domain) {
  if (confirm(`Remove ${domain} from whitelist?`)) {
    chrome.runtime.sendMessage(
      { action: 'removeFromWhitelist', domain },
      (response) => {
        if (response.success) {
          displayWhitelistSites(response.whitelist);
          showToast(`✓ ${domain} removed from whitelist`);
        }
      }
    );
  }
}

// ============================================
// CUSTOM MESSAGE FUNCTIONS
// ============================================

/**
 * Load custom message from storage
 */
function loadCustomMessage() {
  chrome.runtime.sendMessage(
    { action: 'getCustomMessage' },
    (response) => {
      if (response) {
        document.getElementById('customMessageInput').value = response.message || '';
      }
    }
  );
}

/**
 * Save custom message to storage
 */
function saveCustomMessage() {
  const message = document.getElementById('customMessageInput').value.trim();
  chrome.runtime.sendMessage(
    { action: 'setCustomMessage', message },
    (response) => {
      if (response && response.success) {
        showToast(message ? '✓ Custom message saved' : '✓ Using Hacker News top article');
      } else {
        showToast('Failed to save message', 'error');
      }
    }
  );
}

/**
 * Display whitelist sites in the list
 */
function displayWhitelistSites(sites) {
  const listContainer = document.getElementById('whitelistSitesList');

  if (!sites || sites.length === 0) {
    listContainer.innerHTML = '<p class="empty-state">No sites in whitelist. Add sites that you want to access during Focus Mode.</p>';
    return;
  }

  listContainer.innerHTML = '';

  sites.forEach(site => {
    const item = document.createElement('div');
    item.className = 'site-item';
    item.innerHTML = `
      <div class="site-info">
        <span class="site-name">${escapeHtml(site)}</span>
      </div>
      <button class="btn btn-danger btn-small" data-site="${site}">Remove</button>
    `;

    item.querySelector('button').addEventListener('click', (e) => {
      removeWhitelistSite(e.target.dataset.site);
    });

    listContainer.appendChild(item);
  });
}
