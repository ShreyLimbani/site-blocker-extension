// Content Script - Injects blocking UI and communicates with service worker

(function() {
  let mutationObserver = null;

  checkAndBlockIfNeeded();
  setInterval(checkAndBlockIfNeeded, 1000);
  setupTamperingDetection();
  setupVisibilityTracking();

  // Listen for theme and Focus Mode changes from popup
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.theme) {
      updateOverlayTheme();
    }
    // When Focus Mode is toggled, immediately re-check blocking status
    if (areaName === 'local' && changes.focusModeActive) {
      checkAndBlockIfNeeded();
    }
  });

  function checkAndBlockIfNeeded() {
    try {
      // Check if chrome runtime is still available
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        return;
      }

      const currentUrl = window.location.href;
      chrome.runtime.sendMessage(
        { action: 'checkIfBlocked', url: currentUrl },
        (response) => {
          // Check if extension context is still valid
          if (chrome.runtime.lastError) {
            return;
          }

          if (response && response.hasActiveTimer) {
            // Timer is active - show timer widget regardless of isBlocked
            showTimerOverlay(response.timeRemaining);
          } else if (response && response.isBlocked) {
            // Site is blocked without active timer - show blocking overlay
            showBlockingOverlay(response.focusMode);
          } else {
            // Site is not blocked - hide all overlays
            hideBlockingOverlay();
          }
        }
      );
    } catch (error) {
      // Silently ignore extension context invalidated errors
      if (error && error.message && error.message.includes('Extension context invalidated')) {
        return;
      }
    }
  }
  
  function showBlockingOverlay(isFocusMode = false) {
    try {
      let overlay = document.getElementById('site-blocker-overlay');

      // If overlay exists but mode changed, remove it and recreate
      if (overlay) {
        const existingIsFocusMode = overlay.getAttribute('data-focus-mode') === 'true';
        if (existingIsFocusMode !== isFocusMode) {
          hideBlockingOverlay();
          overlay = null;
        } else {
          return; // Same mode, keep existing overlay
        }
      }

      // Create a container for shadow DOM
      const container = document.createElement('div');
      container.id = 'site-blocker-overlay';
      container.setAttribute('data-focus-mode', isFocusMode.toString());

    // Attach shadow DOM for style isolation
    const shadowRoot = container.attachShadow({ mode: 'open' });

    // Customize message for Focus Mode
    const icon = isFocusMode ? '🎯' : '⛔';
    const title = isFocusMode ? 'Focus Mode Active' : 'Website Blocked';
    const subtitle = isFocusMode
      ? 'This website is not whitelisted. Add it to access anytime!'
      : "You've blocked this website to help you stay focused.";

    // Create the overlay HTML
    const overlayHTML = document.createElement('div');
    overlayHTML.className = 'blocker-overlay-wrapper';

    if (isFocusMode) {
      // Focus Mode: No timer option, but allow whitelisting
      overlayHTML.innerHTML = `
        <div class="blocker-card">
          <div class="blocker-header">
            <div class="blocker-icon">${icon}</div>
            <h1>${title}</h1>
            <p class="blocker-subtitle">${subtitle}</p>
          </div>

          <div class="blocker-body">
            <div class="custom-message-area" id="custom-message-area">
              <p class="custom-message-loading">Loading...</p>
            </div>
            <div class="focus-mode-message">
              <p class="focus-message-text">This site is not whitelisted</p>
              <p class="focus-message-description">Whitelisted sites are never blocked, even outside Focus Mode</p>
              <button class="whitelist-button" id="add-to-whitelist-btn">
                <span class="whitelist-icon">✅</span>
                Add to Whitelist
              </button>
              <div class="separator">
                <span class="separator-text">or</span>
              </div>
              <p class="focus-message-hint">Press Alt+Shift+F to disable Focus Mode</p>
            </div>
          </div>
        </div>
      `;
    } else {
      // Regular blocking: Show timer option
      overlayHTML.innerHTML = `
        <div class="blocker-card">
          <div class="blocker-header">
            <div class="blocker-icon">${icon}</div>
            <h1>${title}</h1>
            <p class="blocker-subtitle">${subtitle}</p>
          </div>

          <div class="blocker-body">
            <div class="custom-message-area" id="custom-message-area">
              <p class="custom-message-loading">Loading...</p>
            </div>
            <div class="timer-section">
              <label class="section-label">Grant Access For:</label>
              <div class="slider-container">
                <input type="range" id="duration-slider" class="duration-slider" min="1" max="10" value="5">
                <div class="slider-labels">
                  <span class="label-value">1 min</span>
                  <span class="label-value" id="slider-display">5 mins</span>
                  <span class="label-value">10 mins</span>
                </div>
              </div>
            </div>
          </div>

          <div class="blocker-footer">
            <button class="grant-button" id="grant-access-btn">Grant Access</button>
            <p class="disclaimer">Use this wisely. Stay focused! 💪</p>
          </div>
        </div>
      `;
    }

    shadowRoot.appendChild(overlayHTML);
    injectBlockerStyles(shadowRoot);
    applyOverlayTheme(shadowRoot);

    if (isFocusMode) {
      // Add whitelist button handler
      const whitelistBtn = shadowRoot.getElementById('add-to-whitelist-btn');
      if (whitelistBtn) {
        whitelistBtn.addEventListener('click', () => {
          addCurrentSiteToWhitelist(shadowRoot);
        });
      }
    } else {
      const slider = shadowRoot.getElementById('duration-slider');
      const display = shadowRoot.getElementById('slider-display');
      const grantBtn = shadowRoot.getElementById('grant-access-btn');

      // Update display value
      const updateDisplay = () => {
        const value = parseInt(slider.value);
        display.textContent = value === 1 ? '1 min' : `${value} mins`;
      };

      slider.addEventListener('input', updateDisplay);

      grantBtn.addEventListener('click', () => {
        const minutes = parseInt(slider.value);
        requestTemporaryAccess(minutes, container);
      });
    }

      document.documentElement.appendChild(container);

      // Set overflow hidden on body if it exists
      if (document.body) {
        document.body.style.overflow = 'hidden';
      }

      // Load and display custom message / HN article
      loadBlockMessage(shadowRoot);
    } catch (error) {
      console.error('Error showing blocking overlay:', error);
      // Try to clean up in case of error
      hideBlockingOverlay();
    }
  }

  function loadBlockMessage(shadowRoot) {
    try {
      if (!chrome.runtime || !chrome.runtime.sendMessage) return;

      chrome.runtime.sendMessage({ action: 'getBlockMessage' }, (response) => {
        if (chrome.runtime.lastError) return;

        const area = shadowRoot.getElementById('custom-message-area');
        if (!area) return;

        if (response && response.type === 'custom') {
          area.innerHTML = `
            <div class="custom-message-box">
              <p class="custom-message-text">${escapeOverlayHtml(response.text)}</p>
            </div>
          `;
        } else if (response && response.type === 'hn') {
          area.innerHTML = `
            <div class="hn-message-box">
              <div class="hn-label">📰 Top on Hacker News</div>
              <a class="hn-link" href="${escapeOverlayHtml(response.url)}" target="_blank" rel="noopener noreferrer">${escapeOverlayHtml(response.title)}</a>
              <p class="hn-hint">Read something productive instead!</p>
            </div>
          `;
        } else {
          area.innerHTML = '';
        }
      });
    } catch (error) {
      // Silently ignore
    }
  }

  function escapeOverlayHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function applyOverlayTheme(shadowRoot) {
    chrome.storage.local.get(['theme'], (result) => {
      let theme = result.theme || 'auto';
      if (theme === 'auto') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      const wrapper = shadowRoot.querySelector('.blocker-overlay-wrapper');
      if (wrapper) {
        wrapper.setAttribute('data-theme', theme);
      }

      const timerWrapper = shadowRoot.querySelector('.timer-wrapper');
      if (timerWrapper) {
        timerWrapper.setAttribute('data-theme', theme);
      }
    });
  }

  function updateOverlayTheme() {
    chrome.storage.local.get(['theme'], (result) => {
      let theme = result.theme || 'auto';
      if (theme === 'auto') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      // Update blocking overlay if present
      const overlay = document.getElementById('site-blocker-overlay');
      if (overlay && overlay.shadowRoot) {
        const wrapper = overlay.shadowRoot.querySelector('.blocker-overlay-wrapper');
        if (wrapper) {
          wrapper.setAttribute('data-theme', theme);
        }
      }

      // Update timer widget if present
      const widget = document.getElementById('site-blocker-timer-widget');
      if (widget && widget.shadowRoot) {
        const timerWrapper = widget.shadowRoot.querySelector('.timer-wrapper');
        if (timerWrapper) {
          timerWrapper.setAttribute('data-theme', theme);
        }
      }
    });
  }

  function showTimerOverlay(timeRemaining) {
    let widget = document.getElementById('site-blocker-timer-widget');

    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'site-blocker-timer-widget';

      // Attach shadow DOM for style isolation
      const shadowRoot = widget.attachShadow({ mode: 'open' });

      const timerHTML = document.createElement('div');
      timerHTML.className = 'timer-wrapper';
      timerHTML.innerHTML = `
        <div class="timer-card">
          <div class="timer-time" id="countdown-display">5:00</div>
          <div class="timer-label">Time remaining</div>
        </div>
      `;

      shadowRoot.appendChild(timerHTML);
      injectBlockerStyles(shadowRoot);
      applyOverlayTheme(shadowRoot);
      document.documentElement.appendChild(widget);
    }

    updateCountdownDisplay(timeRemaining);
  }
  
  function updateCountdownDisplay(timeRemaining) {
    const widget = document.getElementById('site-blocker-timer-widget');
    
    if (widget && widget.shadowRoot) {
      const display = widget.shadowRoot.getElementById('countdown-display');
      const wrapper = widget.shadowRoot.querySelector('.timer-wrapper');
      
      if (display) {
        const minutes = Math.floor(timeRemaining / 60000);
        const seconds = Math.floor((timeRemaining % 60000) / 1000);
        display.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        if (timeRemaining < 60000 && wrapper) {
          wrapper.classList.add('timer-warning');
        } else if (wrapper) {
          wrapper.classList.remove('timer-warning');
        }
      }
    }
  }
  
  function hideBlockingOverlay() {
    const overlay = document.getElementById('site-blocker-overlay');
    if (overlay) {
      overlay.remove();
      document.body.style.overflow = '';
    }
  }
  
  function setupTamperingDetection() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12' || 
          ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);
  }
  
  function requestTemporaryAccess(minutes, overlayContainer) {
    try {
      const domain = extractDomain(window.location.href);
      chrome.runtime.sendMessage(
        { action: 'startTimer', domain, durationMinutes: minutes },
        (response) => {
          if (chrome.runtime.lastError) return;
          
          if (response && response.success) {
            hideBlockingOverlay();
          } else if (response && response.error) {
            // Show error message
            showErrorMessage(response.error, overlayContainer);
          }
        }
      );
    } catch (error) {
      console.error('Error requesting temporary access:', error);
    }
  }
  
  function addCurrentSiteToWhitelist(shadowRoot) {
    try {
      const domain = extractDomain(window.location.href);
      const btn = shadowRoot.getElementById('add-to-whitelist-btn');

      // Disable button and show loading state
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="whitelist-icon">⏳</span>Adding...';
      }

      chrome.runtime.sendMessage(
        { action: 'addToWhitelist', domain },
        (response) => {
          if (chrome.runtime.lastError) return;

          if (response && response.success) {
            // Show success message
            if (btn) {
              btn.innerHTML = '<span class="whitelist-icon">✅</span>Added! Unblocking...';
              btn.classList.add('success');
            }
            // The overlay will disappear automatically within 1 second
            // as checkAndBlockIfNeeded runs every second
          } else {
            // Show error
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = '<span class="whitelist-icon">❌</span>Already in whitelist';
              btn.classList.add('error');
              setTimeout(() => {
                btn.innerHTML = '<span class="whitelist-icon">✅</span>Add to Whitelist';
                btn.classList.remove('error');
              }, 2000);
            }
          }
        }
      );
    } catch (error) {
      console.error('Error adding to whitelist:', error);
    }
  }

  function showErrorMessage(errorMsg, overlayContainer) {
    // Create error message overlay
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #ff6b6b;
      color: white;
      padding: 20px 30px;
      border-radius: 8px;
      z-index: 999997;
      font-family: 'Roboto', sans-serif;
      box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
      max-width: 300px;
      text-align: center;
    `;
    errorDiv.textContent = errorMsg;

    document.documentElement.appendChild(errorDiv);

    // Remove error message after 3 seconds
    setTimeout(() => {
      errorDiv.remove();
    }, 3000);
  }
  
  function setupVisibilityTracking() {
    const domain = extractDomain(window.location.href);

    // Send initial visibility state
    sendVisibilityChange(!document.hidden, domain);

    // Listen for visibility changes
    document.addEventListener('visibilitychange', () => {
      sendVisibilityChange(!document.hidden, domain);
    });
  }

  function sendVisibilityChange(isVisible, domain) {
    try {
      if (!chrome.runtime || !chrome.runtime.sendMessage) return;

      chrome.runtime.sendMessage({
        action: 'tabVisibilityChanged',
        isVisible,
        domain
      }, () => {
        // Ignore errors from disconnected context
        if (chrome.runtime.lastError) return;
      });
    } catch (error) {
      // Silently ignore extension context invalidated errors
    }
  }

  function extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return '';
    }
  }
  
  function injectBlockerStyles(shadowRoot) {
    if (shadowRoot && shadowRoot.getElementById('site-blocker-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'site-blocker-styles';
    styles.textContent = `
      * {
        box-sizing: border-box;
      }

      /* Light theme variables (default) */
      .blocker-overlay-wrapper,
      .timer-wrapper {
        --card-bg: #ffffff;
        --card-text: #333333;
        --text-muted: #5f6368;
        --slider-track: #e0e0e0;
        --timer-card-bg: #ffffff;
        --warning-bg: #fff3cd;
      }

      /* Dark theme variables */
      .blocker-overlay-wrapper[data-theme="dark"],
      .timer-wrapper[data-theme="dark"] {
        --card-bg: #1a1a2e;
        --card-text: #f0f0f0;
        --text-muted: #9ca3af;
        --slider-track: #4b5563;
        --timer-card-bg: #1e293b;
        --warning-bg: #422006;
      }

      .blocker-overlay-wrapper {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, rgba(66, 133, 244, 0.95) 0%, rgba(52, 73, 94, 0.95) 100%);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
        padding: 16px;
        margin: 0;
        border: none;
      }

      .blocker-card {
        background: var(--card-bg);
        border-radius: 16px;
        box-shadow: 0 11px 15px -7px rgba(0, 0, 0, 0.2), 0 24px 38px 3px rgba(0, 0, 0, 0.14), 0 9px 46px 8px rgba(0, 0, 0, 0.12);
        width: auto;
        max-width: 420px;
        min-width: 280px;
        overflow: hidden;
        padding: 0;
        margin: 0;
        border: none;
      }

      .blocker-header {
        background: linear-gradient(135deg, #4285f4 0%, #34495e 100%);
        color: white;
        padding: 40px 32px 24px;
        text-align: center;
        margin: 0;
      }

      .blocker-icon {
        font-size: 48px;
        margin-bottom: 16px;
        display: block;
      }

      .blocker-header h1 {
        font-size: 36px;
        font-weight: 600;
        margin: 0 0 12px 0;
        letter-spacing: 0.25px;
        color: white;
      }

      .blocker-subtitle {
        font-size: 16px;
        font-weight: 400;
        margin: 0;
        color: rgba(255, 255, 255, 0.95);
        line-height: 1.6;
      }

      .blocker-body {
        padding: 40px 32px;
        margin: 0;
        text-align: center;
        background: var(--card-bg);
      }

      .timer-section {
        margin-bottom: 24px;
      }

      .section-label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 20px;
        letter-spacing: 0.5px;
      }

      .button-group {
        display: flex;
        gap: 16px;
        justify-content: center;
        margin-bottom: 0;
      }

      .slider-container {
        position: relative;
        margin: 24px 0;
        padding: 16px 8px;
      }

      .duration-slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--slider-track);
        outline: none;
        -webkit-appearance: none;
        appearance: none;
        cursor: pointer;
      }

      .duration-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #4285f4;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(66, 133, 244, 0.4);
        transition: all 0.2s ease;
      }

      .duration-slider::-webkit-slider-thumb:hover {
        box-shadow: 0 2px 12px rgba(66, 133, 244, 0.6);
        transform: scale(1.1);
      }

      .duration-slider::-moz-range-thumb {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #4285f4;
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 8px rgba(66, 133, 244, 0.4);
        transition: all 0.2s ease;
      }

      .duration-slider::-moz-range-thumb:hover {
        box-shadow: 0 2px 12px rgba(66, 133, 244, 0.6);
        transform: scale(1.1);
      }

      .duration-slider::-moz-range-track {
        background: transparent;
        border: none;
      }

      .slider-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 12px;
        align-items: center;
      }

      .label-value {
        font-size: 12px;
        color: var(--text-muted);
        font-weight: 500;
        flex: 1;
        text-align: center;
      }

      .label-value:first-child {
        text-align: left;
      }

      .label-value:last-child {
        text-align: right;
      }

      #slider-display {
        color: #4285f4;
        font-weight: 700;
        font-size: 13px;
      }

      .time-button {
        flex: 1;
        padding: 14px 20px;
        border: 2px solid #4285f4;
        border-radius: 8px;
        background: var(--card-bg);
        color: #4285f4;
        font-size: 15px;
        font-weight: 700;
        font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
        cursor: pointer;
        transition: all 0.3s ease;
        outline: none;
        letter-spacing: 0.5px;
        max-width: 140px;
      }

      .time-button:hover {
        background: rgba(66, 133, 244, 0.08);
        box-shadow: 0 2px 8px rgba(66, 133, 244, 0.3);
      }

      .time-button:active {
        background: rgba(66, 133, 244, 0.15);
        box-shadow: 0 2px 12px rgba(66, 133, 244, 0.4);
      }

      .grant-button {
        width: 100%;
        padding: 14px 24px;
        background: #4285f4;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 700;
        font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 3px 5px rgba(66, 133, 244, 0.3);
        outline: none;
        letter-spacing: 0.5px;
      }

      .grant-button:hover {
        background: #3367d6;
        box-shadow: 0 4px 8px rgba(66, 133, 244, 0.4);
      }

      .grant-button:active {
        background: #2a56c6;
        box-shadow: 0 2px 4px rgba(66, 133, 244, 0.3);
      }

      .blocker-footer {
        padding: 0 32px 32px;
        margin: 0;
        text-align: center;
        background: var(--card-bg);
      }

      .disclaimer {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 16px;
        margin-bottom: 0;
        line-height: 1.6;
      }

      .timer-wrapper {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 999998;
        font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
      }

      .timer-card {
        background: var(--timer-card-bg);
        border-radius: 12px;
        padding: 20px 24px;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.25);
        min-width: 160px;
        text-align: center;
        transition: all 0.3s ease;
      }

      .timer-time {
        font-size: 48px;
        font-weight: 700;
        color: #4285f4;
        margin: 0;
        font-family: 'Roboto Mono', monospace;
        letter-spacing: 2px;
        line-height: 1;
      }

      .timer-label {
        font-size: 13px;
        color: var(--text-muted);
        margin-top: 12px;
        margin-bottom: 0;
        font-weight: 600;
        letter-spacing: 0.5px;
      }

      .timer-wrapper.timer-warning .timer-card {
        background: var(--warning-bg);
        border: 2px solid #ff6b6b;
      }

      .timer-wrapper.timer-warning .timer-time {
        color: #ff6b6b;
        animation: pulse-warning 1s ease-in-out infinite;
      }

      @keyframes pulse-warning {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.08); }
      }

      /* Custom Message Styles */
      .custom-message-area {
        margin-bottom: 20px;
      }

      .custom-message-loading {
        font-size: 13px;
        color: var(--text-muted);
        text-align: center;
        margin: 0;
      }

      .custom-message-box {
        padding: 16px 20px;
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%);
        border: 2px solid rgba(16, 185, 129, 0.3);
        border-radius: 10px;
        text-align: center;
      }

      .custom-message-text {
        font-size: 15px;
        font-weight: 500;
        color: var(--card-text);
        margin: 0;
        line-height: 1.5;
        white-space: pre-wrap;
      }

      .hn-message-box {
        padding: 16px 20px;
        background: linear-gradient(135deg, rgba(255, 102, 0, 0.08) 0%, rgba(255, 153, 0, 0.08) 100%);
        border: 2px solid rgba(255, 102, 0, 0.3);
        border-radius: 10px;
        text-align: center;
      }

      .hn-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #ff6600;
        margin-bottom: 8px;
      }

      .hn-link {
        display: block;
        font-size: 15px;
        font-weight: 600;
        color: var(--card-text);
        text-decoration: none;
        line-height: 1.4;
        margin-bottom: 8px;
        transition: color 0.2s ease;
      }

      .hn-link:hover {
        color: #ff6600;
        text-decoration: underline;
      }

      .hn-hint {
        font-size: 12px;
        color: var(--text-muted);
        margin: 0;
        font-style: italic;
      }

      /* Focus Mode Styles */
      .focus-mode-message {
        padding: 24px;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
        border: 2px solid rgba(102, 126, 234, 0.3);
        border-radius: 12px;
        text-align: center;
      }

      .focus-message-text {
        font-size: 16px;
        font-weight: 600;
        color: var(--card-text);
        margin: 0 0 8px 0;
        line-height: 1.5;
      }

      .focus-message-description {
        font-size: 13px;
        color: var(--text-muted);
        margin: 0 0 20px 0;
        line-height: 1.4;
      }

      .whitelist-button {
        width: 100%;
        padding: 14px 24px;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 700;
        font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 3px 5px rgba(16, 185, 129, 0.3);
        outline: none;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .whitelist-button:hover {
        background: linear-gradient(135deg, #059669 0%, #047857 100%);
        box-shadow: 0 4px 8px rgba(16, 185, 129, 0.4);
        transform: translateY(-1px);
      }

      .whitelist-button:active {
        transform: translateY(0);
        box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
      }

      .whitelist-button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        transform: none;
      }

      .whitelist-button.success {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      }

      .whitelist-button.error {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      }

      .whitelist-icon {
        font-size: 18px;
        line-height: 1;
      }

      .separator {
        display: flex;
        align-items: center;
        margin: 20px 0;
        color: var(--text-muted);
      }

      .separator::before,
      .separator::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--slider-track);
      }

      .separator-text {
        padding: 0 12px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .focus-message-hint {
        font-size: 13px;
        color: var(--text-muted);
        margin: 0;
        font-family: 'Courier New', monospace;
        background: rgba(66, 133, 244, 0.1);
        padding: 8px 12px;
        border-radius: 6px;
        display: inline-block;
      }
    `;

    if (shadowRoot) {
      shadowRoot.appendChild(styles);
    } else {
      document.head.appendChild(styles);
    }
  }
})();
