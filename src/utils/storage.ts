import { Storage } from "@plasmohq/storage"

/**
 * Sensitive / potentially large data (API key, correction history).
 * Uses "local" area: not subject to chrome.storage.sync's 8KB-per-item
 * quota, and not synced to the user's Google account.
 */
export const localStorage = new Storage({ area: "local" })

/**
 * Small user preferences that are safe and useful to sync across devices
 * (active model, translation language, blacklist domains).
 */
export const syncStorage = new Storage({ area: "sync" })
