// Service Worker - Manages blocked sites, timers, and state
const BLOCKED_SITES_KEY = 'blockedSites';
const ACTIVE_TIMERS_KEY = 'activeTimers';
const DAILY_LIMIT_KEY = 'dailyLimitUsed';
const DAILY_LIMIT_DATE_KEY = 'dailyLimitDate';
const WORKING_HOURS_KEY = 'workingHours';
const DEFAULT_TIMER_DURATION = 5; // 5 minutes in minutes
const DAILY_LIMIT_MINUTES = 60; // 60 minutes per day

// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([BLOCKED_SITES_KEY, WORKING_HOURS_KEY], (result) => {
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
  

});

/**
 * Check if a URL is blocked and if a timer is active
 */
function handleCheckIfBlocked(url, sendResponse) {
  try {
    const domain = extractDomain(url);
    
    chrome.storage.local.get([BLOCKED_SITES_KEY, ACTIVE_TIMERS_KEY, DAILY_LIMIT_KEY, DAILY_LIMIT_DATE_KEY, WORKING_HOURS_KEY], (result) => {
      const blockedSites = result[BLOCKED_SITES_KEY] || [];
      const activeTimers = result[ACTIVE_TIMERS_KEY] || {};
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
      
      // Check if domain is in blocked list
      const isDomainBlocked = blockedSites.some(site => {
        return domain.includes(site.replace('www.', ''));
      });
      
      // Only block if domain is blocked AND within working hours
      if (isDomainBlocked && isWithinWorkingHours) {
        const timerData = activeTimers[domain];
        const isTimerActive = timerData && timerData.expiresAt > Date.now();
        
        // Get daily limit info
        const dailyLimitUsed = getDailyLimitUsed(result[DAILY_LIMIT_KEY], result[DAILY_LIMIT_DATE_KEY]);
        const dailyLimitRemaining = Math.max(0, DAILY_LIMIT_MINUTES - dailyLimitUsed);
        
        sendResponse({
          isBlocked: true,
          hasActiveTimer: isTimerActive,
          timeRemaining: isTimerActive ? Math.max(0, timerData.expiresAt - Date.now()) : 0,
          dailyLimitUsed,
          dailyLimitRemaining
        });
      } else {
        // Outside working hours or not in blocked list - allow access
        sendResponse({
          isBlocked: false,
          hasActiveTimer: false,
          dailyLimitRemaining: DAILY_LIMIT_MINUTES
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
    const wouldExceedLimit = dailyLimitUsed + durationMinutes > DAILY_LIMIT_MINUTES;
    
    if (wouldExceedLimit) {
      sendResponse({
        success: false,
        error: `Daily limit exceeded. Used: ${dailyLimitUsed}min/${DAILY_LIMIT_MINUTES}min`,
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
          dailyLimitRemaining: DAILY_LIMIT_MINUTES - newDailyLimitUsed
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
  chrome.storage.local.get([DAILY_LIMIT_KEY, DAILY_LIMIT_DATE_KEY], (result) => {
    const dailyLimitUsed = getDailyLimitUsed(result[DAILY_LIMIT_KEY], result[DAILY_LIMIT_DATE_KEY]);
    sendResponse({
      dailyLimitUsed,
      dailyLimitRemaining: DAILY_LIMIT_MINUTES - dailyLimitUsed,
      dailyLimitTotal: DAILY_LIMIT_MINUTES
    });
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
