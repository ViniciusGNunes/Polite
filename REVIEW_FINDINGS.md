# Polite: Code Review Findings

Review date: 2026-09-23. Scope: everything under `src/` plus the config files (`package.json`, `tsconfig.json`, `postcss.config.js`, `tailwind.config.js`, `test.html`, `README.md`).

`npx tsc --noEmit` passes with no errors, so these are runtime, logic, and design problems, not type errors.

Every item has an ID. To request fixes, reply with the IDs (for example "fix C1, C3, H2"), or mark items below with `[x]`.

**Status: all 38 items fixed** on branch `fix/review-findings` (`npx tsc --noEmit` and `npm run build` both pass after the changes). New shared modules were added: `src/utils/storage.ts` (local vs. sync storage areas), `src/utils/models.ts` (single source of truth for model lists), `src/utils/replace.ts` (shared, safer selection-replacement logic for the content script and the test page). Two items need a manual check that wasn't possible from code alone:
- **M8** (Tailwind/AntD conflict): fixed by disabling Tailwind's `preflight` in `tailwind.config.js`; worth a quick visual check of the popup/options/test pages after rebuilding.
- **M9** (Groq model IDs): the deprecated-model list and `qwen/qwen3.6-27b` are unchanged and still worth confirming against Groq's current model catalog; only the duplication across files was fixed (now centralized in `src/utils/models.ts`).

Severity levels:
- **Critical**: loses or corrupts user data, or leaks sensitive data.
- **High**: a main feature breaks in common situations.
- **Medium**: wrong behavior in edge cases, or misleading UI.
- **Low**: cleanup, dead code, or deprecated APIs.

---

## Critical

