// ============================================================
// Unwired — Popup Script
// ============================================================

(function () {
  "use strict";

  const rulesInput = document.getElementById("rulesInput");
  const displayRulesInput = document.getElementById("displayRulesInput");
  const displayToggle = document.getElementById("displayToggle");
  const displayBody = document.getElementById("displayBody");
  const saveBtn = document.getElementById("saveBtn");
  const statusBar = document.getElementById("statusBar");
  const statsDiv = document.getElementById("stats");
  const scannedCount = document.getElementById("scannedCount");
  const hiddenCount = document.getElementById("hiddenCount");
  const siteLabel = document.getElementById("siteLabel");
  const removedSection = document.getElementById("removedSection");
  const removedToggle = document.getElementById("removedToggle");
  const removedList = document.getElementById("removedList");
  const removedCount = document.getElementById("removedCount");

  // History elements
  const historySection = document.getElementById("historySection");
  const historyToggle = document.getElementById("historyToggle");
  const historyList = document.getElementById("historyList");
  const historyCount = document.getElementById("historyCount");

  // Settings elements
  const settingsToggle = document.getElementById("settingsToggle");
  const settingsBody = document.getElementById("settingsBody");
  const providerSelect = document.getElementById("providerSelect");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const modelInput = document.getElementById("modelInput");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");

  // ── Default models per provider (cheap/fast) ────────────────
  const DEFAULT_MODELS = {
    openai: "gpt-4o-mini",
    anthropic: "claude-haiku-4-5-20251001",
    gemini: "gemini-2.0-flash",
    grok: "grok-3-mini-fast",
    openrouter: "openai/gpt-4o-mini",
  };

  const KEY_PLACEHOLDERS = {
    openai: "sk-...",
    anthropic: "sk-ant-...",
    gemini: "AIza...",
    grok: "xai-...",
    openrouter: "sk-or-...",
  };

  // ── Render recently removed items ──────────────────────────
  function renderRemoved(items) {
    if (!items || items.length === 0) {
      removedSection.style.display = "none";
      return;
    }
    removedSection.style.display = "block";
    removedCount.textContent = items.length;
    removedList.innerHTML = "";

    items.slice(0, 30).forEach((item) => {
      const div = document.createElement("div");
      div.className = "removed-item";

      const text = document.createElement("div");
      text.className = "removed-item-text";
      text.textContent = item.text || "\u2014";

      const reason = document.createElement("div");
      reason.className = "removed-item-reason";
      reason.textContent = item.reason || "filtered";

      div.appendChild(text);
      div.appendChild(reason);
      removedList.appendChild(div);
    });
  }

  // ── Toggle removed list ────────────────────────────────────
  removedToggle.addEventListener("click", () => {
    removedToggle.classList.toggle("open");
    removedList.classList.toggle("collapsed");
  });

  // ── Toggle history ──────────────────────────────────────────
  historyToggle.addEventListener("click", () => {
    historyToggle.classList.toggle("open");
    historyList.classList.toggle("collapsed");
  });

  // ── Render prompt history ──────────────────────────────────
  function renderHistory(items) {
    if (!items || items.length === 0) {
      historySection.style.display = "none";
      return;
    }
    historySection.style.display = "block";
    historyCount.textContent = items.length;
    historyList.innerHTML = "";

    items.slice(0, 20).forEach((item) => {
      const div = document.createElement("div");
      div.className = "removed-item";

      const text = document.createElement("div");
      text.className = "removed-item-text";
      text.textContent = item.rules || "\u2014";

      const btn = document.createElement("button");
      btn.className = "history-restore-btn";
      btn.textContent = "Restore";
      btn.addEventListener("click", () => {
        rulesInput.value = item.rules;
        saveRules();
        saveBtn.textContent = "Restored!";
        saveBtn.classList.add("saved");
        setTimeout(() => {
          saveBtn.textContent = "Apply";
          saveBtn.classList.remove("saved");
        }, 1500);
      });

      div.appendChild(text);
      div.appendChild(btn);
      historyList.appendChild(div);
    });
  }

  // ── Toggle settings ────────────────────────────────────────
  settingsToggle.addEventListener("click", () => {
    settingsToggle.classList.toggle("open");
    settingsBody.classList.toggle("collapsed");
  });

  // ── Toggle display rules section ───────────────────────────
  displayToggle.addEventListener("click", () => {
    displayToggle.classList.toggle("open");
    displayBody.classList.toggle("collapsed");
  });

  // No-key banner elements
  const noKeyBanner = document.getElementById("noKeyBanner");
  const noKeySetupBtn = document.getElementById("noKeySetupBtn");
  const noKeySkipBtn = document.getElementById("noKeySkipBtn");

  // Filter button toggle
  const filterBtnCheck = document.getElementById("filterBtnCheck");

  // Site selector elements
  const allSitesCheck = document.getElementById("allSitesCheck");
  const siteChips = document.getElementById("siteChips");
  const customSiteRow = document.getElementById("customSiteRow");
  const customSiteInput = document.getElementById("customSiteInput");

  // ── All-sites toggle ────────────────────────────────────────
  function updateSitesVisibility() {
    const show = !allSitesCheck.checked;
    siteChips.style.display = show ? "flex" : "none";
    customSiteRow.style.display = show ? "flex" : "none";
  }

  allSitesCheck.addEventListener("change", updateSitesVisibility);

  // ── Custom site input: Enter to add chip ───────────────────
  customSiteInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const domain = customSiteInput.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) return;

    // Check if already exists
    const existing = siteChips.querySelectorAll("input[type=checkbox]");
    for (const cb of existing) {
      if (cb.value === domain) {
        cb.checked = true;
        customSiteInput.value = "";
        return;
      }
    }

    // Create new chip
    const label = document.createElement("label");
    label.className = "site-chip";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = domain;
    cb.checked = true;
    const span = document.createElement("span");
    span.textContent = domain;
    label.appendChild(cb);
    label.appendChild(span);
    siteChips.appendChild(label);
    customSiteInput.value = "";
  });

  // ── Collect enabled sites from chips ───────────────────────
  function getEnabledSites() {
    const sites = [];
    siteChips.querySelectorAll("input[type=checkbox]:checked").forEach((cb) => {
      sites.push(cb.value);
    });
    return sites;
  }

  // ── Update model + placeholders when provider changes ──────
  function updatePlaceholders() {
    const provider = providerSelect.value;
    apiKeyInput.placeholder = KEY_PLACEHOLDERS[provider] || "API key...";
    modelInput.value = DEFAULT_MODELS[provider] || "";
  }

  providerSelect.addEventListener("change", updatePlaceholders);

  // ── Mask API key for display ───────────────────────────────
  function maskKey(key) {
    if (!key || key.length < 8) return key ? "****" : "";
    return "****..." + key.slice(-4);
  }

  // ── Load saved rules + settings + recently removed ─────────
  chrome.storage.local.get(
    ["userRules", "displayRules", "stats", "recentlyRemoved", "rulesHistory", "llmProvider", "apiKey", "modelName", "allSites", "enabledSites", "showFilterButtons"],
    (data) => {
      rulesInput.value = data.userRules || "";
      lastSavedRules = (data.userRules || "").trim();
      displayRulesInput.value = data.displayRules || "";
      lastSavedDisplayRules = (data.displayRules || "").trim();

      // Auto-open the display section if the user has any rules set
      if (lastSavedDisplayRules) {
        displayToggle.classList.add("open");
        displayBody.classList.remove("collapsed");
      }

      // Show stats if we have them
      if (data.stats) {
        statsDiv.style.display = "flex";
        scannedCount.textContent = data.stats.scanned || 0;
        hiddenCount.textContent = data.stats.hidden || 0;
        siteLabel.textContent = data.stats.site || "-";
      }

      // Show recently removed
      renderRemoved(data.recentlyRemoved);

      // Show prompt history
      renderHistory(data.rulesHistory);

      // Load settings
      const provider = data.llmProvider || "openai";
      providerSelect.value = provider;
      if (data.apiKey) {
        apiKeyInput.value = maskKey(data.apiKey);
      }
      // Auto-fill model: use saved model or default for provider
      modelInput.value = data.modelName || DEFAULT_MODELS[provider] || "";
      apiKeyInput.placeholder = KEY_PLACEHOLDERS[provider] || "API key...";

      // Update status bar + no-key banner
      const hasKey = !!data.apiKey;
      updateStatusBar(provider, hasKey);
      noKeyBanner.style.display = hasKey ? "none" : "flex";

      // Load site settings (default: specific sites, not all)
      const isFirstRun = data.allSites === undefined && data.enabledSites === undefined;
      allSitesCheck.checked = isFirstRun ? false : !!data.allSites;
      const enabled = isFirstRun
        ? ["youtube.com", "x.com", "google", "reddit.com"]
        : (data.enabledSites || []);
      // Check matching chips
      siteChips.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = enabled.includes(cb.value);
      });
      // Add custom sites that aren't in the predefined chips
      const predefined = new Set();
      siteChips.querySelectorAll("input[type=checkbox]").forEach((cb) => predefined.add(cb.value));
      for (const site of enabled) {
        if (!predefined.has(site)) {
          const label = document.createElement("label");
          label.className = "site-chip";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = site;
          cb.checked = true;
          const span = document.createElement("span");
          span.textContent = site;
          label.appendChild(cb);
          label.appendChild(span);
          siteChips.appendChild(label);
        }
      }
      // Load filter button toggle (default: on)
      filterBtnCheck.checked = data.showFilterButtons !== false;

      updateSitesVisibility();
    }
  );

  // ── Update status bar ──────────────────────────────────────
  function updateStatusBar(provider, hasKey) {
    statusBar.classList.remove("connected", "offline");
    if (hasKey) {
      const names = {
        openai: "OpenAI",
        anthropic: "Claude",
        gemini: "Gemini",
        grok: "Grok",
        openrouter: "OpenRouter",
      };
      statusBar.textContent = "Connected \u2014 " + (names[provider] || provider);
      statusBar.classList.add("connected");
    } else {
      statusBar.textContent = "No API key \u2014 using basic filter";
      statusBar.classList.add("offline");
    }
  }

  // ── Save settings ──────────────────────────────────────────
  saveSettingsBtn.addEventListener("click", () => {
    const provider = providerSelect.value;
    const model = modelInput.value.trim();
    const keyValue = apiKeyInput.value.trim();

    const toSave = {
      llmProvider: provider,
      modelName: model,
      allSites: allSitesCheck.checked,
      enabledSites: getEnabledSites(),
      showFilterButtons: filterBtnCheck.checked,
    };

    // Only update API key if user typed a new one (not the masked version)
    if (keyValue && !keyValue.startsWith("****")) {
      toSave.apiKey = keyValue;
    }

    chrome.storage.local.set(toSave, () => {
      // Show saved feedback
      saveSettingsBtn.textContent = "Saved!";
      saveSettingsBtn.classList.add("saved");
      setTimeout(() => {
        saveSettingsBtn.textContent = "Save Settings";
        saveSettingsBtn.classList.remove("saved");
      }, 1500);

      // Update status bar + banner
      chrome.storage.local.get(["apiKey"], (d) => {
        const hasKey = !!d.apiKey;
        updateStatusBar(provider, hasKey);
        noKeyBanner.style.display = hasKey ? "none" : "flex";
        // Re-mask the key
        if (d.apiKey) {
          apiKeyInput.value = maskKey(d.apiKey);
        }
      });
    });
  });

  // ── No-key banner actions ──────────────────────────────────
  noKeySetupBtn.addEventListener("click", () => {
    // Open settings and focus the API key input
    if (!settingsToggle.classList.contains("open")) {
      settingsToggle.classList.add("open");
      settingsBody.classList.remove("collapsed");
    }
    apiKeyInput.focus();
    noKeyBanner.style.display = "none";
  });

  noKeySkipBtn.addEventListener("click", () => {
    noKeyBanner.style.display = "none";
  });

  // ── Example chips — click to append to rules ───────────────
  document.querySelectorAll(".example-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      // Filter-rule chips target rulesInput; display-rule chips target displayRulesInput
      if (chip.dataset.displayText) {
        const text = chip.dataset.displayText;
        const current = displayRulesInput.value.trim();
        if (current.toLowerCase().includes(text.toLowerCase())) return;
        displayRulesInput.value = current ? `${current}\n${text}` : text;
        saveDisplayRules();
        displayRulesInput.focus();
      } else if (chip.dataset.text) {
        const text = chip.dataset.text;
        const current = rulesInput.value.trim();
        if (current.toLowerCase().includes(text.toLowerCase())) return;
        rulesInput.value = current ? `${current}\n${text}` : text;
        rulesInput.focus();
      }
    });
  });

  // ── Auto-save rules on edit (debounced) ────────────────────
  let rulesSaveTimer = null;
  let lastSavedRules = null; // track to avoid duplicate history entries
  let displaySaveTimer = null;
  let lastSavedDisplayRules = null;

  function saveRulesToHistory(oldRules) {
    if (!oldRules) return;
    chrome.storage.local.get(["rulesHistory"], (data) => {
      const history = data.rulesHistory || [];
      if (history.length === 0 || history[0].rules !== oldRules) {
        history.unshift({ rules: oldRules, time: Date.now() });
        if (history.length > 20) history.length = 20;
        chrome.storage.local.set({ rulesHistory: history });
      }
    });
  }

  function saveRules() {
    const rules = rulesInput.value.trim();
    // Save previous version to history before overwriting
    if (lastSavedRules !== null && lastSavedRules !== rules) {
      saveRulesToHistory(lastSavedRules);
    }
    lastSavedRules = rules;
    chrome.storage.local.set({ userRules: rules });
  }

  rulesInput.addEventListener("input", () => {
    clearTimeout(rulesSaveTimer);
    rulesSaveTimer = setTimeout(saveRules, 800);
    // Show "Apply" as a visual indicator that changes are pending
    saveBtn.textContent = "Apply";
    saveBtn.classList.remove("saved");
  });

  function saveDisplayRules() {
    const rules = displayRulesInput.value.trim();
    if (rules === lastSavedDisplayRules) return;
    lastSavedDisplayRules = rules;
    chrome.storage.local.set({ displayRules: rules });
  }

  displayRulesInput.addEventListener("input", () => {
    clearTimeout(displaySaveTimer);
    displaySaveTimer = setTimeout(saveDisplayRules, 800);
  });

  // ── Apply button — immediate save + visual feedback ────────
  saveBtn.addEventListener("click", () => {
    clearTimeout(rulesSaveTimer);
    saveRules();
    saveBtn.textContent = "Applied!";
    saveBtn.classList.add("saved");
    setTimeout(() => {
      saveBtn.textContent = "Apply";
      saveBtn.classList.remove("saved");
    }, 1500);
  });

  // ── Also apply on Ctrl+Enter / Cmd+Enter ───────────────────
  rulesInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveBtn.click();
    }
  });

  // ── Clear masked key on focus so user can type a new one ───
  apiKeyInput.addEventListener("focus", () => {
    if (apiKeyInput.value.startsWith("****")) {
      apiKeyInput.value = "";
    }
  });

  // Restore masked key if user clicks away without typing
  apiKeyInput.addEventListener("blur", () => {
    if (apiKeyInput.value === "") {
      chrome.storage.local.get(["apiKey"], (d) => {
        if (d.apiKey) {
          apiKeyInput.value = maskKey(d.apiKey);
        }
      });
    }
  });

  // ── Listen for live updates from content script ────────────
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.stats) {
      const s = changes.stats.newValue;
      if (s) {
        statsDiv.style.display = "flex";
        scannedCount.textContent = s.scanned || 0;
        hiddenCount.textContent = s.hidden || 0;
        siteLabel.textContent = s.site || "-";
      }
    }
    if (changes.recentlyRemoved) {
      renderRemoved(changes.recentlyRemoved.newValue);
    }
    if (changes.rulesHistory) {
      renderHistory(changes.rulesHistory.newValue);
    }
    if (changes.userRules) {
      // Keep textarea in sync when LLM rewrites rules from content script
      const newRules = changes.userRules.newValue || "";
      if (rulesInput.value.trim() !== newRules.trim()) {
        rulesInput.value = newRules;
        lastSavedRules = newRules.trim();
      }
    }
    if (changes.displayRules) {
      const newRules = changes.displayRules.newValue || "";
      if (displayRulesInput.value.trim() !== newRules.trim()) {
        displayRulesInput.value = newRules;
        lastSavedDisplayRules = newRules.trim();
      }
    }
  });
})();
