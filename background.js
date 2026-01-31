// Service Worker - Manages blocked sites, timers, and state
const BLOCKED_SITES_KEY = 'blockedSites';
const ACTIVE_TIMERS_KEY = 'activeTimers';
const DAILY_LIMIT_KEY = 'dailyLimitUsed';
const DAILY_LIMIT_DATE_KEY = 'dailyLimitDate';
const WORKING_HOURS_KEY = 'workingHours';
const SITE_STATS_KEY = 'siteStats';
const CUSTOM_DAILY_LIMIT_KEY = 'customDailyLimit';
const FOCUS_MODE_ACTIVE_KEY = 'focusModeActive';
const FOCUS_MODE_WHITELIST_KEY = 'focusModeWhitelist';
const CUSTOM_BLOCK_MESSAGE_KEY = 'customBlockMessage';
const HN_CACHE_KEY = 'hnTopArticleCache';
const DEFAULT_TIMER_DURATION = 5; // 5 minutes in minutes
const DEFAULT_DAILY_LIMIT_MINUTES = 60; // Default: 60 minutes per day

// In-memory session tracking
let activeSessions = {}; // { domain: { tabId, startTime, isWorkingHours } }

/**
 * Check if current time is within working hours
 */
function isWithinWorkingHours(workingHours) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const startHour = workingHours.startHour || 9;
  const startMinute = workingHours.startMinute || 0;
  const endHour = workingHours.endHour || 17;
  const endMinute = workingHours.endMinute || 0;

  const currentTime = currentHour * 60 + currentMinute;
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  return currentTime >= startTime && currentTime <= endTime;
}

/**
 * Get custom daily limit or default
 */
function getDailyLimitMinutes(callback) {
  chrome.storage.local.get([CUSTOM_DAILY_LIMIT_KEY], (result) => {
    callback(result[CUSTOM_DAILY_LIMIT_KEY] || DEFAULT_DAILY_LIMIT_MINUTES);
  });
}

// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([BLOCKED_SITES_KEY, WORKING_HOURS_KEY, FOCUS_MODE_ACTIVE_KEY, FOCUS_MODE_WHITELIST_KEY], (result) => {
    if (!result[BLOCKED_SITES_KEY]) {
      chrome.storage.local.set({
        [BLOCKED_SITES_KEY]: [
          'facebook.com',
          'twitter.com',
          'reddit.com'
        ]
      });
    }
    if (!result[WORKING_HOURS_KEY]) {
      chrome.storage.local.set({
        [WORKING_HOURS_KEY]: {
          startHour: 9,
          startMinute: 0,
          endHour: 17,
          endMinute: 0
        }
      });
    }
    if (result[FOCUS_MODE_ACTIVE_KEY] === undefined) {
      chrome.storage.local.set({ [FOCUS_MODE_ACTIVE_KEY]: false });
    }
    if (!result[FOCUS_MODE_WHITELIST_KEY]) {
      chrome.storage.local.set({ [FOCUS_MODE_WHITELIST_KEY]: [] });
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
  
  if (request.action === 'getWorkingHours') {
    handleGetWorkingHours(sendResponse);
    return true;
  }
  
  if (request.action === 'setWorkingHours') {
    handleSetWorkingHours(request.workingHours, sendResponse);
    return true;
  }
  
  if (request.action === 'getDailyLimit') {
    handleGetDailyLimit(sendResponse);
    return true;
  }

  if (request.action === 'setCustomDailyLimit') {
    handleSetCustomDailyLimit(request.limit, sendResponse);
    return true;
  }

  if (request.action === 'getStats') {
    handleGetStats(request.period, sendResponse);
    return true;
  }

  if (request.action === 'clearStats') {
    handleClearStats(sendResponse);
    return true;
  }

  if (request.action === 'tabVisibilityChanged') {
    handleTabVisibilityChanged(request.isVisible, request.domain, sender.tab?.id, sendResponse);
    return true;
  }

  if (request.action === 'getFocusMode') {
    handleGetFocusMode(sendResponse);
    return true;
  }

  if (request.action === 'toggleFocusMode') {
    handleToggleFocusMode(sendResponse);
    return true;
  }

  if (request.action === 'addToWhitelist') {
    handleAddToWhitelist(request.domain, sendResponse);
    return true;
  }

  if (request.action === 'removeFromWhitelist') {
    handleRemoveFromWhitelist(request.domain, sendResponse);
    return true;
  }

  if (request.action === 'getCustomMessage') {
    handleGetCustomMessage(sendResponse);
    return true;
  }

  if (request.action === 'setCustomMessage') {
    handleSetCustomMessage(request.message, sendResponse);
    return true;
  }

  if (request.action === 'getBlockMessage') {
    handleGetBlockMessage(sendResponse);
    return true;
  }

  if (request.action === 'exportSettings') {
    handleExportSettings(sendResponse);
    return true;
  }

  if (request.action === 'importSettings') {
    handleImportSettings(request.settings, sendResponse);
    return true;
  }

});

