# Bynder Filter URL Generator - Chrome Extension

A Chrome extension that automatically detects active filters on Bynder portal pages and generates shareable URLs, eliminating the need for manual input.

## Features

- **Automatic Filter Detection**: Automatically reads active filters from Bynder portal pages
- **Smart URL Generation**: Creates shareable URLs using the same logic as your existing tool
- **Real-time Updates**: Detects filter changes as you navigate and modify filters
- **One-click Copying**: Easy copy-to-clipboard functionality with visual feedback
- **Multiple Filter Types**: Supports metaproperties, tags, search terms, and status filters

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" and select this `chrome-extension` folder
4. The extension icon will appear in your Chrome toolbar

## Usage

1. Navigate to any Bynder portal page (e.g., `yourcompany.bynder.com`)
2. Apply the filters you want to share (metaproperties, tags, search terms, etc.)
3. Click the extension icon in your Chrome toolbar
4. The extension will automatically detect your active filters
5. Copy the generated URL to share with others

## Supported Filter Types

- **Metaproperties**: Custom metadata fields and their selected values
- **Tags**: Selected tag filters
- **Search Terms**: Text search queries
- **Status Filters**: Watermark, archive, public, active, etc.
- **Date Filters**: Recently added assets (yesterday, last week)

## Files

- `manifest.json` - Extension configuration and permissions
- `popup.html/js/css` - User interface for the extension popup
- `content.js` - Script that analyzes Bynder pages for active filters
- `background.js` - Service worker for tab management and messaging
- `bynder-logo-blue.svg` - Bynder logo for the interface
- `icons/` - Directory for extension icons (PNG files needed)

## Icon Requirements

To complete the extension, you'll need to add PNG icons to the `icons/` directory:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels) 
- `icon128.png` (128x128 pixels)

You can create these from the included `bynder-logo-blue.svg` file.

## Technical Details

The extension uses:
- **Manifest V3** for modern Chrome extension standards
- **Content Scripts** to analyze Bynder's DOM structure
- **MutationObserver** for real-time filter change detection
- **Chrome Storage API** for filter history (optional)

## Notes

- This extension only works on Bynder portal pages (`*.bynder.com`)
- Generated URLs use the same parameter format as your existing web tool
- The extension will automatically enable/disable based on the current page
- Filter detection adapts to Bynder's dynamic interface loading