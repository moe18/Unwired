// ============================================================
// Unwired — Background Service Worker
// Calls LLM APIs directly using the user's API key.
// No backend server required.
// ============================================================

// ── Default models per provider ───────────────────────────────
const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.0-flash",
  grok: "grok-3-mini-fast",
  openrouter: "openai/gpt-4o-mini",
};

// ── System prompt (ported from backend/main.py) ───────────────
function buildSystemPrompt(userRules) {
  return `You are the user's personal internet filter. You decide what content stays and what goes.

The user said:
"${userRules || "(none)"}"

For each content item, pick one action:
- "hide" — remove it completely
- "highlight" — blue border, make it stand out (content they WANT)
- "dim" — fade it out (hover to reveal)
- "show" — leave as-is

Interpret naturally:
- "no clickbait" → hide sensational titles, ALL CAPS, "you won't believe", etc.
- "no shorts" → hide YouTube Shorts
- "no playables" → hide YouTube Playables / games
- "only programming" → highlight programming, hide everything else
- "no politics" → hide political content
- "boost educational" → highlight educational, dim entertainment

"only X" → highlight X, hide the rest.
"no X" → hide X, show the rest.

Each item has a site tag like [youtube], [twitter], [google], etc.

Respond with action + reason (2-4 words) for each item.

ONLY filter what the user's rules ask for. If content doesn't match any rule, show it. When in doubt, show.

Respond ONLY with a valid JSON array. No markdown.
[{"id":"1","action":"hide","reason":"clickbait"},{"id":"2","action":"show","reason":"relevant"}]`;
}

// ── Call LLM provider ─────────────────────────────────────────
async function callLLM(provider, apiKey, model, systemPrompt, userPrompt) {
  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODELS.anthropic,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return data.content[0].text;
  }

  if (provider === "gemini") {
    const m = model || DEFAULT_MODELS.gemini;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
  }

  // OpenAI-compatible: openai, grok, openrouter
  let baseUrl, headers;
  if (provider === "grok") {
    baseUrl = "https://api.x.ai/v1/chat/completions";
    headers = { "content-type": "application/json", Authorization: `Bearer ${apiKey}` };
  } else if (provider === "openrouter") {
    baseUrl = "https://openrouter.ai/api/v1/chat/completions";
    headers = { "content-type": "application/json", Authorization: `Bearer ${apiKey}` };
  } else {
    // openai (default)
    baseUrl = "https://api.openai.com/v1/chat/completions";
    headers = { "content-type": "application/json", Authorization: `Bearer ${apiKey}` };
  }

  const resp = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${provider} ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

// ── Fallback keyword classifier (no API key) ──────────────────
function fallbackClassify(items, userRules) {
  const ruleKeywords = [];
  for (const line of (userRules || "").toLowerCase().replace(/,/g, "\n").split("\n")) {
    const cleaned = line.trim()
      .replace(/^no\s+/, "")
      .replace(/^hide\s+/, "")
      .replace(/^remove\s+/, "")
      .trim();
    if (cleaned) ruleKeywords.push(cleaned);
  }

  return items.map((item) => {
    const textLower = item.text.toLowerCase();
    const matched = ruleKeywords.find((kw) => textLower.includes(kw));
    if (matched) {
      return { id: item.id, action: "hide", reason: matched };
    }
    return { id: item.id, action: "show", reason: "allowed" };
  });
}

// ── Parse LLM response ───────────────────────────────────────
function parseLLMResponse(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.split("\n", 2)[1] || cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}

// ── Get settings from storage ─────────────────────────────────
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["llmProvider", "apiKey", "modelName"], (data) => {
      resolve({
        provider: data.llmProvider || "openai",
        apiKey: data.apiKey || "",
        model: data.modelName || "",
      });
    });
  });
}

// ── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "classify") {
    handleClassify(message.payload).then(sendResponse).catch((err) => {
      sendResponse({ error: true, status: 0, detail: err.message });
    });
    return true;
  }

  if (message.type === "refineRules") {
    handleRefineRules(message.payload).then(sendResponse).catch((err) => {
      sendResponse({ error: true, detail: err.message });
    });
    return true;
  }

  if (message.type === "health") {
    getSettings().then((settings) => {
      sendResponse({
        error: false,
        data: {
          status: "ok",
          llm_provider: settings.provider,
          api_key_set: !!settings.apiKey,
        },
      });
    });
    return true;
  }
});

