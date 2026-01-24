// Popup Script - Manages UI and blocked sites list

document.addEventListener('DOMContentLoaded', () => {
  loadBlockedSites();
  setupEventListeners();
});

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