/**
 * Check if a URL is blocked and if a timer is active
 */
function handleCheckIfBlocked(url, sendResponse) {
  try {
    const domain = extractDomain(url);

    getDailyLimitMinutes((dailyLimitMinutes) => {
      chrome.storage.local.get([
        BLOCKED_SITES_KEY,
        ACTIVE_TIMERS_KEY,
        DAILY_LIMIT_KEY,
        DAILY_LIMIT_DATE_KEY,
        WORKING_HOURS_KEY,
        FOCUS_MODE_ACTIVE_KEY,
        FOCUS_MODE_WHITELIST_KEY
      ], (result) => {
        const blockedSites = result[BLOCKED_SITES_KEY] || [];
        const activeTimers = result[ACTIVE_TIMERS_KEY] || {};
        const workingHours = result[WORKING_HOURS_KEY] || {};
        const focusModeActive = result[FOCUS_MODE_ACTIVE_KEY] || false;
        const whitelist = result[FOCUS_MODE_WHITELIST_KEY] || [];

        // Check if within working hours
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const startHour = workingHours.startHour || 9;
        const startMinute = workingHours.startMinute || 0;
        const endHour = workingHours.endHour || 17;
        const endMinute = workingHours.endMinute || 0;

        const currentTime = currentHour * 60 + currentMinute;
        const startTime = startHour * 60 + startMinute;
        const endTime = endHour * 60 + endMinute;
        const isWithinWorkingHours = currentTime >= startTime && currentTime <= endTime;

        // Check for active timer first (highest priority - if granted access, always allow)
        const timerData = activeTimers[domain];
        const isTimerActive = timerData && timerData.expiresAt > Date.now();

        if (isTimerActive) {
          // Timer is active - allow access regardless of mode
          sendResponse({
            isBlocked: false,
            hasActiveTimer: true,
            timeRemaining: Math.max(0, timerData.expiresAt - Date.now()),
            dailyLimitRemaining: dailyLimitMinutes,
            focusMode: focusModeActive
          });
          return;
        }

        // UNIVERSAL WHITELIST: Check if site is whitelisted (never block whitelisted sites)
        const isWhitelisted = whitelist.some(site => {
          return domain.includes(site.replace('www.', ''));
        });

        if (isWhitelisted) {
          // Site is whitelisted - never block it
          sendResponse({
            isBlocked: false,
            hasActiveTimer: false,
            dailyLimitRemaining: dailyLimitMinutes,
            focusMode: focusModeActive
          });
          return;
        }

        // Focus Mode logic: block all sites except whitelist
        if (focusModeActive) {
          // Site is NOT whitelisted and Focus Mode is active - block it
          sendResponse({
            isBlocked: true,
            hasActiveTimer: false,
            timeRemaining: 0,
            dailyLimitUsed: 0,
            dailyLimitRemaining: dailyLimitMinutes,
            focusMode: true
          });
          return;
        }

        // Check if domain is in blocked list
        const isDomainBlocked = blockedSites.some(site => {
          return domain.includes(site.replace('www.', ''));
        });

        // Only block if domain is blocked AND within working hours
        if (isDomainBlocked && isWithinWorkingHours) {
          // Get daily limit info
          const dailyLimitUsed = getDailyLimitUsed(result[DAILY_LIMIT_KEY], result[DAILY_LIMIT_DATE_KEY]);
          const dailyLimitRemaining = Math.max(0, dailyLimitMinutes - dailyLimitUsed);

          sendResponse({
            isBlocked: true,
            hasActiveTimer: false,
            timeRemaining: 0,
            dailyLimitUsed,
            dailyLimitRemaining,
            focusMode: false
          });
        } else {
          // Outside working hours or not in blocked list - allow access
          sendResponse({
            isBlocked: false,
            hasActiveTimer: false,
            dailyLimitRemaining: dailyLimitMinutes,
            focusMode: false
          });
        }
      });
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
  getDailyLimitMinutes((dailyLimitMinutes) => {
    chrome.storage.local.get([DAILY_LIMIT_KEY, DAILY_LIMIT_DATE_KEY, WORKING_HOURS_KEY], (result) => {
      const dailyLimitUsed = getDailyLimitUsed(result[DAILY_LIMIT_KEY], result[DAILY_LIMIT_DATE_KEY]);
      const workingHours = result[WORKING_HOURS_KEY] || {};

      // Check if within working hours
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const startHour = workingHours.startHour || 9;
      const startMinute = workingHours.startMinute || 0;
      const endHour = workingHours.endHour || 17;
      const endMinute = workingHours.endMinute || 0;

      const currentTime = currentHour * 60 + currentMinute;
      const startTime = startHour * 60 + startMinute;
      const endTime = endHour * 60 + endMinute;
      const isWithinWorkingHours = currentTime >= startTime && currentTime <= endTime;

      // Check if daily limit would be exceeded
      const wouldExceedLimit = dailyLimitUsed + durationMinutes > dailyLimitMinutes;

      if (wouldExceedLimit) {
        sendResponse({
          success: false,
          error: `Daily limit exceeded. Used: ${dailyLimitUsed}min/${dailyLimitMinutes}min`,
          dailyLimitUsed,
          wouldExceedLimit: true
        });
        return;
      }

      if (!isWithinWorkingHours) {
        sendResponse({
          success: false,
          error: 'Override available only during working hours',
          isOutsideWorkingHours: true
        });
        return;
      }

      const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
      const today = new Date().toDateString();

      chrome.storage.local.get([ACTIVE_TIMERS_KEY], (timerResult) => {
        const activeTimers = timerResult[ACTIVE_TIMERS_KEY] || {};
        activeTimers[domain] = { expiresAt, durationMinutes };

        // Update daily limit
        const newDailyLimitUsed = dailyLimitUsed + durationMinutes;

        chrome.storage.local.set({
          [ACTIVE_TIMERS_KEY]: activeTimers,
          [DAILY_LIMIT_KEY]: newDailyLimitUsed,
          [DAILY_LIMIT_DATE_KEY]: today
        }, () => {
          sendResponse({
            success: true,
            dailyLimitUsed: newDailyLimitUsed,
            dailyLimitRemaining: dailyLimitMinutes - newDailyLimitUsed
          });
        });
      });
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

/**
 * Get working hours
 */
function handleGetWorkingHours(sendResponse) {
  chrome.storage.local.get([WORKING_HOURS_KEY], (result) => {
    sendResponse({
      workingHours: result[WORKING_HOURS_KEY] || {
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0
      }
    });
  });
}

/**
 * Set working hours
 */
function handleSetWorkingHours(workingHours, sendResponse) {
  chrome.storage.local.set({
    [WORKING_HOURS_KEY]: workingHours
  }, () => {
    sendResponse({ success: true, workingHours });
  });
}

/**
 * Get daily limit usage
 */
function handleGetDailyLimit(sendResponse) {
  getDailyLimitMinutes((dailyLimitMinutes) => {
    chrome.storage.local.get([DAILY_LIMIT_KEY, DAILY_LIMIT_DATE_KEY], (result) => {
      const dailyLimitUsed = getDailyLimitUsed(result[DAILY_LIMIT_KEY], result[DAILY_LIMIT_DATE_KEY]);
      sendResponse({
        dailyLimitUsed,
        dailyLimitRemaining: dailyLimitMinutes - dailyLimitUsed,
        dailyLimitTotal: dailyLimitMinutes
      });
    });
  });
}

/**
 * Set custom daily limit
 */
function handleSetCustomDailyLimit(limit, sendResponse) {
  chrome.storage.local.set({ [CUSTOM_DAILY_LIMIT_KEY]: limit }, () => {
    sendResponse({ success: true, limit });
  });
}

/**
 * Calculate daily limit usage (resets at midnight)
 */
function getDailyLimitUsed(dailyLimitUsed, lastDate) {
  const today = new Date().toDateString();

  // If date changed, reset the counter
  if (lastDate !== today) {
    return 0;
  }

  return dailyLimitUsed || 0;
}

// ============================================
// TAB TRACKING AND STATS
// ============================================

/**
 * Start tracking a session for a domain
 */
function startTrackingSession(domain, tabId) {
  // Skip internal browser pages
  if (!domain || domain.includes('chrome://') || domain.includes('chrome-extension://')) {
    return;
  }

  // End any existing session for this domain
  if (activeSessions[domain]) {
    endTrackingSession(domain);
  }

  chrome.storage.local.get([WORKING_HOURS_KEY], (result) => {
    const workingHours = result[WORKING_HOURS_KEY] || {};
    const currentlyWorkingHours = isWithinWorkingHours(workingHours);

    activeSessions[domain] = {
      tabId,
      startTime: Date.now(),
      isWorkingHours: currentlyWorkingHours
    };
  });
}

/**
 * End tracking session and save to stats
 */
function endTrackingSession(domain) {
  const session = activeSessions[domain];
  if (!session) return;

  const durationMs = Date.now() - session.startTime;
  delete activeSessions[domain];

  // Only save if duration is meaningful (> 1 second)
  if (durationMs > 1000) {
    saveToStats(domain, durationMs, session.isWorkingHours);
  }
}

/**
 * Save time spent to stats storage
 */
function saveToStats(domain, durationMs, wasWorkingHours) {
  chrome.storage.local.get([SITE_STATS_KEY], (result) => {
    const stats = result[SITE_STATS_KEY] || {};
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    if (!stats[domain]) {
      stats[domain] = {
        totalTimeMs: 0,
        totalVisits: 0,
        dailyData: {}
      };
    }

    // Update totals
    stats[domain].totalTimeMs += durationMs;
    stats[domain].totalVisits += 1;

    // Update daily data
    if (!stats[domain].dailyData[today]) {
      stats[domain].dailyData[today] = {
        timeMs: 0,
        visits: 0,
        workTimeMs: 0
      };
    }

    stats[domain].dailyData[today].timeMs += durationMs;
    stats[domain].dailyData[today].visits += 1;
    if (wasWorkingHours) {
      stats[domain].dailyData[today].workTimeMs += durationMs;
    }

    // Clean up old data (keep only 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    Object.keys(stats[domain].dailyData).forEach(date => {
      if (date < cutoffDate) {
        delete stats[domain].dailyData[date];
      }
    });

    chrome.storage.local.set({ [SITE_STATS_KEY]: stats });
  });
}

/**
 * Handle getting stats for popup
 */
function handleGetStats(period, sendResponse) {
  chrome.storage.local.get([SITE_STATS_KEY], (result) => {
    const stats = result[SITE_STATS_KEY] || {};
    const today = new Date().toISOString().split('T')[0];

    let dateRange = [today];
    if (period === 'week') {
      dateRange = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dateRange.push(date.toISOString().split('T')[0]);
      }
    }

    const aggregated = {
      totalTimeMs: 0,
      totalVisits: 0,
      workTimeMs: 0,
      offTimeMs: 0,
      sites: []
    };

    Object.entries(stats).forEach(([domain, siteData]) => {
      let siteTimeMs = 0;
      let siteVisits = 0;
      let siteWorkTimeMs = 0;

      dateRange.forEach(date => {
        const dayData = siteData.dailyData[date];
        if (dayData) {
          siteTimeMs += dayData.timeMs;
          siteVisits += dayData.visits;
          siteWorkTimeMs += dayData.workTimeMs;
        }
      });

      if (siteTimeMs > 0) {
        aggregated.totalTimeMs += siteTimeMs;
        aggregated.totalVisits += siteVisits;
        aggregated.workTimeMs += siteWorkTimeMs;
        aggregated.offTimeMs += (siteTimeMs - siteWorkTimeMs);

        aggregated.sites.push({
          domain,
          timeMs: siteTimeMs,
          visits: siteVisits,
          workTimeMs: siteWorkTimeMs
        });
      }
    });

    // Sort sites by time spent (descending)
    aggregated.sites.sort((a, b) => b.timeMs - a.timeMs);

    sendResponse({ stats: aggregated });
  });
}

/**
 * Clear all stats
 */
function handleClearStats(sendResponse) {
  chrome.storage.local.set({ [SITE_STATS_KEY]: {} }, () => {
    sendResponse({ success: true });
  });
}

/**
 * Handle visibility change from content script
 */
function handleTabVisibilityChanged(isVisible, domain, tabId, sendResponse) {
  if (isVisible && domain) {
    startTrackingSession(domain, tabId);
  } else if (!isVisible && domain) {
    endTrackingSession(domain);
  }
  sendResponse({ success: true });
}

// Tab activated - start tracking new tab, end tracking old tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  // End all current sessions
  Object.keys(activeSessions).forEach(domain => {
    endTrackingSession(domain);
  });

  // Start tracking new tab
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    const domain = extractDomain(tab.url);
    if (domain) {
      startTrackingSession(domain, activeInfo.tabId);
    }
  });
});

// Tab URL changed - may need to switch tracking
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url) {
    const newDomain = extractDomain(tab.url);

    // Find if this tab had a previous session and end it
    Object.entries(activeSessions).forEach(([domain, session]) => {
      if (session.tabId === tabId && domain !== newDomain) {
        endTrackingSession(domain);
      }
    });

    // Start tracking new domain if different
    if (newDomain && !activeSessions[newDomain]) {
      startTrackingSession(newDomain, tabId);
    }
  }
});