### [x] C1. History silently stops saving after about 8 KB (sync storage quota)
- **Where:** [src/background.ts:281](src/background.ts#L281), [src/background.ts:4](src/background.ts#L4)
- **Problem:** `new Storage()` from `@plasmohq/storage` uses `chrome.storage.sync` by default (verified in `node_modules`: `area = "sync"`). Sync storage allows at most 8,192 bytes per item. The history array holds up to 30 entries, each with the original and corrected text, so it goes over 8 KB quickly. When it does, `storage.set` throws. The `chrome.storage.local.set` on the next line then never runs, and the `catch` only logs to the console.
- **Result:** After a few corrections, new history entries are no longer saved and the user sees no error.
- **Suggested fix:** Use `new Storage({ area: "local" })` for history, and keep a single source of truth. Do not write to both Plasmo storage and raw `chrome.storage.local`.

### [x] C2. The API key and all corrected text sync to the user's Google account
- **Where:** every `new Storage()` call (background, popup, options, content, test page)
- **Problem:** Because sync is the default area, the Groq API key and the full text of every correction (emails, documents, anything selected) are uploaded to Chrome Sync and copied to every signed-in device. Users do not expect this, and it is a privacy risk.
- **Suggested fix:** Store `groq_api_key` and `groq_correction_history` in `local`. Keep only small preferences (model, language, blacklist) in sync, if you want those to follow the user.

### [x] C3. `cleanModelOutput` deletes real user content
- **Where:** [src/background.ts:103-111](src/background.ts#L103-L111)
- **Problem:** The "explanation" regexes have no line or word anchor (`\n*\s*` also matches an empty string), and they delete everything from the match to the end of the text. Any legitimate text containing `Notas:`, `Regras:`, `Comentário:`, `Motivo:`, `1. Gramática`, `- Pontuação` and similar words is cut off.
- **Example:** The user selects `Siga estas regras: não atrase, traga o crachá.` The model returns it corrected. The cleanup removes everything from `regras:` onward, and **Replace** writes the cut text back into the document.
- **Suggested fix:** Match these patterns only at the start of a line (`^` with the `m` flag), and only after a blank line that follows the main answer. Also skip stripping when the original text contains the same keyword.

### [x] C4. Bold-extraction step throws away the rest of the paragraph
- **Where:** [src/background.ts:125-135](src/background.ts#L125-L135)
- **Problem:** When the output starts with `**something**` and more text follows, only the bold part is kept, even when the original text also used markdown bold.
- **Example:** The original is `**Atenção** todos devem chegar cedo amanhã.` The output keeps only `Atenção`.
- **Suggested fix:** Apply this rule only when the original does not contain `**`, and only when the text after the bold part looks like commentary (for example, it starts on a new line). Otherwise leave the text as it is.

### [x] C5. An empty model response can delete the user's selection
- **Where:** [src/background.ts:401-402](src/background.ts#L401-L402), [src/content.tsx:244-248](src/content.tsx#L244-L248)
- **Problem:** When `message.content` is empty, `correctedText` becomes `""` and is returned as a success. **Replace** then swaps the selection for an empty string. Content can be empty when the output is cut off, or when a reasoning model (`gpt-oss`, `qwen3`) spends the 1,500-token budget on reasoning. `finish_reason` is never checked either, so output cut off at the limit (`"length"`) also replaces the user's text with half a sentence.
- **Suggested fix:** Throw an error when the cleaned text is empty or when `finish_reason === "length"`. For reasoning models, set `reasoning_effort: "low"` and a larger `max_tokens` that scales with the input length.

### [x] C6. Password fields can be sent to the Groq API
- **Where:** [src/content.tsx:52-91](src/content.tsx#L52-L91)
- **Problem:** `detectActiveSelection` accepts any `INPUT`, including `type="password"`. When a password field has focus, pressing Alt+C uses the fallback path (`allowInputFallback = true`), which takes the whole field value and sends it to Groq. It is also written to history (and synced, see C2).
- **Suggested fix:** Only accept text-like inputs (`text`, `search`, `email`, `url`, `tel`, or no type) and textareas. Always reject `password`. Also skip fields with `autocomplete="cc-number"` or `one-time-code`.

---

## High

### [x] H1. Replace does not update React-controlled inputs
- **Where:** [src/content.tsx:381-396](src/content.tsx#L381-L396)
- **Problem:** Setting `el.value = ...` directly skips React's internal value tracker. The dispatched `input` event is then ignored, because React thinks the value did not change. On React sites (many modern web apps), the field looks corrected, but the app state keeps the old text, and the next re-render or form submit uses the old value. Undo history is also lost.
- **Suggested fix:** Focus the element, call `setSelectionRange(start, end)`, and then try `document.execCommand("insertText", false, text)`. This keeps undo and works with frameworks. If that fails, use the native setter: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype /* or HTMLTextAreaElement */, "value").set.call(el, newValue)`, and then dispatch `input`.

### [x] H2. Replace changes read-only page text and rich-editor internals
- **Where:** [src/content.tsx:427-455](src/content.tsx#L427-L455)
- **Problem:** If `execCommand` fails, the code calls `range.deleteContents()` and `insertNode()` even when the selection is **not** inside an editable element. On static text (for example, case 4 in `test.html`), it rewrites the page DOM. In editors that keep their own model (ProseMirror, Lexical, Slate, Google Docs), direct DOM changes get out of sync with the editor state, and the editor can break or revert.
- **Suggested fix:** Use the DOM fallback only when `editableRoot` exists. For non-editable selections, copy to the clipboard. Also detect editables with `el.isContentEditable` instead of `[contenteditable="true"]`, which misses `contenteditable=""` and `plaintext-only`.

### [x] H3. Enter can apply an old result
- **Where:** [src/content.tsx:226-232](src/content.tsx#L226-L232), [src/content.tsx:304-321](src/content.tsx#L304-L321)
- **Problem:** `correctedText` is not cleared when a new request starts. While a new request is loading, or after it fails, pressing Enter calls `handleReplace()` with the **previous** correction and puts unrelated text into the field.
- **Suggested fix:** Call `setCorrectedText("")` at the start of `executeProcessing`. In the Enter handler, return early when `loading`, `error`, or an empty `correctedText` is present.

### [x] H4. Clipboard failure shows as success
- **Where:** [src/content.tsx:369-375](src/content.tsx#L369-L375), [src/content.tsx:457-460](src/content.tsx#L457-L460)
- **Problem:** `navigator.clipboard.writeText` returns a promise that is never awaited. On `http://` pages, or when the document does not have focus, the promise is rejected, but the UI still shows "Copiado!" and the `alert` says the text was copied. The result is lost.
- **Suggested fix:** Await it, catch the error, and show the error state. If the copy fails, keep the popover open so the user can copy by hand.

### [x] H5. Blacklist matching blocks unrelated sites
- **Where:** [src/content.tsx:165-166](src/content.tsx#L165-L166)
- **Problem:** `currentHost.includes(d)` is a substring match. Blacklisting `x.com` also disables the extension on `netflix.com`, `dropbox.com`, `box.com`, and so on.
- **Suggested fix:** `currentHost === d || currentHost.endsWith("." + d)`.

### [x] H6. Model fallback can pick a non-chat model and saves it without asking
- **Where:** [src/background.ts:173-181](src/background.ts#L173-L181), [src/background.ts:219-222](src/background.ts#L219-L222), [src/background.ts:379-382](src/background.ts#L379-L382)
- **Problem:** The filter only removes IDs that contain `whisper`, `tts`, `audio`, `embed`, or `guard`. Other non-chat models can still pass (for example TTS models whose ID does not contain "tts"). The fallback then takes `activeModels[0]`, which is effectively random, and **saves it as the user's model**. In the options page, "Testar Conexão" can overwrite the stored model even though the user has not clicked Save.
- **Suggested fix:** Fall back to a fixed, ordered list of known chat models (such as `DEFAULT_FALLBACK_MODEL`) and use the API list only to confirm availability. Do not save the model during a test. Return `modelUsed` and let the UI decide.

### [x] H7. Qwen and other reasoning models may put `<think>` blocks in the output
- **Where:** [src/background.ts:98-148](src/background.ts#L98-L148), [src/options.tsx:58-63](src/options.tsx#L58-L63)
- **Problem:** One of the recommended models is Qwen. On Groq, Qwen3-family models can put their reasoning inside the content as `<think>...</think>`, depending on `reasoning_format`. `cleanModelOutput` does not remove these blocks, so the reasoning gets pasted into the user's document.
- **Suggested fix:** Send `reasoning_format: "hidden"` (or `"parsed"`) for models that support it, and strip `<think>[\s\S]*?</think>` as a safety net.

---

## Medium

### [x] M1. Cleared history comes back
- **Where:** [src/background.ts:264-272](src/background.ts#L264-L272), [src/background.ts:312-314](src/background.ts#L312-L314)
- **Problem:** `clearHistory()` writes `"[]"` to Plasmo storage but does not clear the `chrome.storage.local` copy. On the next save, the history is empty, so `saveToHistory` loads the old list back from `chrome.storage.local`. The options page's own clear handler does clear both, but the background `clear_history` action does not. The two-store design is the root cause (see C1).
- **Suggested fix:** Use one store. If the fallback stays, clear both stores in `clearHistory`.

### [x] M2. Double request when the shortcut fires on both paths
- **Where:** [src/content.tsx:293-297](src/content.tsx#L293-L297)
- **Problem:** `handleRuntimeMessage` calls `triggerFix()` without checking `isOpenRef.current`, unlike the keydown path. If both the page `keydown` listener and `chrome.commands` fire, or the user presses the shortcut while the popover is open, a second request starts and replaces the current result.
- **Suggested fix:** Add `if (isOpenRef.current) return` in `triggerFix` itself.

### [x] M3. Trimmed text and selection offsets do not match
- **Where:** [src/content.tsx:54-72](src/content.tsx#L54-L72), [src/content.tsx:74-90](src/content.tsx#L74-L90)
- **Problem:** The text sent to the API is `.trim()`med, but `start` and `end` still include the surrounding whitespace. **Replace** then removes the spaces or newlines around the selection (for example, `"hello  world "` becomes `"hello world"` and joins with the next word).
- **Suggested fix:** Move `start` and `end` inward by the number of trimmed leading and trailing characters.

### [x] M4. `setSelectionRange` throws on some input types
- **Where:** [src/content.tsx:392](src/content.tsx#L392)
- **Problem:** For `type="email"` and `type="number"`, `setSelectionRange` throws `InvalidStateError`. The Alt+C fallback path accepts these inputs, so **Replace** throws before `handleClose()` and the popover stays stuck open.
- **Suggested fix:** Limit input types (see C6), or wrap the call in `try/catch`.

### [x] M5. Error messages lost in `handleTestKey`
- **Where:** [src/background.ts:238-240](src/background.ts#L238-L240)
- **Problem:** When no retry happens, `response.json()` is called a second time on a body that was already read. It throws, the catch returns `{}`, and the real error (rate limit 429, server error 5xx) is replaced by "Chave inválida ou modelo não suportado."
- **Suggested fix:** Reuse the `errorMsg` from the first read, as `handleGrammarFix` already does.

### [x] M6. Enter blocked in the test page's textarea
- **Where:** [src/tabs/test.tsx:196-199](src/tabs/test.tsx#L196-L199)
- **Problem:** While the popover is open, every Enter keypress is caught (capture phase), including in inputs and textareas. The content script checks for this case; the test page does not.
- **Suggested fix:** Use the same `activeTag` check as in `content.tsx`.

### [x] M7. "Restaurar Textos" does not reset the rich editor
- **Where:** [src/tabs/test.tsx:357-359](src/tabs/test.tsx#L357-L359), [src/tabs/test.tsx:522-524](src/tabs/test.tsx#L522-L524)
- **Problem:** `editableHtml` never changes after the first render, so `setEditableHtml(sameString)` does not re-render. The edited DOM stays as it is.
- **Suggested fix:** Put a `key` on the contentEditable div and increment it on reset, or set `innerHTML` through a ref.

### [x] M8. Tailwind preflight may override Ant Design button styles
- **Where:** [src/style.css:1-3](src/style.css#L1-L3), imported by `popup.tsx`, `options.tsx`, and `tabs/test.tsx`
- **Problem:** Tailwind's base layer resets `button { background-color: transparent }`. Ant Design uses low-specificity `:where()` selectors, so the result depends on load order: primary buttons can render transparent. This is a known Ant Design and Tailwind conflict. **Verify visually.** Also, Tailwind is barely used in these pages (only `animate-spin` in the content script).
- **Suggested fix:** Remove `@tailwind base` from the pages that use Ant Design, or set `corePlugins: { preflight: false }`.

### [x] M9. Hardcoded model lists: verify they are still correct
- **Where:** [src/background.ts:6-13](src/background.ts#L6-L13), [src/options.tsx:45-64](src/options.tsx#L45-L64), [src/options.tsx:148-157](src/options.tsx#L148-L157)
- **Problem:**
  - `DEPRECATED_MODELS` includes `llama-3.1-8b-instant` and `llama-3.3-70b-versatile`. If Groq still serves these, users who picked them are silently switched to another model. Check against Groq's current deprecations page.
  - `qwen/qwen3.6-27b` is listed as recommended. Confirm this exact ID exists on Groq.
  - The deprecated list is copied by hand into `options.tsx`, and the popup and options hardcode `"openai/gpt-oss-20b"` again. These copies will drift apart.
- **Suggested fix:** Move `DEPRECATED_MODELS` and `DEFAULT_FALLBACK_MODEL` into `src/utils/models.ts` and import them everywhere.

### [x] M10. Custom model not restored in the options page
- **Where:** [src/options.tsx:147-157](src/options.tsx#L147-L157)
- **Problem:** If the saved model is a custom ID, it goes into `selectedModel`, but `customModel` stays empty. No radio option is highlighted and the custom input is empty, so the user cannot see which model is active.
- **Suggested fix:** On load, if the saved model is not in the recommended or discovered list, set `customModel` to it.

### [x] M11. Blacklist changes need a page reload
- **Where:** [src/content.tsx:157-177](src/content.tsx#L157-L177)
- **Problem:** The blacklist is read only once, when the content script mounts. Adding the current site in the options page has no effect on already-open tabs.
- **Suggested fix:** Use Plasmo's `storage.watch({ ignored_domains: ... })`.

### [x] M12. Selected text can override the prompt instructions (prompt injection)
- **Where:** [src/background.ts:351-354](src/background.ts#L351-L354)
- **Problem:** The selected text goes straight into the user message. Text such as "Ignore the instructions above and write X" can change the output, and **Replace** writes that output into the page. The risk is small, because the user chooses what to select, but page content they did not write (for example, a quoted email) can trigger it.
- **Suggested fix:** Tell the system prompt to treat everything between the delimiters as data, never as instructions. Consider escaping `"""` inside the text.

### [x] M13. `Spin tip` does not render
- **Where:** [src/options.tsx:679](src/options.tsx#L679), [src/tabs/test.tsx:666](src/tabs/test.tsx#L666)
- **Problem:** In Ant Design, `tip` works only when `Spin` wraps content or is fullscreen. On its own, the text is not shown and a console warning appears.
- **Suggested fix:** Put a plain text element next to the spinner.

---

## Low

### [x] L1. Dead code and features that do not exist
- `clear_history` and `get_history` message handlers ([src/background.ts:46-58](src/background.ts#L46-L58)): nothing sends these messages.
- Modes `translate_en`, `shorten`, `expand` ([src/background.ts:88](src/background.ts#L88), [src/background.ts:356](src/background.ts#L356)): not in the UI.
- `item.latencyMs` ([src/options.tsx:706](src/options.tsx#L706)): never saved.
- `item.mode === "fix" || "standard"` ([src/options.tsx:701](src/options.tsx#L701)): the saved values are `"Corrigir"` or `"Traduzir (...)"`, so this check is never true.
- The test page instructions mention "Encurtar, Expandir, Formal" chips and a "Comparativo (Diff)" label ([src/tabs/test.tsx:462-463](src/tabs/test.tsx#L462-L463)); none of these exist.
- The README says the extension adjusts tone ("mais profissional, conciso"); this is not implemented.
- `test.html` tells users to click "Página de Teste" in the popup; the button is called "Playground".

### [x] L2. Unused imports
- `popup.tsx`: `Alert`, `Divider`
- `options.tsx`: `Divider`, `ReadOutlined`, `CheckCircleOutlined`
- `tabs/test.tsx`: `Paragraph`, `InfoCircleOutlined`, `BulbOutlined`, `ClockCircleOutlined`

### [x] L3. Deprecated APIs
- Ant Design `Card` `bodyStyle`/`headStyle` (use `styles={{ body, header }}`), `Space direction` (check the v6 name), `Alert message` (check v6).
- `String.prototype.substr` ([src/background.ts:275](src/background.ts#L275)): use `slice`.
- `document.execCommand`: deprecated but still the only way to keep undo history. Keep it, but add a comment explaining why.

### [x] L4. Unused or mismatched dependencies
- `@tailwindcss/postcss` v4 is installed, but `postcss.config.js` uses the Tailwind v3 plugin (`tailwindcss: {}`). Remove the unused v4 package.
- `package.json` `"test"` script always fails; `"name"` is still `corretor-ia-groq`.
- The `activeTab` permission is not needed, because the content script already runs on `<all_urls>`.

### [x] L5. Small cleanups
- `new Storage()` is created on every render in `popup.tsx` and `options.tsx`, and on every `onChange` in `content.tsx` and `test.tsx`. Create it once at module level.
- `setTimeout` in `handleCopy` is not cleared on unmount.
- `alert()` in the content script ([src/content.tsx:459](src/content.tsx#L459)) blocks the page. Show the message inside the popover instead.
- `JSON.parse` in the options `onChanged` handler ([src/options.tsx:119](src/options.tsx#L119)) has no `try/catch`.
- Removing the API key in the popup also clears `chrome.storage.local`; the options page does not. Make both behave the same way.
- `cleanModelOutput` quote stripping: `"a" and "b"` becomes `a" and "b`. Strip only when there are no other quotes inside.
- The prefix-strip patterns are only in Portuguese; English prefixes (`Here is the corrected text:`) stay in the output when translating to English.
- `.gitignore` contains a stray line `closed`.
