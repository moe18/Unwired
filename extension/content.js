// ============================================================
// Unwired — Content Script (Universal)
// Works on any website. Extracts content blocks, sends to LLM,
// hides whatever matches the user's filter rules.
// ============================================================

(function () {
  "use strict";

  // ── Configuration ──────────────────────────────────────────
  const SCAN_DEBOUNCE_MS = 400;
  const BATCH_SIZE = 25;
  const CACHE_MAX = 500;
  const MIN_TEXT_LENGTH = 10;

  // ── State ──────────────────────────────────────────────────
  const cache = new Map();
  const processed = new WeakSet();
  let scanTimer = null;
  let totalScanned = 0;
  let totalHidden = 0;
  let rulesGeneration = 0; // bumped on every rule change — stale results discarded

  const MAX_RECENT = 50;
  let mutationsPaused = false;
  let showFilterButtons = true; // toggled via settings

  // ── Track removed items (batched — single write per scan) ───
  let removedBuffer = [];
  let removedFlushTimer = null;

  function trackRemoved(text, reason) {
    removedBuffer.push({
      text: (text || "").slice(0, 120),
      reason: reason || "filtered",
      site: SITE,
      time: Date.now(),
    });
    clearTimeout(removedFlushTimer);
    removedFlushTimer = setTimeout(flushRemoved, 500);
  }

  function flushRemoved() {
    if (removedBuffer.length === 0) return;
    const batch = removedBuffer.splice(0);
    chrome.storage.local.get(["recentlyRemoved"], (data) => {
      const list = [...batch, ...(data.recentlyRemoved || [])];
      if (list.length > MAX_RECENT) list.length = MAX_RECENT;
      chrome.storage.local.set({ recentlyRemoved: list });
    });
  }

  // ── Load filter button preference ──────────────────────────
  chrome.storage.local.get(["showFilterButtons"], (data) => {
    showFilterButtons = data.showFilterButtons !== false;
  });

  // ── Hover filter button on visible items ────────────────────
  function addFilterButton(element) {
    if (!showFilterButtons) return;
    if (element.querySelector(".ig-filter-btn")) return;

    const btn = document.createElement("button");
    btn.className = "ig-filter-btn";
    btn.innerHTML = "&#x2715;";
    btn.title = "Don't show content like this";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const text = element.dataset.igText || element.textContent.trim().slice(0, 300);

      // Hide immediately
      element.classList.add("ig-hidden");
      btn.remove();
      totalHidden++;
      trackRemoved(text, "user filtered");
      reportStats();
      reflowPage();

      // Ask LLM to analyze and rewrite the rules intelligently
      chrome.storage.local.get(["userRules"], (data) => {
        const currentRules = (data.userRules || "").trim();

        // Save current rules to history before changing
        chrome.storage.local.get(["rulesHistory"], (histData) => {
          const history = histData.rulesHistory || [];
          if (currentRules && (history.length === 0 || history[0].rules !== currentRules)) {
            history.unshift({ rules: currentRules, time: Date.now() });
            if (history.length > 20) history.length = 20;
            chrome.storage.local.set({ rulesHistory: history });
          }
        });

        chrome.runtime.sendMessage(
          { type: "refineRules", payload: { rejectedText: text, currentRules } },
          (resp) => {
            if (resp && !resp.error && resp.updatedRules) {
              chrome.storage.local.set({ userRules: resp.updatedRules });
            } else {
              // Fallback: append a basic rule
              const desc = text.replace(/[|[\]"]/g, "").trim().slice(0, 60);
              const newRule = `No content like: ${desc}`;
              const updated = currentRules ? `${currentRules}\n${newRule}` : newRule;
              chrome.storage.local.set({ userRules: updated });
            }
          }
        );
      });
    });

    element.appendChild(btn);
  }

  // ── Utility: simple hash for cache keys ────────────────────
  function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return String(h);
  }

  function trimCache() {
    if (cache.size > CACHE_MAX) {
      const keys = [...cache.keys()];
      for (let i = 0; i < keys.length - CACHE_MAX + 50; i++) {
        cache.delete(keys[i]);
      }
    }
  }

  // ── Detect site ────────────────────────────────────────────
  function detectSite() {
    const host = location.hostname;
    if (host.includes("youtube.com")) return "youtube";
    if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
    if ((host === "www.google.com" || host === "google.com" || /^www\.google\.[a-z.]+$/.test(host)) && (location.pathname.startsWith("/search") || document.querySelector("#search, #rso"))) return "google";
    if (host.includes("reddit.com")) return "reddit";
    if (host.includes("facebook.com")) return "facebook";
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("linkedin.com")) return "linkedin";
    return "generic";
  }

  const SITE = detectSite();

  // ── Site-specific extractors ───────────────────────────────
  // Each returns an array of { element, text }

  const extractors = {

    youtube() {
      const items = [];

      // Video cards (homepage, search, sidebar, shorts shelf)
      const cards = document.querySelectorAll([
        "ytd-rich-item-renderer",
        "ytd-compact-video-renderer",
        "ytd-video-renderer",
        "ytd-grid-video-renderer",
        "ytd-reel-item-renderer",
        "ytd-shelf-renderer",
      ].join(", "));

      cards.forEach((el) => {
        const titleEl =
          el.querySelector("#video-title") ||
          el.querySelector("a#video-title-link") ||
          el.querySelector("span#video-title") ||
          el.querySelector("h3 a") ||
          el.querySelector("[id*='video-title']") ||
          el.querySelector("a.yt-simple-endpoint[title]");

        if (!titleEl) return;

        const title = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
        if (!title) return;

        const metaEl = el.querySelector("#metadata-line");
        const meta = metaEl ? metaEl.textContent.trim() : "";
        const channelEl = el.querySelector("#channel-name a, ytd-channel-name a");
        const channel = channelEl ? channelEl.textContent.trim() : "";

        // Detect Shorts: tag name, parent shelf, /shorts/ link, or [is-short] attribute
        const tag = el.tagName.toLowerCase();
        const link = el.querySelector("a[href*='/shorts/']");
        const isShort = tag === "ytd-reel-item-renderer" ||
                        el.closest("ytd-reel-shelf-renderer") !== null ||
                        !!link ||
                        el.hasAttribute("is-short") ||
                        el.querySelector("[is-short]") !== null;

        const parts = [title, channel, meta, isShort ? "[YouTube Short]" : ""].filter(Boolean);
        items.push({ element: el, text: parts.join(" | ") });
      });

      // Shorts shelf as a whole block (so "no shorts" hides the entire row)
      document.querySelectorAll("ytd-reel-shelf-renderer").forEach((el) => {
        if (items.some((i) => i.element === el)) return; // already added
        items.push({ element: el, text: "[YouTube Short] Shorts shelf" });
      });

      // Promotional shelves (Playables, branded sections, etc.)
      document.querySelectorAll([
        "ytd-rich-shelf-renderer",
        "ytd-rich-section-renderer",
        "ytd-brand-video-shelf-renderer",
        "ytd-brand-video-singleton-renderer",
      ].join(", ")).forEach((el) => {
        if (items.some((i) => i.element === el)) return;
        const titleEl = el.querySelector("#title-text, #title, .title-text, [id*='title'] span, h2");
        const title = titleEl ? titleEl.textContent.trim() : "";
        const isPlayables = title.toLowerCase().includes("playable") ||
                            !!el.querySelector("[href*='playables'], [href*='/gaming']");
        const label = isPlayables ? "[YouTube Playable]" : "[YouTube Promo]";
        items.push({ element: el, text: `${label} ${title || el.textContent.trim().slice(0, 150)}` });
      });

      // Ads (in-feed promos, banner ads, promoted content)
      document.querySelectorAll([
        "ytd-ad-slot-renderer",
        "ytd-in-feed-ad-layout-renderer",
        "ytd-promoted-sparkles-web-renderer",
        "ytd-banner-promo-renderer",
        "ytd-display-ad-renderer",
        "ytd-promoted-video-renderer",
      ].join(", ")).forEach((el) => {
        const text = el.textContent.trim().slice(0, 300);
        items.push({ element: el, text: `[Sponsored Ad] ${text || "YouTube Ad"}` });
      });

      // Comments
      document.querySelectorAll("ytd-comment-thread-renderer").forEach((el) => {
        const textEl = el.querySelector("#content-text");
        if (!textEl) return;
        items.push({ element: el, text: textEl.textContent.trim() });
      });

      return items;
    },

    twitter() {
      const items = [];
      const seen = new WeakSet();

      // Detect if a tweet article is promoted/ad
      function isPromoted(el) {
        // 1. socialContext testid (classic promoted indicator)
        if (el.querySelector('[data-testid="socialContext"]')) return true;
        // 2. "Ad" or "Promoted" label anywhere in the article's non-tweet-text content
        const allText = el.textContent || "";
        // X shows "Ad" as a standalone small label — check for it near the top of the article
        const topSpans = el.querySelectorAll(':scope > div:first-child span, :scope > div > div:first-child span');
        for (const span of topSpans) {
          const t = span.textContent.trim();
          if (t === "Ad" || t === "Promoted" || t === "Sponsored") return true;
        }
        // 3. placementTracking wrapper (ad tracking pixel)
        if (el.closest('[data-testid="placementTracking"]')) return true;
        // 4. Any element with "promotedIndicator" in test id
        if (el.querySelector('[data-testid*="promoted"], [data-testid*="Promoted"]')) return true;
        return false;
      }

      // Regular tweets + promoted tweets
      document.querySelectorAll('article[data-testid="tweet"]').forEach((el) => {
        const wrapper = el.closest('[data-testid="cellInnerDiv"]') || el;
        if (seen.has(wrapper)) return;
        seen.add(wrapper);

        const promoted = isPromoted(el);
        const tweetText = el.querySelector('[data-testid="tweetText"]');
        const text = tweetText ? tweetText.textContent.trim() : "";

        // Even without tweet text, still capture promoted content (app install ads, card ads)
        if (!text && !promoted) return;

        const label = promoted ? "[Sponsored Ad] " : "";
        const content = text || el.textContent.trim().slice(0, 300);
        items.push({ element: wrapper, text: `${label}${content}` });
      });

      // Non-tweet promotional cells (Who to Follow, Premium prompts, etc.)
      document.querySelectorAll('[data-testid="cellInnerDiv"]').forEach((cell) => {
        if (seen.has(cell)) return;
        // Skip if it contains a regular tweet (already handled above)
        if (cell.querySelector('article[data-testid="tweet"]')) return;

        const text = cell.textContent.trim();
        if (text.length < MIN_TEXT_LENGTH) return;

        // Detect promotional cells
        const isPromo =
          /who to follow|subscribe to premium|promoted trend|get verified|trending/i.test(text) ||
          !!cell.querySelector('[data-testid="placementTracking"]') ||
          !!cell.querySelector('[href*="/i/premium"], [href*="/i/verified"]');

        if (isPromo) {
          seen.add(cell);
          items.push({ element: cell, text: `[Sponsored Ad] ${text.slice(0, 300)}` });
        }
      });

      return items;
    },

    google() {
      const items = [];
      const seen = new Set();

      function addResult(el, text) {
        if (!text || text.length < MIN_TEXT_LENGTH) return;
        const key = text.slice(0, 80);
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ element: el, text });
      }

      // Strategy 1: containers with an h3 (most stable — Google always uses h3 for result titles)
      document.querySelectorAll("#search h3, #rso h3, #main h3").forEach((h3) => {
        const title = h3.textContent.trim();
        if (!title) return;

        // Walk up to the result container — typically a div.g or a data-* container
        const container =
          h3.closest("[data-sokoban-container]") ||
          h3.closest("[data-hveid]") ||
          h3.closest(".g") ||
          h3.closest("[data-header-feature]") ||
          h3.parentElement?.parentElement?.parentElement;
        if (!container) return;

        // Grab snippet text from siblings/descendants (skip the title itself)
        const snippetParts = [];
        container.querySelectorAll("span, em, div > span").forEach((span) => {
          if (h3.contains(span)) return;
          const t = span.textContent.trim();
          if (t.length > 20 && !snippetParts.join(" ").includes(t)) {
            snippetParts.push(t);
          }
        });
        const snippet = snippetParts.join(" ").slice(0, 300);

        addResult(container, `${title} — ${snippet}`);
      });

      // Strategy 2: classic .g containers (fallback for older/cached layouts)
      document.querySelectorAll("#search .g, #rso .g").forEach((el) => {
        const titleEl = el.querySelector("h3");
        if (!titleEl) return;
        const title = titleEl.textContent.trim();
        const snippet = el.textContent.replace(title, "").trim().slice(0, 300);
        addResult(el, `${title} — ${snippet}`);
      });

      // Strategy 3: "People also ask" — structural approach
      document.querySelectorAll("[data-sgrd], [jsname][data-initq]").forEach((el) => {
        el.querySelectorAll("[data-q], .related-question-pair, [role='button']").forEach((q) => {
          const text = q.textContent.trim().slice(0, 200);
          if (text) addResult(q, text);
        });
      });

      // Strategy 4: sponsored/ad results
      document.querySelectorAll("[data-text-ad], .uEierd, #tads .g, #bottomads .g").forEach((el) => {
        const title = el.querySelector("h3, [role='heading']")?.textContent?.trim() || "";
        addResult(el, `[Sponsored Ad] ${title || el.textContent.trim().slice(0, 200)}`);
      });

      return items;
    },

    reddit() {
      const items = [];

      // New Reddit / Shreddit
      document.querySelectorAll("shreddit-post, [data-testid='post-container'], .Post").forEach((el) => {
        const title = el.getAttribute("post-title") ||
                      el.querySelector("h3, [slot='title'], a[data-click-id='body']")?.textContent?.trim();
        if (!title) return;
        items.push({ element: el, text: title });
      });

      return items;
    },

    facebook() {
      const items = [];

      document.querySelectorAll('[data-pagelet*="FeedUnit"], [role="article"]').forEach((el) => {
        const text = el.textContent.trim().slice(0, 400);
        if (text.length > MIN_TEXT_LENGTH) {
          items.push({ element: el, text });
        }
      });

      return items;
    },

    instagram() {
      const items = [];

      document.querySelectorAll("article").forEach((el) => {
        const captionEl = el.querySelector("ul li span, div > span");
        const text = captionEl ? captionEl.textContent.trim().slice(0, 300) : "";
        if (text.length > MIN_TEXT_LENGTH) {
          items.push({ element: el, text });
        }
      });

      return items;
    },

    tiktok() {
      const items = [];

      document.querySelectorAll('[data-e2e="recommend-list-item-container"], [class*="DivItemContainer"]').forEach((el) => {
        const descEl = el.querySelector('[data-e2e="video-desc"], [class*="SpanText"]');
        const text = descEl ? descEl.textContent.trim() : "";
        if (text.length > MIN_TEXT_LENGTH) {
          items.push({ element: el, text });
        }
      });

      return items;
    },

    linkedin() {
      const items = [];

      document.querySelectorAll(".feed-shared-update-v2, .occludable-update").forEach((el) => {
        const textEl = el.querySelector(".feed-shared-text, .update-components-text");
        const text = textEl ? textEl.textContent.trim().slice(0, 400) : "";
        if (text.length > MIN_TEXT_LENGTH) {
          items.push({ element: el, text });
        }
      });

      return items;
    },

    // ── Generic fallback: works on any website ─────────────
    generic() {
      const items = [];
      const seen = new Set();

      // 1) Semantic / common class containers
      const selectors = [
        "article",
        "[role='article']",
        "[role='listitem']",
        ".post", ".card", ".feed-item", ".story", ".entry",
        ".search-result", ".result", ".item", ".listing",
        ".news-item", ".blog-post", ".content-card",
        "[class*='card']", "[class*='post']", "[class*='item']",
        "[class*='entry']", "[class*='result']", "[class*='article']",
      ];

      function addItem(el) {
        const text = el.textContent.trim().slice(0, 400);
        if (text.length < MIN_TEXT_LENGTH) return;
        const key = text.slice(0, 80);
        if (seen.has(key)) return;
        // Skip if a parent was already captured (avoid double-counting)
        if (el.closest("[data-ig-processed]")) return;
        seen.add(key);
        items.push({ element: el, text });
      }

      document.querySelectorAll(selectors.join(", ")).forEach(addItem);

      // 2) Repeating siblings — find groups of 3+ similar elements
      //    (covers any site with repeated content blocks)
      const containers = document.querySelectorAll(
        "main, [role='main'], #content, #main, .content, .main, .feed, .list, .grid, " +
        "ul, ol, tbody, section, [class*='feed'], [class*='list'], [class*='grid']"
      );
      containers.forEach((parent) => {
        const children = [...parent.children].filter((c) => {
          const tag = c.tagName;
          return tag !== "SCRIPT" && tag !== "STYLE" && tag !== "BR" && tag !== "HR";
        });
        if (children.length < 3) return;

        // Group children by tag name
        const groups = {};
        for (const child of children) {
          const tag = child.tagName;
          if (!groups[tag]) groups[tag] = [];
          groups[tag].push(child);
        }

        for (const tag in groups) {
          const group = groups[tag];
          if (group.length < 3) continue;
          // This is a repeating pattern — likely content items
          for (const el of group) {
            addItem(el);
          }
        }
      });

      // 3) Headline links — grab the nearest container
      document.querySelectorAll("h1 a, h2 a, h3 a, h4 a, .headline a, .title a, a h2, a h3").forEach((el) => {
        const link = el.closest("a") || el;
        const text = link.textContent.trim();
        if (text.length < MIN_TEXT_LENGTH) return;
        const key = text.slice(0, 80);
        if (seen.has(key)) return;
        seen.add(key);
        const container = link.closest(
          "article, li, tr, .card, .post, .story, .result, .item, .entry, " +
          "[class*='card'], [class*='post'], [class*='item']"
        ) || link.parentElement;
        if (container && !container.closest("[data-ig-processed]")) {
          items.push({ element: container, text });
        }
      });

      // 4) Table rows with links (news sites, forums, aggregators)
      document.querySelectorAll("table tr").forEach((row) => {
        const link = row.querySelector("a");
        if (!link) return;
        const text = row.textContent.trim().slice(0, 400);
        if (text.length < MIN_TEXT_LENGTH) return;
        const key = text.slice(0, 80);
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ element: row, text });
      });

      return items;
    },
  };

  // ── Extract content blocks ─────────────────────────────────
  function extractItems() {
    const extractor = extractors[SITE] || extractors.generic;
    const raw = extractor();

    // Filter out already-processed elements and add IDs
    const items = [];
    for (const item of raw) {
      if (processed.has(item.element)) continue;
      if (!item.text || item.text.length < MIN_TEXT_LENGTH) continue;
      item.id = hashText(item.text.slice(0, 200));
      items.push(item);
    }
    return items;
  }

  // ── Report stats to storage (debounced — one write per batch) ─
  let statsFlushTimer = null;
  function reportStats() {
    clearTimeout(statsFlushTimer);
    statsFlushTimer = setTimeout(() => {
      chrome.storage.local.set({
        stats: { scanned: totalScanned, hidden: totalHidden, site: SITE },
      });
    }, 300);
  }

  // ── Loading state ─────────────────────────────────────────
  function setLoading(elements) {
    for (const el of elements) {
      el.classList.add("ig-loading");
    }
  }

  function clearLoading(elements) {
    for (const el of elements) {
      el.classList.remove("ig-loading");
    }
  }

  function getDirectChildById(element, id) {
    return Array.from(element.children).find((child) => child.id === id) || null;
  }

  function compactYouTubeRowSegment(rows) {
    const entries = rows
      .map((row) => {
        const contents = getDirectChildById(row, "contents");
        if (!contents) return null;

        const items = Array.from(contents.children).filter(
          (child) => child.tagName?.toLowerCase() === "ytd-rich-item-renderer"
        );

        return {
          row,
          contents,
          items,
          capacity: Math.max(items.length, 1),
        };
      })
      .filter(Boolean);

    if (entries.length === 0) return;

    const allItems = entries.flatMap(({ items }) => items);
    const visibleItems = allItems.filter((item) => !item.classList.contains("ig-hidden"));
    const hiddenItems = allItems.filter((item) => item.classList.contains("ig-hidden"));
    const orderedItems = [...visibleItems, ...hiddenItems];
    const parking = document.createDocumentFragment();

    allItems.forEach((item) => parking.appendChild(item));

    let offset = 0;
    entries.forEach(({ row, contents, capacity }) => {
      const nextItems = orderedItems.slice(offset, offset + capacity);
      offset += nextItems.length;

      nextItems.forEach((item) => contents.appendChild(item));

      const hasVisibleItems = nextItems.some((item) => !item.classList.contains("ig-hidden"));
      row.dataset.igCollapsed = hasVisibleItems ? "false" : "true";
      if (hasVisibleItems) {
        row.style.removeProperty("display");
      } else {
        row.style.display = "none";
      }
    });
  }

  function compactYouTubeRichGrid() {
    document.querySelectorAll("ytd-rich-grid-renderer").forEach((grid) => {
      const contents = getDirectChildById(grid, "contents");
      if (!contents) return;

      let rowSegment = [];
      Array.from(contents.children).forEach((child) => {
        if (child.tagName?.toLowerCase() === "ytd-rich-grid-row") {
          rowSegment.push(child);
          return;
        }

        if (rowSegment.length > 0) {
          compactYouTubeRowSegment(rowSegment);
          rowSegment = [];
        }
      });

      if (rowSegment.length > 0) {
        compactYouTubeRowSegment(rowSegment);
      }
    });
  }

  // ── Apply result to a DOM element ──────────────────────────
  function applyAction(element, result, text) {
    totalScanned++;
    element.classList.remove("ig-loading");
    if (text) element.dataset.igText = text.slice(0, 120);
    const action = result.action;

    if (action === "hide") {
      element.classList.add("ig-hidden");
      totalHidden++;
      trackRemoved(text || element.textContent.trim().slice(0, 120), result.reason);
    } else {
      // Visible item — add hover filter button
      addFilterButton(element);
    }

    if (action === "highlight") {
      element.classList.add("ig-highlight");
      element.dataset.igReason = result.reason;
    } else if (action === "dim") {
      element.classList.add("ig-dim");
    }

    processed.add(element);
    element.dataset.igProcessed = "true";
    reportStats();
  }

  // ── Reflow: clean up empty containers after hiding ───────────
  function reflowPage() {
    if (SITE === "youtube") {
      compactYouTubeRichGrid();

      // Collapse empty shelves (Shorts shelf, Playables, etc.)
      document.querySelectorAll("ytd-shelf-renderer, ytd-reel-shelf-renderer, ytd-rich-shelf-renderer").forEach((shelf) => {
        const visible = shelf.querySelectorAll(
          "ytd-reel-item-renderer:not(.ig-hidden), ytd-rich-item-renderer:not(.ig-hidden), ytd-video-renderer:not(.ig-hidden)"
        );
        if (visible.length === 0) {
          shelf.style.display = "none";
          shelf.dataset.igCollapsed = "true";
        }
      });

      // Collapse empty sections
      document.querySelectorAll("ytd-horizontal-card-list-renderer, ytd-rich-section-renderer").forEach((section) => {
        const visible = section.querySelectorAll(
          "ytd-rich-item-renderer:not(.ig-hidden), ytd-video-renderer:not(.ig-hidden), ytd-compact-video-renderer:not(.ig-hidden)"
        );
        if (visible.length === 0) {
          section.style.display = "none";
          section.dataset.igCollapsed = "true";
        }
      });
    }

    if (SITE === "twitter") {
      document.querySelectorAll('[data-testid="cellInnerDiv"]').forEach((cell) => {
        const article = cell.querySelector("article");
        if (article && article.classList.contains("ig-hidden")) {
          cell.style.display = "none";
          cell.dataset.igCollapsed = "true";
        }
      });
    }

    if (SITE === "reddit") {
      document.querySelectorAll("shreddit-post.ig-hidden, .Post.ig-hidden").forEach((post) => {
        const wrapper = post.closest("article, faceplate-batch");
        if (wrapper && !wrapper.querySelector("shreddit-post:not(.ig-hidden), .Post:not(.ig-hidden)")) {
          wrapper.style.display = "none";
          wrapper.dataset.igCollapsed = "true";
        }
      });
    }

    // Generic: collapse any parent whose children are all hidden
    document.querySelectorAll(".ig-hidden").forEach((el) => {
      const parent = el.parentElement;
      if (!parent || parent === document.body || parent.dataset.igCollapsed) return;
      const siblings = [...parent.children].filter(
        (c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE"
      );
      const allHidden = siblings.length > 0 && siblings.every(
        (c) => c.classList.contains("ig-hidden") || c.style.display === "none"
      );
      if (allHidden) {
        parent.style.display = "none";
        parent.dataset.igCollapsed = "true";
      }
    });

  }

  // ── Send a batch to the backend ────────────────────────────
  async function classifyBatch(items, userRules) {
    const gen = rulesGeneration; // snapshot — discard if rules change mid-flight
    const uncached = [];
    const results = new Map();

    for (const item of items) {
      const cached = cache.get(item.id);
      if (cached) {
        results.set(item.id, cached);
      } else {
        uncached.push(item);
      }
    }

    // Apply cached results immediately
    if (uncached.length === 0) {
      mutationsPaused = true;
      for (const item of items) {
        applyAction(item.element, results.get(item.id), item.text);
      }
      reflowPage();
      mutationsPaused = false;
      return;
    }

    // Show loading shimmer on items being classified
    setLoading(uncached.map((i) => i.element));

    const payload = {
      items: uncached.map((i) => ({ id: i.id, text: i.text.slice(0, 300), context: SITE })),
      user_rules: userRules,
    };

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "classify", payload }, resolve);
      });

      // Clear loading state regardless of result
      clearLoading(uncached.map((i) => i.element));

      // Rules changed while waiting — these results are stale, discard
      if (gen !== rulesGeneration) return;

      if (!resp || resp.error) {
        console.error("[Unwired] API error:", resp?.status, resp?.detail);
        return;
      }

      const classifications = resp.data;
      for (const c of classifications) {
        cache.set(c.id, c);
        results.set(c.id, c);
      }
      trimCache();
    } catch (err) {
      clearLoading(uncached.map((i) => i.element));
      console.error("[Unwired] Network error:", err.message);
      return;
    }

    mutationsPaused = true;
    for (const item of items) {
      const result = results.get(item.id);
      if (result) {
        applyAction(item.element, result, item.text);
      }
    }

    // Clean up gaps left by hidden items
    reflowPage();
    mutationsPaused = false;
  }

  // ── Main scan cycle ────────────────────────────────────────
  async function scan() {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(["userRules"], resolve);
    });
    const userRules = (data.userRules || "").trim();

    // No rules → nothing to filter
    if (!userRules) return;

    const items = extractItems();
    console.log(`[Unwired] Scan: ${items.length} items on ${SITE}, rules: "${userRules.slice(0, 50)}"`);
    if (items.length === 0) return;

    // Send all batches in parallel for speed
    const promises = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      promises.push(classifyBatch(batch, userRules));
    }
    await Promise.all(promises);
  }

  // ── Debounced scan trigger ─────────────────────────────────
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  // ── Observe DOM changes (infinite scroll, SPA navigation) ──
  const observer = new MutationObserver((mutations) => {
    if (mutationsPaused) return;
    const hasNewNodes = mutations.some((m) => m.addedNodes.length > 0);
    if (hasNewNodes) scheduleScan();
  });

  // ── Check if current site is enabled before starting ───────
  let siteEnabled = false;

  const DEFAULT_SITES = ["youtube.com", "x.com", "google", "reddit.com"];

  // Domains that should be treated as the same site
  const SITE_ALIASES = {
    "twitter.com": ["twitter.com", "x.com"],
    "x.com": ["twitter.com", "x.com"],
  };

  // Google subdomains that should NOT be filtered (apps, not search)
  const GOOGLE_APP_SUBDOMAINS = [
    "colab", "docs", "drive", "sheets", "slides", "calendar",
    "mail", "meet", "chat", "cloud", "console", "firebase",
    "analytics", "ads", "play", "maps", "earth", "translate",
    "photos", "keep", "classroom", "admin", "accounts", "myaccount",
    "sites", "groups", "contacts", "fonts", "developers",
  ];

  function matchesSite(host, siteKey) {
    // Special handling for "google" — only match google.com search, not google apps
    if (siteKey === "google") {
      if (!host.includes("google.")) return false;
      const sub = host.split(".google.")[0];
      if (GOOGLE_APP_SUBDOMAINS.includes(sub)) return false;
      // Allow www.google.*, google.* (bare), but block app subdomains
      return sub === "www" || !sub.includes(".");
    }
    const domains = SITE_ALIASES[siteKey] || [siteKey];
    return domains.some((d) => host.includes(d));
  }

  function isSiteEnabled(allSites, enabledSites) {
    if (allSites === true) {
      // Even with "all sites", skip known Google apps
      const host = location.hostname;
      if (host.includes("google.")) {
        const sub = host.split(".google.")[0];
        if (GOOGLE_APP_SUBDOMAINS.includes(sub)) return false;
      }
      return true;
    }
    // Default (no settings saved yet): use default sites
    const enabled = (allSites === undefined && enabledSites === undefined)
      ? DEFAULT_SITES
      : (enabledSites || []);
    const host = location.hostname;
    return enabled.some((s) => matchesSite(host, s));
  }

  function startScanning() {
    if (siteEnabled) return; // already running
    siteEnabled = true;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleScan();
  }

  function stopScanning() {
    if (!siteEnabled) return;
    siteEnabled = false;
    observer.disconnect();
    // Clean up any applied filters
    document.querySelectorAll("[data-ig-processed]").forEach((el) => {
      el.classList.remove("ig-hidden", "ig-highlight", "ig-dim", "ig-loading");
      el.removeAttribute("data-ig-processed");
      el.removeAttribute("data-ig-reason");
      el.removeAttribute("data-ig-text");
      el.querySelector(".ig-filter-btn")?.remove();
      processed.delete(el);
    });
    document.querySelectorAll("[data-ig-collapsed]").forEach((el) => {
      el.style.display = "";
      el.removeAttribute("data-ig-collapsed");
    });
    totalScanned = 0;
    totalHidden = 0;
    cache.clear();
  }

  // Initial site check
  chrome.storage.local.get(["allSites", "enabledSites"], (data) => {
    const enabled = isSiteEnabled(data.allSites, data.enabledSites);
    console.log(`[Unwired] Site check: ${location.hostname} → ${enabled ? "enabled" : "disabled"} (allSites=${data.allSites}, enabled=${JSON.stringify(data.enabledSites)})`);
    if (enabled) {
      startScanning();
    }
  });

  // ── Listen for rule + site setting changes ─────────────────
  chrome.storage.onChanged.addListener((changes) => {
    // Site settings changed — start or stop scanning
    if (changes.allSites || changes.enabledSites) {
      const allSites = changes.allSites ? changes.allSites.newValue : undefined;
      const enabledSites = changes.enabledSites ? changes.enabledSites.newValue : undefined;

      // Need to read both values since only one may have changed
      chrome.storage.local.get(["allSites", "enabledSites"], (data) => {
        if (isSiteEnabled(data.allSites, data.enabledSites)) {
          startScanning();
        } else {
          stopScanning();
        }
      });
    }

    if (changes.showFilterButtons) {
      showFilterButtons = changes.showFilterButtons.newValue !== false;
      if (!showFilterButtons) {
        // Remove all existing filter buttons
        document.querySelectorAll(".ig-filter-btn").forEach((btn) => btn.remove());
      } else {
        // Add buttons to existing processed visible items
        document.querySelectorAll("[data-ig-processed]:not(.ig-hidden)").forEach((el) => {
          addFilterButton(el);
        });
      }
    }

    if (changes.userRules) {
      if (!siteEnabled) return; // site not active, ignore rule changes

      const oldRules = (changes.userRules.oldValue || "").trim();
      const newRules = (changes.userRules.newValue || "").trim();
      rulesGeneration++; // invalidate any in-flight API responses
      cache.clear();

      // Detect: did the user only ADD rules, or did they DELETE/change something?
      const isAddOnly = newRules.length > oldRules.length &&
                        oldRules.length > 0 &&
                        newRules.startsWith(oldRules);

      if (isAddOnly) {
        // Rules were only appended — keep hidden items, rescan visible ones
        document.querySelectorAll("[data-ig-processed]").forEach((el) => {
          if (el.classList.contains("ig-hidden")) return;
          el.classList.remove("ig-highlight", "ig-dim", "ig-loading");
          el.removeAttribute("data-ig-processed");
          el.removeAttribute("data-ig-reason");
          el.querySelector(".ig-filter-btn")?.remove();
          processed.delete(el);
        });
      } else {
        // Rules were deleted or rewritten — full rescan everything
        totalScanned = 0;
        totalHidden = 0;
        reportStats();
        document.querySelectorAll("[data-ig-processed]").forEach((el) => {
          el.classList.remove("ig-hidden", "ig-highlight", "ig-dim", "ig-loading");
          el.removeAttribute("data-ig-processed");
          el.removeAttribute("data-ig-reason");
          el.removeAttribute("data-ig-text");
          el.querySelector(".ig-filter-btn")?.remove();
          processed.delete(el);
        });
        document.querySelectorAll("[data-ig-collapsed]").forEach((el) => {
          el.style.display = "";
          el.removeAttribute("data-ig-collapsed");
        });
      }

      scheduleScan();
    }
  });

})();
