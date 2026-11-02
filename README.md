# Polite

A browser extension that corrects grammar and translates any text you select, powered by AI models on [Groq](https://groq.com/).

Select text, press <kbd>Alt</kbd>+<kbd>C</kbd>, review the result, and replace the original in one click. Works on Chrome, Edge, Brave, Opera, and Firefox. The interface is in Brazilian Portuguese.

## What it does

- **Correct:** fixes grammar, agreement, spelling, and punctuation while keeping the author's language and voice.
- **Translate:** English, Spanish, Portuguese, French, German, Italian, Japanese, Chinese, or Russian.
- **Review before replacing:** a word-level diff shows exactly what changed. Replace the text in place or copy the result.
- **Works anywhere you type:** inputs, textareas, and regular page text.
- **Model choice:** pick a recommended model or any chat model on your Groq account.
- **History:** the last 30 results, stored locally in the browser.

## Engineering highlights

- **Manifest V3, cross-browser:** one codebase builds for Chromium browsers and Firefox.
- **Resilient model handling:** if a model is retired or not available to the account, the extension discovers active models through the Groq API and falls back automatically.
- **Prompt-injection hardening:** selected text is passed as delimited data, never as instructions.
- **Output cleanup:** strips reasoning blocks, headings such as "Correção:", and stray quotes or code fences, so only the final text reaches the page.
- **Reasoning-model support:** hides reasoning output and scales the token budget to the input size.
- **Layered tests:** Vitest unit tests, Playwright end-to-end tests on Chromium, and a Selenium suite on Firefox.

## Stack

| | |
| --- | --- |
| Extension | Plasmo, React 19, TypeScript, Ant Design, Sass |
| AI | Groq chat completions API |
| Testing | Vitest, Playwright, Selenium, web-ext |

## Try it

Download the latest build from [Releases](https://github.com/ViniciusGNunes/Polite/releases/latest), load it as an unpacked extension, and add a free [Groq API key](https://console.groq.com/keys). Selected text is sent to Groq only when you run a correction or translation.
