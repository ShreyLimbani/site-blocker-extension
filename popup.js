// Popup Script - Manages UI and blocked sites list

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadBlockedSites();
  loadSettings();
  setupEventListeners();
  setupTabNavigation();
  setupThemeListeners();
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
      }
    }
  );
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
        alert('Working hours saved successfully!');
      } else {
        alert('Failed to save working hours');
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
    alert('Please enter a domain');
    return;
  }
  
  if (!isValidDomain(domain)) {
    alert('Please enter a valid domain (e.g., facebook.com)');
    return;
  }
  
  chrome.runtime.sendMessage(
    { action: 'addBlockedSite', domain },
    (response) => {
      if (response.success) {
        input.value = '';
        displayBlockedSites(response.blockedSites);
      } else {
        alert(response.message || 'Failed to add site');
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
