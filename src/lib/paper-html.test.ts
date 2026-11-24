import { describe, expect, it } from 'vitest'
import { arxivHtmlToText, decodeEntities, MIN_HTML_TEXT_CHARS } from './paper-html'
import { FIXTURE_PAPER_HTML } from '../server/pipeline/fixtures'

const page = (body: string) => `<!DOCTYPE html><html><head><title>t</title><script>var x = "<p>script</p>";</script></head><body><header>chrome</header><article class="ltx_document">${body}</article><footer>foot</footer></body></html>`
const math = (alt: string, display: 'inline' | 'block' = 'inline') =>
  `<math class="ltx_Math" alttext="${alt}" display="${display}"><semantics><msqrt><mi>d</mi></msqrt><annotation encoding="application/x-tex">${alt}</annotation></semantics></math>`

describe('arxivHtmlToText', () => {
  it('turns inline math into \\( \\) from its alttext, not the MathML', () => {
    const text = arxivHtmlToText(page(`<p class="ltx_p">We divide each by ${math('\\sqrt{d_{k}}')}, and apply a softmax.</p>`))
    expect(text).toBe('We divide each by \\(\\sqrt{d_{k}}\\), and apply a softmax.')
  })

  it('turns display math and equation-table rows into \\[ \\] lines, without the equation number', () => {
    const eqn = `<table class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_eqn_row"><td class="ltx_eqn_cell">${math('\\displaystyle a&lt;b', 'inline')}</td><td class="ltx_eqn_cell">${math('=c', 'inline')}</td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(3)</span></td></tr></tbody></table>`
    const text = arxivHtmlToText(page(`<p>Before.</p>${eqn}<p>Then ${math('x^{2}', 'block')} after.</p>`))
    expect(text).toContain('Before.\n\n\\[a<b =c\\]\n')
    expect(text).not.toContain('(3)')
    expect(text).toContain('Then\n\\[x^{2}\\]\nafter.')
  })

  it('keeps section headings on their own lines and drops the bibliography, appendix and footnotes', () => {
    const text = arxivHtmlToText(
      page(
        `<section class="ltx_section"><h2 class="ltx_title"><span class="ltx_tag">1 </span>Introduction</h2><p>Main text.<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer">A footnote.</span></span> More.</p></section>` +
          `<section class="ltx_bibliography"><h2>References</h2><ul><li>[1] A cited paper.</li></ul></section>` +
          `<section class="ltx_appendix"><h2>Appendix A</h2><p>Proof details.</p></section>`,
      ),
    )
    expect(text).toBe('1 Introduction\n\nMain text. More.')
  })

  it('drops the page chrome, scripts, the author block and the table of contents', () => {
    const text = arxivHtmlToText(page(`<nav class="ltx_TOC">Contents</nav><div class="ltx_authors">Ada Author</div><h1 class="ltx_title">A Title</h1><p>Body &amp; more&nbsp;text.</p>`))
    expect(text).toBe('A Title\n\nBody & more text.')
  })

  it('keeps data tables as rows of cells', () => {
    const text = arxivHtmlToText(page(`<table class="ltx_tabular"><tr><th>Layer</th><th>Path</th></tr><tr><td>Self-attention</td><td>${math('O(1)')}</td></tr></table>`))
    expect(text).toBe('Layer | Path\nSelf-attention | \\(O(1)\\)')
  })

  it('falls back to the TeX annotation when a formula has no alttext', () => {
    const text = arxivHtmlToText(page(`<p>Radius <math display="inline"><semantics><mi>r</mi><annotation encoding="application/x-tex">\\sqrt{2/a}</annotation></semantics></math>.</p>`))
    expect(text).toBe('Radius \\(\\sqrt{2/a}\\).')
  })

  it('converts the fixture page: quotes are present, the minimum length is met, nothing after the main text leaks', () => {
    const text = arxivHtmlToText(FIXTURE_PAPER_HTML)
    expect(text.length).toBeGreaterThan(MIN_HTML_TEXT_CHARS)
    expect(text).toContain('divided by \\(\\sqrt{d_{k}}\\) to keep its scale stable.')
    expect(text).toContain('\\[s_{ij}=\\frac{q_{i}\\cdot k_{j}}{\\sqrt{d_{k}}}\\]')
    expect(text).toMatch(/^A Fixture Paper on Curvature-Aware Attention\n\nAbstract\n/)
    for (const gone of ['Script text', 'arXiv chrome', 'Table of contents', 'Test Author', 'footnote', 'Vaswani', 'Appendix text', 'arXiv footer']) {
      expect(text).not.toContain(gone)
    }
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(decodeEntities('a &lt; b &amp;&amp; c &#8730; &#x221A; &bogus;')).toBe('a < b && c √ √ &bogus;')
  })
})