// Tab closed - end tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  Object.entries(activeSessions).forEach(([domain, session]) => {
    if (session.tabId === tabId) {
      endTrackingSession(domain);
    }
  });
});

// Window focus changed - pause/resume tracking
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus - end all sessions
    Object.keys(activeSessions).forEach(domain => {
      endTrackingSession(domain);
    });
  } else {
    // Browser gained focus - start tracking active tab
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const domain = extractDomain(tabs[0].url);
        if (domain) {
          startTrackingSession(domain, tabs[0].id);
        }
      }
    });
  }
});

// ============================================
// FOCUS MODE HANDLERS
// ============================================

/**
 * Handle keyboard command to toggle Focus Mode
 */
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-focus-mode') {
    handleToggleFocusMode((response) => {
      if (response.success) {
        // Show notification
        const message = response.focusModeActive
          ? 'Focus Mode activated'
          : 'Focus Mode deactivated';

        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">🎯</text></svg>',
          title: 'Site Blocker',
          message: message
        });
      }
    });
  }
});

/**
 * Get Focus Mode status
 */
function handleGetFocusMode(sendResponse) {
  chrome.storage.local.get([FOCUS_MODE_ACTIVE_KEY, FOCUS_MODE_WHITELIST_KEY], (result) => {
    sendResponse({
      focusModeActive: result[FOCUS_MODE_ACTIVE_KEY] || false,
      whitelist: result[FOCUS_MODE_WHITELIST_KEY] || []
    });
  });
}

