// Service Worker - Manages blocked sites, timers, and state
const BLOCKED_SITES_KEY = 'blockedSites';
const ACTIVE_TIMERS_KEY = 'activeTimers';
const DEFAULT_TIMER_DURATION = 5; // 5 minutes in minutes

// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([BLOCKED_SITES_KEY], (result) => {
    if (!result[BLOCKED_SITES_KEY]) {
      chrome.storage.local.set({
        [BLOCKED_SITES_KEY]: [
          'facebook.com',
          'twitter.com',
          'reddit.com'
        ]
      });
    }
  });
});

// Message listener for content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkIfBlocked') {
    handleCheckIfBlocked(request.url, sendResponse);
    return true;
  }
  
  if (request.action === 'startTimer') {
    handleStartTimer(request.domain, request.durationMinutes, sendResponse);
    return true;
  }
  
  if (request.action === 'getBlockedSites') {
    handleGetBlockedSites(sendResponse);
    return true;
  }
  
  if (request.action === 'addBlockedSite') {
    handleAddBlockedSite(request.domain, sendResponse);
    return true;
  }
  
  if (request.action === 'removeBlockedSite') {
    handleRemoveBlockedSite(request.domain, sendResponse);
    return true;
  }
});

/**
 * Check if a URL is blocked and if a timer is active
 */
function handleCheckIfBlocked(url, sendResponse) {
  try {
    const domain = extractDomain(url);
    
    chrome.storage.local.get([BLOCKED_SITES_KEY, ACTIVE_TIMERS_KEY], (result) => {
      const blockedSites = result[BLOCKED_SITES_KEY] || [];
      const activeTimers = result[ACTIVE_TIMERS_KEY] || {};
      
      const isBlocked = blockedSites.some(site => {
        return domain.includes(site.replace('www.', ''));
      });
      
      if (isBlocked) {
        const timerData = activeTimers[domain];
        const isTimerActive = timerData && timerData.expiresAt > Date.now();
        
        sendResponse({
          isBlocked: true,
          hasActiveTimer: isTimerActive,
          timeRemaining: isTimerActive ? Math.max(0, timerData.expiresAt - Date.now()) : 0
        });
      } else {
        sendResponse({
          isBlocked: false,
          hasActiveTimer: false
        });
      }
    });
  } catch (error) {
    console.error('Error checking if blocked:', error);
    sendResponse({ isBlocked: false, hasActiveTimer: false, error: error.message });
  }
}

/**
 * Start a timer for temporary access to a blocked site
 */
function handleStartTimer(domain, durationMinutes = DEFAULT_TIMER_DURATION, sendResponse) {
  const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
  
  chrome.storage.local.get([ACTIVE_TIMERS_KEY], (result) => {
    const activeTimers = result[ACTIVE_TIMERS_KEY] || {};
    activeTimers[domain] = { expiresAt, durationMinutes };
    
    chrome.storage.local.set({ [ACTIVE_TIMERS_KEY]: activeTimers }, () => {
      // Set an alarm to clean up expired timers
      chrome.alarms.create(`timer-${domain}`, {
        delayInMinutes: durationMinutes + 1
      });
      
      sendResponse({ success: true, expiresAt });
    });
  });
}

/**
 * Get all blocked sites
 */
function handleGetBlockedSites(sendResponse) {
  chrome.storage.local.get([BLOCKED_SITES_KEY], (result) => {
    sendResponse({
      blockedSites: result[BLOCKED_SITES_KEY] || []
    });
  });
}

/**
 * Add a site to the blocked list
 */
function handleAddBlockedSite(domain, sendResponse) {
  chrome.storage.local.get([BLOCKED_SITES_KEY], (result) => {
    const blockedSites = result[BLOCKED_SITES_KEY] || [];
    const cleanDomain = domain.replace('www.', '').toLowerCase();
    
    if (!blockedSites.includes(cleanDomain)) {
      blockedSites.push(cleanDomain);
      chrome.storage.local.set({ [BLOCKED_SITES_KEY]: blockedSites }, () => {
        sendResponse({ success: true, blockedSites });
      });
    } else {
      sendResponse({ success: false, message: 'Domain already blocked' });
    }
  });
}

/**
 * Remove a site from the blocked list
 */
function handleRemoveBlockedSite(domain, sendResponse) {
  chrome.storage.local.get([BLOCKED_SITES_KEY], (result) => {
    let blockedSites = result[BLOCKED_SITES_KEY] || [];
    const cleanDomain = domain.replace('www.', '').toLowerCase();
    blockedSites = blockedSites.filter(site => site !== cleanDomain);
    
    chrome.storage.local.set({ [BLOCKED_SITES_KEY]: blockedSites }, () => {
      sendResponse({ success: true, blockedSites });
    });
  });
}

/**
 * Clean up expired timers
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('timer-')) {
    const domain = alarm.name.replace('timer-', '');
    chrome.storage.local.get([ACTIVE_TIMERS_KEY], (result) => {
      const activeTimers = result[ACTIVE_TIMERS_KEY] || {};
      delete activeTimers[domain];
      chrome.storage.local.set({ [ACTIVE_TIMERS_KEY]: activeTimers });
    });
  }
});

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return '';
  }
}
