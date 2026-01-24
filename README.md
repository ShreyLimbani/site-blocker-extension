# Site Blocker Extension

A Chrome extension that helps you stay focused by blocking distracting websites with a customizable timer override.

## Features

- 🚫 **Block websites** - Add domains you want to block
- ⏱️ **Temporary access** - Grant yourself 5-10 minutes of access when needed
- 💾 **Persistent storage** - Your blocked sites list persists across browser restarts
- 🎨 **Beautiful UI** - Modern, gradient-based blocking overlay with countdown timer
- ⚡ **Lightweight** - Minimal performance impact using modern Chrome APIs

## Installation

### Development Mode

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `site-blocker-extension` folder
6. The extension will appear in your extensions list

### Using the Extension

1. Click the extension icon in your Chrome toolbar
2. Enter a domain (e.g., `facebook.com`, `reddit.com`)
3. Click "Add" to block that site
4. When you visit a blocked site, you'll see a blocking overlay
5. Click "5 minutes" or "10 minutes" to grant temporary access
6. The timer will start and the page will load
7. Once the timer expires, the site is blocked again

## Project Structure

```
site-blocker-extension/
├── manifest.json          # Extension configuration
├── background.js          # Service worker - manages state and timers
├── content-script.js      # Injected into pages - shows blocking UI
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality and site management
├── popup.css             # Popup styling
└── README.md             # This file
```

## How It Works

### Architecture

The extension uses a **hybrid approach** with three main components:

1. **Service Worker (`background.js`)**
   - Manages the list of blocked sites (stored in `chrome.storage.local`)
   - Handles timer logic for temporary access
   - Uses `chrome.alarms` API to clean up expired timers
   - Communicates with content scripts via message passing

2. **Content Script (`content-script.js`)**
   - Runs on every page load
   - Checks if the current domain is blocked
   - Communicates with service worker to check timer status
   - Shows the blocking overlay if site is blocked and no timer is active
   - Displays countdown timer if timer is active

3. **Popup UI (`popup.html`, `popup.js`, `popup.css`)**
   - Allows users to add/remove blocked sites
   - Real-time management of the blocked sites list
   - User-friendly interface with validation

### Data Flow

```
User clicks "Add site" in Popup
    ↓
popup.js sends message to background.js
    ↓
background.js stores domain in chrome.storage.local
    ↓
User visits blocked site
    ↓
content-script.js runs on page load
    ↓
Sends message to background.js: "Is this site blocked?"
    ↓
background.js checks storage and timer status
    ↓
If blocked: Shows overlay with timer buttons
If timer active: Shows countdown
    ↓
User clicks timer button → background.js starts timer
    ↓
Timer expires → content-script detects and blocks site again
```

## Configuration

The default blocked sites (on first install) are:
- `facebook.com`
- `twitter.com`
- `reddit.com`

You can modify these in `background.js` line 8-12.

### Timer Durations

The default timer duration is 5 minutes. You can customize it:

- **Change default**: Edit `DEFAULT_TIMER_DURATION` in `background.js`
- **Change options**: Edit button data attributes in `content-script.js`

## Customization

### Change Blocking Overlay Colors

Edit the gradient colors in `content-script.js` lines 145-146:

```javascript
.blocker-content {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
```

### Add More Timer Options

In `content-script.js`, add more buttons in the `timer-options` div:

```html
<button class="timer-btn" data-minutes="15">15 minutes</button>
```

### Disable Timer Countdown Display

Remove or comment out the timer overlay section in `content-script.js` (lines 99-117).

## Permissions Explained

- `storage` - To save your blocked sites list
- `tabs` - To track current tab (for potential future features)
- `webRequest` - For URL monitoring (manifest v3 compatible)
- `<all_urls>` - Allows the content script to run on all websites

## Troubleshooting

### Sites aren't blocking
1. Check the blocked sites list in the popup
2. Ensure domain is entered correctly (without `https://` or `www.`)
3. Try reloading the blocked site

### Timer not working
1. Check browser console (F12) for errors
2. Ensure you have the latest Chrome version
3. Try reloading the extension from `chrome://extensions/`

### Overlay not showing
1. The page might need to be reloaded after adding to blocked list
2. Try clearing browser cache
3. Check if JavaScript is enabled for that site

## Future Enhancements

- [ ] Time-based blocking (block sites during work hours only)
- [ ] Statistics dashboard (time spent on blocked sites)
- [ ] Custom messages/motivation quotes
- [ ] Whitelist specific pages on blocked domains
- [ ] Browser sync across devices
- [ ] Dark mode
- [ ] Keyboard shortcuts

## License

MIT License - Feel free to use and modify!

## Support

If you encounter issues or have feature requests, you can:
1. Check the troubleshooting section above
2. Review the code comments for implementation details
3. Inspect the browser console for error messages