// ── Classify handler ─────────────────────────────────────────
// ── Refine rules handler ────────────────────────────────────
async function handleRefineRules(payload) {
  const { rejectedText, currentRules } = payload;
  const settings = await getSettings();

  // No API key — just append a basic rule
  if (!settings.apiKey) {
    const desc = (rejectedText || "").replace(/[|[\]"]/g, "").trim().slice(0, 60);
    const newRule = `No content like: ${desc}`;
    const updated = currentRules ? `${currentRules}\n${newRule}` : newRule;
    return { error: false, updatedRules: updated };
  }

  const systemPrompt = `You are helping a user refine their internet content filter rules.

The user just rejected a piece of content by clicking the X button on it. Analyze what kind of content it is and update their filter rules to avoid similar content in the future.

Current rules:
"${currentRules || "(none)"}"

Guidelines:
- Figure out the CATEGORY or PATTERN of the rejected content (e.g. "clickbait", "celebrity gossip", "rage bait", "crypto promotion", etc.)
- If the current rules already cover this type, make the existing rule more specific or stronger
- If it's a new category, add a concise new rule
- Keep rules natural and concise (e.g. "No celebrity gossip", "No crypto shilling")
- Do NOT quote the specific content — generalize to the category
- Return ONLY the updated rules text, one rule per line, no explanation`;

  const userPrompt = `The user rejected this content:\n"${rejectedText.slice(0, 300)}"

Return the updated rules:`;

  try {
    const raw = await callLLM(
      settings.provider,
      settings.apiKey,
      settings.model,
      systemPrompt,
      userPrompt
    );
    const updatedRules = (raw || "").trim().replace(/^```[\s\S]*?\n/, "").replace(/```$/, "").trim();
    return { error: false, updatedRules };
  } catch (err) {
    // Fallback: just append a generic rule
    const desc = (rejectedText || "").replace(/[|[\]"]/g, "").trim().slice(0, 60);
    const newRule = `No content like: ${desc}`;
    const updated = currentRules ? `${currentRules}\n${newRule}` : newRule;
    return { error: false, updatedRules: updated };
  }
}

// ── Classify handler ─────────────────────────────────────────
async function handleClassify(payload) {
  const { items, user_rules } = payload;
  if (!items || items.length === 0) {
    return { error: false, data: [] };
  }

  const settings = await getSettings();
  console.log(`[Unwired BG] Classify ${items.length} items, provider=${settings.provider}, hasKey=${!!settings.apiKey}`);

  // No API key → fallback
  if (!settings.apiKey) {
    const results = fallbackClassify(items, user_rules);
    console.log(`[Unwired BG] Fallback: ${results.filter(r => r.action === "hide").length} hidden`);
    return { error: false, data: results };
  }

  const itemsText = items
    .map((item) => `- id="${item.id}" [${item.context}]: ${item.text.slice(0, 300)}`)
    .join("\n");
  const userPrompt = `Filter these ${items.length} content items:\n\n${itemsText}`;
  const systemPrompt = buildSystemPrompt(user_rules);

  try {
    const raw = await callLLM(
      settings.provider,
      settings.apiKey,
      settings.model,
      systemPrompt,
      userPrompt
    );

    if (!raw) {
      return {
        error: false,
        data: items.map((item) => ({ id: item.id, action: "show", reason: "no response" })),
      };
    }

    const results = parseLLMResponse(raw);
    const classified = results.map((r) => ({
      id: r.id,
      action: r.action || "show",
      reason: r.reason || "",
    }));

    return { error: false, data: classified };
  } catch (err) {
    if (err instanceof SyntaxError) {
      // JSON parse error — show all
      console.error("Unwired: Failed to parse LLM response", err);
      return {
        error: false,
        data: items.map((item) => ({ id: item.id, action: "show", reason: "parse error" })),
      };
    }
    return { error: true, status: 0, detail: err.message };
  }
}
