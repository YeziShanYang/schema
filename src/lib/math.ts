/**
 * Splits text into plain and math segments for <MathText>. Recognized math:
 * inline \( \) and display \[ \], and $…$ / $$…$$ only when no space follows
 * the opening $ (and, for $…$, no space precedes the closing $ and no digit
 * follows it), so prices such as "$5 and $10" stay text. \$ is a literal
 * dollar sign. An unclosed delimiter is left as text.
 */

export type MathSegment = { type: 'text'; value: string } | { type: 'math'; value: string; display: boolean }

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)

export function parseMath(input: string): MathSegment[] {
  const out: MathSegment[] = []
  let text = ''
  const pushText = (s: string) => {
    text += s
  }
  const pushMath = (value: string, display: boolean) => {
    if (text) out.push({ type: 'text', value: text })
    text = ''
    out.push({ type: 'math', value, display })
  }
  let i = 0
  while (i < input.length) {
    const two = input.slice(i, i + 2)
    if (two === '\\$') {
      pushText('$')
      i += 2
      continue
    }
    if (two === '\\(' || two === '\\[') {
      const close = two === '\\(' ? '\\)' : '\\]'
      const j = input.indexOf(close, i + 2)
      if (j !== -1 && j > i + 2) {
        pushMath(input.slice(i + 2, j), two === '\\[')
        i = j + 2
        continue
      }
      pushText(two)
      i += 2
      continue
    }
    if (two === '$$') {
      const j = input.indexOf('$$', i + 2)
      if (!isSpace(input[i + 2]) && j !== -1 && j > i + 2) {
        pushMath(input.slice(i + 2, j), true)
        i = j + 2
        continue
      }
      pushText('$$')
      i += 2
      continue
    }
    if (input[i] === '$') {
      if (!isSpace(input[i + 1])) {
        let j = i + 1
        let found = -1
        while ((j = input.indexOf('$', j)) !== -1) {
          if (input[j - 1] === '\\') {
            j++
            continue
          }
          if (!isSpace(input[j - 1]) && !/[0-9]/.test(input[j + 1] ?? '') && input[j + 1] !== '$') {
            found = j
            break
          }
          j++
        }
        if (found > i + 1 && !input.slice(i + 1, found).includes('\n\n')) {
          pushMath(input.slice(i + 1, found), false)
          i = found + 1
          continue
        }
      }
      pushText('$')
      i += 1
      continue
    }
    pushText(input[i])
    i += 1
  }
  if (text) out.push({ type: 'text', value: text })
  return out
}

/**
 * Markdown for remark-math (with single-dollar math off): inline math becomes
 * $$…$$, display math a $$ block on its own lines, and every other $ is
 * escaped so it stays a literal dollar sign.
 */
export function normalizeMathMarkdown(input: string): string {
  return parseMath(input)
    .map((s) => {
      if (s.type === 'text') return s.value.replace(/\$/g, '\\$')
      return s.display ? `\n\n$$\n${s.value.trim()}\n$$\n\n` : `$$${s.value}$$`
    })
    .join('')
}

/** True when the text has something parseMath would render as math. */
export function hasMath(input: string): boolean {
  return parseMath(input).some((s) => s.type === 'math')
}
