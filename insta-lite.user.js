// ==UserScript==
// @name         Insta Lite
// @namespace    insta-lite
// @version      0.7.0
// @description  Strip Instagram down: no Reels, Explore, ads, or suggested posts.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @grant        none
// @inject-into  auto
// @downloadURL  https://raw.githubusercontent.com/dom-schulz/insta-lite/main/insta-lite.user.js
// @updateURL    https://raw.githubusercontent.com/dom-schulz/insta-lite/main/insta-lite.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    hideReels: true,       // Reels tab + /reels/ feed (single reels sent to you still open)
    hideSponsored: true,   // ads in the feed
    hideSuggested: true,   // "Suggested for you" posts and blocks
    hideFeedReels: false,  // reels that show up as normal posts in the home feed
    lockReels: true,       // open single reels (e.g. from DMs) as a post, no swiping to more
    debug: false,          // outline matches in red instead of hiding them
    showStats: true,       // badge with test toggles for diagnosing feed glitches (temporary)
  };

  const MARK = 'data-insta-lite';
  const LOCK = 'data-insta-lite-lock';
  const FEED = 'data-insta-lite-feed';
  const STATS = { hidPosts: 0 };

  // Parts of the script that can be switched off from the stats badge, to find
  // which one makes the phone feed glitch. Saved in localStorage.
  const PARTS = [
    'filter',  // drop ads and suggested posts from the feed data
    'hide',    // hide posts on the page
    'anchor',  // scroll anchoring off on the feed
    'lock',    // DM reel lock
    'scan',    // rescan on page changes (everything on-page)
  ];
  const OFF_KEY = 'insta-lite-off';
  let off = new Set();
  try { off = new Set((localStorage.getItem(OFF_KEY) || '').split(',').filter(Boolean)); } catch (e) {}
  const on = part => !CONFIG.showStats || !off.has(part);

  // Instagram's class names are obfuscated and change constantly, so everything
  // here keys off hrefs and visible text, which are far more stable.

  // The Search button links to /explore/, so Explore can't be removed from the
  // nav. Instead, the bare /explore/ grid is swapped for the search page.
  // Subpaths like /explore/tags/ and /explore/locations/ still work.
  const REDIRECTS = [];
  if (CONFIG.hideReels) REDIRECTS.push([/^\/reels\/?$/, '/']);
  REDIRECTS.push([/^\/explore\/?$/, '/explore/search/']);
  // The reel viewer lets you swipe into an endless reels feed; the post page
  // for the same shortcode plays just that one reel.
  if (CONFIG.lockReels) REDIRECTS.push([/^\/(?:[\w.]+\/)?reels?\/([\w-]+)\/?$/, '/p/$1/']);

  const SPONSORED_LABELS = ['Sponsored', 'Ad', 'Paid partnership'];
  const SUGGESTED_LABELS = ['Suggested for you', 'Suggested posts', 'Suggested reels'];

  // Ads and suggested posts are dropped from the feed data before Instagram
  // sees it, so they never take up space in the feed. Hiding them after they
  // render leaves the feed's height estimates wrong, which shows up as blank
  // screens and the page jumping around while scrolling. Each feed item has
  // exactly one of media (followed accounts), explore_story (suggested) or ad
  // set.
  //
  // The feed loads over XHR, so this patches what Instagram reads from
  // finished GraphQL requests, caching per request since it reads the
  // response more than once. It has to run in Instagram's own JavaScript, so
  // it's self-contained: it also gets injected into the page as source, and
  // reports its counts through attributes on <html>.
  function installFeedFilter(settings) {
    if (window.instaLiteFeedFilter) return;
    window.instaLiteFeedFilter = true;
    const FEED_KEY = 'xdt_api__v1__feed__timeline__connection';
    const root = document.documentElement;
    const count = (name, n) => { root.dataset[name] = (Number(root.dataset[name]) || 0) + n; };

    function keepFeedItem(node) {
      if (!node) return true;
      if (settings.hideSponsored && node.ad) return false;
      if (settings.hideSuggested && node.explore_story) return false;
      if (settings.hideFeedReels && node.media && node.media.product_type === 'clips') return false;
      return true;
    }

    // Responses can hold several JSON payloads, one per line.
    function filterFeedResponse(text) {
      if (!text.includes(FEED_KEY)) return text;
      return text.split('\n').map(line => {
        let json;
        try { json = JSON.parse(line); } catch (e) { return line; }
        const feed = json && json.data && json.data[FEED_KEY];
        if (!feed || !Array.isArray(feed.edges)) return line;
        const before = feed.edges.length;
        feed.edges = feed.edges.filter(edge => keepFeedItem(edge.node));
        count('instaLitePages', 1);
        count('instaLiteDropped', before - feed.edges.length);
        if (settings.debug) console.log('[insta-lite] dropped', before - feed.edges.length, 'feed items');
        return JSON.stringify(json);
      }).join('\n');
    }

    const proto = XMLHttpRequest.prototype;
    const open = proto.open;
    const responseText = Object.getOwnPropertyDescriptor(proto, 'responseText');
    const response = Object.getOwnPropertyDescriptor(proto, 'response');
    if (!responseText || !response) return;

    proto.open = function (method, url, ...rest) {
      this.instaLiteGraphql = /\/graphql\/query|\/api\/graphql/.test(String(url));
      return open.call(this, method, url, ...rest);
    };
    function filtered(xhr, raw) {
      if (!xhr.instaLiteGraphql || xhr.readyState !== 4 || typeof raw !== 'string') return raw;
      if (xhr.instaLiteRaw !== raw) {
        xhr.instaLiteRaw = raw;
        try { xhr.instaLiteFiltered = filterFeedResponse(raw); } catch (e) { xhr.instaLiteFiltered = raw; }
      }
      return xhr.instaLiteFiltered;
    }
    Object.defineProperty(proto, 'responseText', {
      configurable: true,
      get() { return filtered(this, responseText.get.call(this)); },
    });
    Object.defineProperty(proto, 'response', {
      configurable: true,
      get() { return filtered(this, response.get.call(this)); },
    });
  }

  // Tampermonkey runs userscripts inside the page, where installing the filter
  // directly works. Safari's Userscripts app runs them in a separate world
  // whose XHR isn't Instagram's, and Instagram's CSP blocks plain injected
  // scripts. A script carrying the nonce from Instagram's own script tags is
  // allowed, so inject one of those too; if the filter is already installed
  // in the page, it does nothing.
  function filterFeedRequests() {
    const settings = {
      hideSponsored: CONFIG.hideSponsored,
      hideSuggested: CONFIG.hideSuggested,
      hideFeedReels: CONFIG.hideFeedReels,
      debug: CONFIG.debug,
    };
    installFeedFilter(settings);

    const inject = nonce => {
      const script = document.createElement('script');
      script.nonce = nonce;
      script.textContent = `(${installFeedFilter})(${JSON.stringify(settings)});`;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    };
    const findNonce = () => {
      const script = [...document.scripts].find(s => s.nonce);
      return script && script.nonce;
    };
    if (findNonce()) return inject(findNonce());
    const observer = new MutationObserver(() => {
      const nonce = findNonce();
      if (!nonce) return;
      observer.disconnect();
      inject(nonce);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Anything the data filter misses (the first page of the feed, paid
  // partnerships) is hidden on the page instead. Feed posts are collapsed to
  // 1px rather than display:none. The feed only renders posts near the
  // viewport and tracks which ones are on screen; posts with no box stall it,
  // leaving a page of blank padding and no new posts.
  function injectStyle() {
    const style = document.createElement('style');
    // Chrome's scroll anchoring compensates when the feed drops a post off the
    // top, but not when the feed adds that height back as padding, so with the
    // collapsed posts the page keeps jumping back up. Turn it off on the home
    // feed only; DM chats rely on it to hold position as older messages load.
    style.textContent = `[${LOCK}] { overflow: hidden !important; overscroll-behavior: none !important; }
      ${on('anchor') ? `html[${FEED}], html[${FEED}] body, html[${FEED}] body * { overflow-anchor: none !important; }` : ''}\n` + (CONFIG.debug
      ? `[${MARK}] { outline: 3px solid red !important; outline-offset: -3px; }`
      : `[${MARK}] { display: none !important; }
         article[${MARK}] {
           display: block !important; height: 1px !important; min-height: 0 !important;
           overflow: hidden !important; visibility: hidden !important;
           margin: 0 !important; padding: 0 !important; border: 0 !important;
         }`);
    document.documentElement.appendChild(style);
  }

  function hide(el, reason) {
    if (!el || el.hasAttribute(MARK)) return;
    el.setAttribute(MARK, reason);
    if (el.tagName === 'ARTICLE') STATS.hidPosts++;
    if (CONFIG.debug) console.log('[insta-lite] hid', reason, el);
  }

  function redirectBlockedPaths() {
    for (const [re, to] of REDIRECTS) {
      if (re.test(location.pathname)) return location.replace(location.pathname.replace(re, to));
    }
  }

  // Nav links sit inside a few single-child wrapper divs; hide the outermost
  // wrapper so the icon doesn't leave an empty gap behind.
  function navWrapper(a) {
    let el = a;
    for (let i = 0; i < 5; i++) {
      const parent = el.parentElement;
      if (!parent || parent.tagName === 'NAV' || parent.children.length !== 1) break;
      el = parent;
    }
    return el;
  }

  function hideNavLinks() {
    if (!CONFIG.hideReels) return;
    // Match on the path alone: Instagram carries query params like ?hl=en into
    // nav hrefs, giving /reels/?hl=en.
    for (const a of document.querySelectorAll(`a[href^="/reels/"]:not([${MARK}])`)) {
      if (new URL(a.href).pathname === '/reels/') hide(navWrapper(a), 'nav-reels');
    }
  }

  // The search page shows the Explore grid under the search bar. Walk up from
  // the search input to the first ancestor that also holds posts, then hide
  // the branches with posts. Typed results render in a separate overlay.
  const POST_LINKS = 'a[href*="/p/"], a[href*="/reel"]';
  function hideExploreGrid() {
    if (!/^\/explore\/(search\/)?$/.test(location.pathname)) return;
    const input = document.querySelector('input[aria-label="Search input"], input[placeholder="Search"]');
    let container = input && input.parentElement;
    while (container && !container.querySelector(POST_LINKS)) container = container.parentElement;
    if (!container) return;
    for (const child of container.children) {
      if (!child.contains(input) && child.querySelector(POST_LINKS)) hide(child, 'explore-grid');
    }
  }

  // Post pages end with a "More posts from <user>" grid. Walk up from that
  // label to the largest ancestor that doesn't also hold the post's own video.
  function hideMorePosts() {
    if (!CONFIG.lockReels || !/^\/p\//.test(location.pathname)) return;
    const label = [...document.querySelectorAll(`div:not([${MARK}]), span, h2`)].find(el =>
      [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === 'More posts from'));
    if (!label) return;
    let el = label;
    while (el.parentElement && !el.parentElement.querySelector('video')) el = el.parentElement;
    if (el.querySelector(POST_LINKS)) hide(el, 'more-posts');
  }

  // On phones, a reel tapped in a DM opens in a full-screen viewer inside the
  // chat (the URL stays /direct/t/...), so the redirect above never fires. The
  // viewer is a vertical scroll-snap container with the tapped reel first and
  // more reels below it: lock it, and snap back if anything scrolls it.
  function lockReelScrollers() {
    if (!CONFIG.lockReels) return;
    for (const video of document.querySelectorAll('video')) {
      if (video.closest(`[${LOCK}]`)) continue;
      for (let el = video.parentElement; el && el !== document.body; el = el.parentElement) {
        if (!getComputedStyle(el).scrollSnapType.startsWith('y')) continue;
        el.setAttribute(LOCK, '');
        el.scrollTop = 0;
        el.addEventListener('scroll', () => { if (el.scrollTop !== 0) el.scrollTop = 0; });
        if (CONFIG.debug) console.log('[insta-lite] locked reel scroller', el);
        break;
      }
    }
  }

  // True if any leaf element under root has exactly one of the given labels.
  function hasLabel(root, labels) {
    for (const el of root.querySelectorAll('span, a, div')) {
      if (el.childElementCount === 0 && labels.includes(el.textContent.trim())) return true;
    }
    return false;
  }

  function hideFeedPosts() {
    for (const article of document.querySelectorAll(`article:not([${MARK}])`)) {
      if (CONFIG.hideSponsored && hasLabel(article, SPONSORED_LABELS)) {
        hide(article, 'sponsored');
      } else if (CONFIG.hideSuggested && hasLabel(article, SUGGESTED_LABELS)) {
        hide(article, 'suggested');
      } else if (CONFIG.hideFeedReels && article.querySelector('a[href*="/reel/"]')) {
        hide(article, 'feed-reel');
      }
    }
  }

  // Shows whether the feed data filter is running (it needs to run inside
  // Instagram's own page) and how many posts were hidden on the page, with a
  // button per part of the script to switch it off and reload.
  function showStats() {
    let badge, text;
    setInterval(() => {
      if (!document.body) return;
      if (!badge) {
        badge = document.createElement('div');
        badge.style.cssText = 'position:fixed;top:env(safe-area-inset-top);left:0;right:0;z-index:2147483647;' +
          'background:rgba(0,0,0,.8);color:#fff;font:11px/1.4 monospace;padding:3px 5px;';
        text = document.createElement('div');
        badge.appendChild(text);
        for (const part of PARTS) {
          const button = document.createElement('button');
          button.textContent = part;
          button.style.cssText = 'margin:2px 4px 0 0;padding:3px 8px;font:inherit;border:0;border-radius:3px;' +
            `color:#fff;background:${off.has(part) ? '#c00' : '#2a2'}`;
          button.addEventListener('click', () => {
            off.has(part) ? off.delete(part) : off.add(part);
            try { localStorage.setItem(OFF_KEY, [...off].join(',')); } catch (e) {}
            location.reload();
          });
          badge.appendChild(button);
        }
        document.body.appendChild(badge);
      }
      badge.hidden = location.pathname !== '/';
      const { instaLitePages = 0, instaLiteDropped = 0 } = document.documentElement.dataset;
      const line = `filter: ${instaLitePages} pages, ${instaLiteDropped} dropped | ` +
        `hidden: ${document.querySelectorAll(`article[${MARK}]`).length} now, ${STATS.hidPosts} total`;
      // Only touch the DOM on a change, or the badge would retrigger the observer forever.
      if (text.textContent !== line) text.textContent = line;
    }, 500);
  }

  function scan() {
    document.documentElement.toggleAttribute(FEED, location.pathname === '/');
    redirectBlockedPaths();
    hideNavLinks();
    hideExploreGrid();
    hideMorePosts();
    if (on('lock')) lockReelScrollers();
    if (on('hide')) hideFeedPosts();
  }

  // Instagram is a single-page app that keeps rewriting the DOM, so rescan on
  // every change, batched to at most once per frame.
  let queued = false;
  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }

  redirectBlockedPaths();
  if (on('filter')) filterFeedRequests();
  injectStyle();
  if (CONFIG.showStats) showStats();
  if (on('scan')) {
    new MutationObserver(queueScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('popstate', queueScan);
  }
})();
