# Insta Lite

A userscript that strips Instagram's website down to your feed, search and DMs.
No app to build and no server: it runs inside the browser on top of
instagram.com, the same way an ad blocker does.

## What it does

The Explore grid is always hidden. The Search button stays and opens just the
search bar, since Instagram's Search lives on the Explore page.

Everything else is a toggle in the `CONFIG` block at the top of
`insta-lite.user.js`.

| Option | Default | Effect |
|---|---|---|
| `hideReels` | on | Hides the Reels tab and sends the `/reels/` feed back home |
| `hideSponsored` | on | Hides ads in the feed |
| `hideSuggested` | on | Hides "Suggested for you" posts |
| `hideFeedReels` | off | Also hides reels from accounts you follow |
| `lockReels` | on | Shows only the reel you opened (e.g. from a DM), with no swiping into more reels |
| `debug` | off | Outlines what would be hidden in red instead of hiding it |

Ad and suggested-post detection matches on English labels, so Instagram needs
to be set to English.

## Install on iPhone

Uses **Userscripts** (by Justin Wasack, on the App Store), a free, open-source
Safari extension. Chrome on iOS can't run extensions.

1. Install **Userscripts** from the App Store and open it once.
2. Go to **Settings → Apps → Safari → Extensions → Userscripts**, turn it on,
   and allow it on `instagram.com` and `raw.githubusercontent.com`
   (or All Websites).
3. In Safari, open
   <https://raw.githubusercontent.com/dom-schulz/insta-lite/main/insta-lite.user.js>
4. Tap the puzzle icon in the address bar → **Userscripts** → **Install**.
5. Open instagram.com in Safari and log in.

### Home screen icon

Don't use Safari's **Add to Home Screen**: Safari extensions don't run in pages
opened from those icons, so you'd get regular Instagram. Instead:

1. Open the **Shortcuts** app and create a new shortcut.
2. Add an **Open URLs** action set to `https://www.instagram.com/`.
3. Name it, then **Share → Add to Home Screen**.

It opens Instagram in Safari, where the script runs.

## Develop on desktop

Test changes on desktop first; it's much faster with dev tools.

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Chrome only: at `chrome://extensions`, open Tampermonkey's **Details** and
   turn on **Allow User Scripts**.
3. Tampermonkey icon → **Create a new script**, replace the template with
   `insta-lite.user.js`, and save with Ctrl+S.
4. Set `debug: true`, open instagram.com, and check what gets outlined. Each
   match is also logged in the console as `[insta-lite] hid ...`.
5. Press F12 → Ctrl+Shift+M and pick an iPhone to preview the phone layout.

Instagram's class names are obfuscated and change often, so the script matches
on link hrefs and visible text instead. When something slips through, inspect
the element and look for a stable href, `aria-label` or label text to key off.

## Ship an update

1. Edit `insta-lite.user.js` and raise `@version` in the header. The app only
   installs an update when the version goes up.
2. Commit and push to `main`.
3. On the phone, the Userscripts app picks up the new version when it checks
   for updates, via the `@updateURL` in the header. To update right away,
   reopen the raw link above and install again.
