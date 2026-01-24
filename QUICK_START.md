# Quick Start Guide

## 1. Install the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Toggle **Developer mode** ON (top right corner)
3. Click **Load unpacked**
4. Navigate to your extension folder and select it
5. The extension should now appear in your extensions list

## 2. Test It Out

### Add a blocked site:
1. Click the extension icon (puzzle piece) in Chrome toolbar
2. Type a domain like `facebook.com`
3. Click "Add"
4. You should see it listed under "Blocked Websites"

### Test the blocking:
1. Open a new tab and navigate to the blocked site (e.g., facebook.com)
2. You should see a beautiful purple overlay with "Website Blocked"
3. Click "5 minutes" or "10 minutes"
4. The page should load and show a countdown timer
5. Once timer expires, the site will be blocked again

## 3. Debug/Development

### View console logs:
- **Background Script logs**: `chrome://extensions` → Find your extension → Click "background page"
- **Content Script logs**: Open DevTools (F12) on any blocked site

### Make changes:
1. Edit the code files
2. Go to `chrome://extensions`
3. Click the refresh icon ↻ on your extension
4. Changes take effect immediately

### Common edits:
- Change blocked sites: Edit array in `background.js` line 8
- Change timer duration: Edit `DEFAULT_TIMER_DURATION` in `background.js` line 10
- Change overlay colors: Edit CSS in `content-script.js` line 147

## 4. Next Steps

- Read [README.md](README.md) for detailed documentation
- Customize colors, durations, and messages to your preference
- Share with friends to help them stay focused!

## Keyboard Shortcuts (Future)

You can add keyboard shortcuts by adding to `manifest.json`:

```json
"commands": {
  "toggle-extension": {
    "suggested_key": {
      "default": "Ctrl+Shift+B"
    },
    "description": "Toggle extension on/off"
  }
}
```

Enjoy using Site Blocker! Stay focused! 💪
