/**
 * Prepares paper text for the model: for PDF text, drop references and
 * appendices by cutting at the References heading (the HTML conversion has
 * already dropped them), then cap the length so a very long main body cannot
 * blow the token budget.
 */

/** About 30k tokens for typical extracted text; the spike's longest main body was 52k chars. */
export const MAX_PAPER_CHARS = 90_000

const REFERENCES_HEADING = /^[ \t]*(?:\d+\.?\s*)?(references|bibliography|works cited)[ \t]*:?[ \t]*$/gim

export interface PreparedText {
  text: string
  cutAtReferences: boolean
  truncated: boolean
  originalChars: number
}

/**
 * Cut at the last-but-plausible References heading. A heading in the first
 * 15% of the text (e.g. a table of contents entry) is ignored so a stray early
 * match does not throw the paper away.
 */
export function cutAtReferences(raw: string): { text: string; cut: boolean } {
  const minIndex = Math.floor(raw.length * 0.15)
  REFERENCES_HEADING.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = REFERENCES_HEADING.exec(raw)) !== null) {
    if (match.index >= minIndex) {
      return { text: raw.slice(0, match.index).trimEnd(), cut: true }
    }
  }
  return { text: raw, cut: false }
}

export function preparePaperText(raw: string, maxChars = MAX_PAPER_CHARS, source: 'html' | 'pdf' = 'pdf'): PreparedText {
  const cleaned = raw.replace(/\r\n?/g, '\n').replace(/\f/g, '\n')
  const { text, cut } = source === 'pdf' ? cutAtReferences(cleaned) : { text: cleaned, cut: false }
  const truncated = text.length > maxChars
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    cutAtReferences: cut,
    truncated,
    originalChars: raw.length,
  }
}