/**
 * Toggle Focus Mode on/off
 */
function handleToggleFocusMode(sendResponse) {
  chrome.storage.local.get([FOCUS_MODE_ACTIVE_KEY], (result) => {
    const newState = !result[FOCUS_MODE_ACTIVE_KEY];
    chrome.storage.local.set({ [FOCUS_MODE_ACTIVE_KEY]: newState }, () => {
      sendResponse({
        success: true,
        focusModeActive: newState
      });
    });
  });
}

/**
 * Add domain to Focus Mode whitelist
 */
function handleAddToWhitelist(domain, sendResponse) {
  chrome.storage.local.get([FOCUS_MODE_WHITELIST_KEY], (result) => {
    const whitelist = result[FOCUS_MODE_WHITELIST_KEY] || [];
    const cleanDomain = domain.replace('www.', '').toLowerCase();

    if (!whitelist.includes(cleanDomain)) {
      whitelist.push(cleanDomain);
      chrome.storage.local.set({ [FOCUS_MODE_WHITELIST_KEY]: whitelist }, () => {
        sendResponse({ success: true, whitelist });
      });
    } else {
      sendResponse({ success: false, message: 'Domain already in whitelist' });
    }
  });
}

/**
 * Remove domain from Focus Mode whitelist
 */
function handleRemoveFromWhitelist(domain, sendResponse) {
  chrome.storage.local.get([FOCUS_MODE_WHITELIST_KEY], (result) => {
    let whitelist = result[FOCUS_MODE_WHITELIST_KEY] || [];
    const cleanDomain = domain.replace('www.', '').toLowerCase();
    whitelist = whitelist.filter(site => site !== cleanDomain);

    chrome.storage.local.set({ [FOCUS_MODE_WHITELIST_KEY]: whitelist }, () => {
      sendResponse({ success: true, whitelist });
    });
  });
}

