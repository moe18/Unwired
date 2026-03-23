# Privacy Policy — Unwired

**Last updated:** March 21, 2026

## Overview

Unwired is a Chrome extension that filters web content using AI. Your privacy is simple: your data stays on your device and goes only where you tell it to.

## Data Collection

Unwired does **not** collect, store, or transmit any personal data to us. We have no servers, no analytics, no tracking, and no accounts.

## What Data Is Processed

When you set up filtering rules and browse the web, the extension:

1. **Reads page content** — Text from content blocks (titles, posts, comments, etc.) on websites you visit is extracted locally in your browser to be classified against your rules.

2. **Sends content to your chosen LLM provider** — If you configure an API key, extracted text snippets (up to 300 characters per item, batched up to 25 at a time) are sent to the AI provider you selected (OpenAI, Anthropic, Google Gemini, xAI, or OpenRouter) for classification. These requests are made directly from your browser using your own API key. Unwired does not proxy, log, or intercept these requests.

3. **Stores settings locally** — Your API key, filter rules, rule history, site preferences, and recently removed items are stored in Chrome's local storage (`chrome.storage.local`) on your device. This data never leaves your browser except as described in point 2.

## Third-Party Services

Unwired connects to third-party AI APIs **only when you provide an API key** and **only to classify content**. Each provider has its own privacy policy:

- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google AI Privacy Policy](https://ai.google.dev/terms)
- [xAI Privacy Policy](https://x.ai/legal/privacy-policy)
- [OpenRouter Privacy Policy](https://openrouter.ai/privacy)

You are responsible for reviewing and accepting the terms of whichever provider you choose. If no API key is set, Unwired uses basic keyword matching entirely on-device with no external requests.

## Permissions Explained

| Permission | Why it's needed |
|-----------|----------------|
| `storage` | Save your rules, settings, and API key locally |
| `activeTab` | Read content on the current page for filtering |
| `<all_urls>` (host) | Content script runs on any site you enable; API calls go to LLM provider endpoints |

## Data Retention

- All data is stored locally and persists until you uninstall the extension or clear Chrome's extension storage.
- No data is retained by us because we never receive it.

## Children's Privacy

Unwired does not knowingly collect any information from anyone, including children under 13.

## Changes to This Policy

If this policy changes, the updated version will be posted in the GitHub repository with a new "Last updated" date.

## Contact

If you have questions about this privacy policy, open an issue at [github.com/moe18/Unwired](https://github.com/moe18/Unwired/issues).
