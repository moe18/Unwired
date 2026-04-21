<p align="center">
  <img src="logo.png" alt="Unwired" width="180" />
</p>

<h1 align="center">Unwired</h1>

LLM-powered Chrome extension that filters low-value, distracting, and manipulative content from the web. Tell it what you don't want to see and dont see it. so many people are fighting for your attention its time for you to fight back.

you can get the chrome extention here https://chromewebstore.google.com/detail/unwired/eagjafndbcedibfalnfimildfphokffn

## Quick Start

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` folder
4. Click the Unwired icon in the toolbar
5. Add your API key in **Settings** (supports OpenAI, Claude, Gemini, Grok, OpenRouter)
6. Write your rules and start browsing

No backend server needed. The extension calls LLM APIs directly from the browser using your own API key.

## Example Rules

```
No clickbait
No politics
Only programming content
No shorts or playables
No ads or sponsored content
No outrage bait or drama
Highlight educational content
Dim entertainment
```

## How It Works

```
Chrome Extension (Manifest V3)
┌──────────────────────────────────┐
│ content.js                       │
│  Extracts content from the DOM   │
│  Batches items for classification│
│  Applies hide/show/dim/highlight │
│                                  │
│ background.js                    │
│  Calls LLM API directly         │
│  Classifies content per rules   │
│  Refines rules when you reject  │
│                                  │
│ popup.html/js                    │
│  Rules editor (auto-saves)      │
│  Settings & API key             │
│  Recently removed & history     │
└──────────────────────────────────┘
```

## Supported Sites

| Site | What gets scanned |
|------|------------------|
| YouTube | Video titles, Shorts shelves, Playables, ads, comments |
| Twitter/X | Tweets, promoted tweets, app install ads, Who to Follow |
| Google | Search results, People Also Ask, sponsored results |
| Reddit | Post titles |
| Facebook | Feed posts |
| LinkedIn | Feed posts |
| Any site | Generic extractor (articles, cards, headlines, table rows) |

## Content Actions

| Action | Behavior |
|--------|----------|
| `show` | Left unchanged |
| `hide` | Removed from DOM entirely |
| `dim` | Faded out, visible on hover |
| `highlight` | Blue border, stands out |
| `rewrite` | Title text transformed per display rules (see below) |

## Display Rules

Beyond filtering, you can describe in plain English how visible content should be *displayed*. The LLM rewrites titles and main text on the fly — think of the extension as a display proxy that applies your instructions to the content before you see it. Hover a rewritten item to see the original.

Example display rules:

```
Summarize long titles in one sentence
Strip emojis and clickbait punctuation
Translate non-English content to English
Make headlines neutral and factual
Shorten to 60 characters max
Prefix with a topic tag like [programming]
```

Display rules are completely separate from filter rules — use one, the other, or both together.

## Features

- **Natural language rules** — write filters in plain English
- **Display rules** — describe how visible content should be rewritten (summarize, translate, de-clickbait)
- **Auto-save** — rules apply as you type (800ms debounce)
- **Smart reject button** — hover any content to see an X button; clicking it sends the content to the LLM which analyzes the category and rewrites your rules
- **Prompt history** — every rule change is saved, restore any previous version
- **Filter button toggle** — enable/disable the hover reject buttons in Settings
- **Multi-provider** — OpenAI, Claude, Gemini, Grok, or OpenRouter
- **No API key mode** — basic keyword matching fallback
- **Per-site control** — enable/disable filtering per site, or turn on for all sites
- **Google app protection** — Colab, Docs, Drive, etc. are never filtered

## LLM Providers

| Provider | Default Model | API Key Format |
|----------|--------------|----------------|
| OpenAI | gpt-4o-mini | `sk-...` |
| Anthropic | claude-haiku-4-5 | `sk-ant-...` |
| Gemini | gemini-2.0-flash | `AIza...` |
| Grok | grok-3-mini-fast | `xai-...` |
| OpenRouter | openai/gpt-4o-mini | `sk-or-...` |

## Performance

- Batches up to 25 items per API call
- In-memory cache (500 entries) prevents re-classification
- Debounced scanning (400ms) avoids excessive API calls
- MutationObserver handles infinite scroll and SPA navigation
- Stale results are discarded when rules change mid-flight
