// ==UserScript==
// @name         Insta Lite
// @namespace    insta-lite
// @version      0.6.1
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
    showStats: true,       // badge on the home feed for diagnosing scroll jumps (temporary)
  };

  const MARK = 'data-insta-lite';
  const LOCK = 'data-insta-lite-lock';
  const FEED = 'data-insta-lite-feed';
  const STATS = { feedResponses: 0, dropped: 0, shifts: 0, lastShift: 0 };

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
  // screens and the page shrinking under you when scrolling fast. Each feed
  // item has exactly one of media (followed accounts), explore_story
  // (suggested) or ad set.
  const FEED_KEY = 'xdt_api__v1__feed__timeline__connection';
  function keepFeedItem(node) {
    if (!node) return true;
    if (CONFIG.hideSponsored && node.ad) return false;
    if (CONFIG.hideSuggested && node.explore_story) return false;
    if (CONFIG.hideFeedReels && node.media && node.media.product_type === 'clips') return false;
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
      STATS.feedResponses++;
      STATS.dropped += before - feed.edges.length;
      if (CONFIG.debug) console.log('[insta-lite] dropped', before - feed.edges.length, 'feed items');
      return JSON.stringify(json);
    }).join('\n');
  }

  // The feed loads over XHR. Filter what Instagram reads from finished
  // GraphQL requests, caching per request since it reads the response more
  // than once.
  function filterFeedRequests() {
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
      html[${FEED}], html[${FEED}] body, html[${FEED}] body * { overflow-anchor: none !important; }\n` + (CONFIG.debug
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
  // Instagram's own page) and counts layout shifts: times the post you're
  // looking at moved because something above it changed size.
  function showStats() {
    let badge, anchor, anchorTop;
    window.addEventListener('scroll', () => {
      const mid = innerHeight / 2;
      const post = [...document.querySelectorAll(`article:not([${MARK}])`)].find(a => {
        const r = a.getBoundingClientRect();
        return r.top <= mid && r.bottom >= mid;
      });
      const top = post && post.getBoundingClientRect().top + scrollY;
      if (post && post === anchor && Math.abs(top - anchorTop) > 50) {
        STATS.shifts++;
        STATS.lastShift = Math.round(top - anchorTop);
      }
      anchor = post;
      anchorTop = top;
    }, { passive: true });
    setInterval(() => {
      if (!document.body) return;
      if (!badge) {
        badge = document.createElement('div');
        badge.style.cssText = 'position:fixed;top:env(safe-area-inset-top);left:0;z-index:2147483647;' +
          'pointer-events:none;background:rgba(0,0,0,.75);color:#fff;font:11px/1.3 monospace;padding:3px 5px;';
        document.body.appendChild(badge);
      }
      badge.hidden = location.pathname !== '/';
      badge.textContent = `filter: ${STATS.feedResponses} pages, ${STATS.dropped} dropped | ` +
        `hidden: ${document.querySelectorAll(`article[${MARK}]`).length} | ` +
        `shifts: ${STATS.shifts} (last ${STATS.lastShift}px) | ` +
        `anchoring: ${CSS.supports('overflow-anchor', 'none') ? 'yes' : 'no'}`;
    }, 500);
  }

  function scan() {
    document.documentElement.toggleAttribute(FEED, location.pathname === '/');
    redirectBlockedPaths();
    hideNavLinks();
    hideExploreGrid();
    hideMorePosts();
    lockReelScrollers();
    hideFeedPosts();
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
  filterFeedRequests();
  injectStyle();
  if (CONFIG.showStats) showStats();
  new MutationObserver(queueScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('popstate', queueScan);
})();
