export interface DiffPart {
  type: "added" | "removed" | "unchanged"
  value: string
}

/**
 * Tokenizes text preserving words and whitespace.
 */
function tokenize(text: string): string[] {
  // Matches words or sequences of whitespace/punctuation
  const regex = /\s+|[^\s]+/g
  return text.match(regex) || []
}

/**
 * Computes a word-level diff between two strings using LCS (Longest Common Subsequence).
 */
export function computeWordDiff(original: string, updated: string): DiffPart[] {
  if (!original && !updated) return []
  if (!original) return [{ type: "added", value: updated }]
  if (!updated) return [{ type: "removed", value: original }]
  if (original === updated) return [{ type: "unchanged", value: original }]

  const a = tokenize(original)
  const b = tokenize(updated)

  const n = a.length
  const m = b.length

  // Build LCS matrix
  // For memory safety with very long text, clamp matrix size
  if (n * m > 1000000) {
    // Fallback for massive text
    return [
      { type: "removed", value: original },
      { type: "added", value: updated }
    ]
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find diff
  const rawDiff: DiffPart[] = []
  let i = n
  let j = m

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rawDiff.push({ type: "unchanged", value: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.push({ type: "added", value: b[j - 1] })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawDiff.push({ type: "removed", value: a[i - 1] })
      i--
    }
  }

  rawDiff.reverse()

  // Merge consecutive tokens of same type
  const merged: DiffPart[] = []
  for (const part of rawDiff) {
    if (merged.length > 0 && merged[merged.length - 1].type === part.type) {
      merged[merged.length - 1].value += part.value
    } else {
      merged.push({ ...part })
    }
  }

  return merged
}

/**
 * Returns statistics about the differences.
 */
export function getDiffStats(parts: DiffPart[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0

  for (const part of parts) {
    if (part.type === "added") {
      const words = part.value.trim().split(/\s+/).filter(Boolean).length
      additions += words
    } else if (part.type === "removed") {
      const words = part.value.trim().split(/\s+/).filter(Boolean).length
      deletions += words
    }
  }

  return { additions, deletions }
}