// ============================================
// CUSTOM BLOCK MESSAGE HANDLERS
// ============================================

/**
 * Get custom block message setting
 */
function handleGetCustomMessage(sendResponse) {
  chrome.storage.local.get([CUSTOM_BLOCK_MESSAGE_KEY], (result) => {
    sendResponse({ message: result[CUSTOM_BLOCK_MESSAGE_KEY] || '' });
  });
}

/**
 * Set custom block message
 */
function handleSetCustomMessage(message, sendResponse) {
  chrome.storage.local.set({ [CUSTOM_BLOCK_MESSAGE_KEY]: message }, () => {
    sendResponse({ success: true });
  });
}

/**
 * Get the message to display on the block page.
 * If custom message is set, return it. Otherwise fetch top HN article.
 */
function handleGetBlockMessage(sendResponse) {
  chrome.storage.local.get([CUSTOM_BLOCK_MESSAGE_KEY, HN_CACHE_KEY], (result) => {
    const customMessage = result[CUSTOM_BLOCK_MESSAGE_KEY] || '';

    if (customMessage) {
      sendResponse({ type: 'custom', text: customMessage });
      return;
    }

    // Check cache (valid for 1 minute to allow variety while preventing API spam)
    const cache = result[HN_CACHE_KEY];
    if (cache && cache.timestamp && (Date.now() - cache.timestamp < 1 * 60 * 1000)) {
      sendResponse({ type: 'hn', title: cache.title, url: cache.url });
      return;
    }

    // Fetch top HN article
    fetchTopHNArticle()
      .then((article) => {
        chrome.storage.local.set({
          [HN_CACHE_KEY]: { title: article.title, url: article.url, timestamp: Date.now() }
        });
        sendResponse({ type: 'hn', title: article.title, url: article.url });
      })
      .catch(() => {
        sendResponse({ type: 'hn', title: 'Check out Hacker News for something productive', url: 'https://news.ycombinator.com' });
      });
  });
}

/**
 * Fetch a random article from top 10 trending stories on Hacker News
 */
async function fetchTopHNArticle() {
  const topStoriesRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const topStories = await topStoriesRes.json();

  // Pick a random story from top 10
  const randomIndex = Math.floor(Math.random() * Math.min(10, topStories.length));
  const randomId = topStories[randomIndex];

  const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${randomId}.json`);
  const story = await storyRes.json();

  return {
    title: story.title,
    url: story.url || `https://news.ycombinator.com/item?id=${story.id}`
  };
}

// ============================================
// EXPORT/IMPORT SETTINGS HANDLERS
// ============================================

/**
 * Export all settings to JSON
 */
function handleExportSettings(sendResponse) {
  const keys = [
    BLOCKED_SITES_KEY,
    FOCUS_MODE_WHITELIST_KEY,
    WORKING_HOURS_KEY,
    CUSTOM_DAILY_LIMIT_KEY,
    CUSTOM_BLOCK_MESSAGE_KEY,
    'theme'
  ];

  chrome.storage.local.get(keys, (result) => {
    const settings = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      blockedSites: result[BLOCKED_SITES_KEY] || [],
      focusModeWhitelist: result[FOCUS_MODE_WHITELIST_KEY] || [],
      workingHours: result[WORKING_HOURS_KEY] || {
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0
      },
      customDailyLimit: result[CUSTOM_DAILY_LIMIT_KEY] || DEFAULT_DAILY_LIMIT_MINUTES,
      customBlockMessage: result[CUSTOM_BLOCK_MESSAGE_KEY] || '',
      theme: result.theme || 'auto'
    };

    sendResponse({ success: true, settings });
  });
}

/**
 * Import settings from JSON
 */
function handleImportSettings(settings, sendResponse) {
  try {
    // Validate settings object
    if (!settings || typeof settings !== 'object') {
      sendResponse({ success: false, error: 'Invalid settings format' });
      return;
    }

    // Prepare data to import (with defaults)
    const dataToImport = {
      [BLOCKED_SITES_KEY]: Array.isArray(settings.blockedSites) ? settings.blockedSites : [],
      [FOCUS_MODE_WHITELIST_KEY]: Array.isArray(settings.focusModeWhitelist) ? settings.focusModeWhitelist : [],
      [WORKING_HOURS_KEY]: settings.workingHours || {
        startHour: 9,
        startMinute: 0,
        endHour: 17,
        endMinute: 0
      },
      [CUSTOM_DAILY_LIMIT_KEY]: typeof settings.customDailyLimit === 'number'
        ? settings.customDailyLimit
        : DEFAULT_DAILY_LIMIT_MINUTES,
      [CUSTOM_BLOCK_MESSAGE_KEY]: settings.customBlockMessage || '',
      theme: settings.theme || 'auto'
    };

    // Save all settings
    chrome.storage.local.set(dataToImport, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
