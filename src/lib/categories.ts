/**
 * Readable names for arXiv categories, used to suggest a workspace name for
 * a pasted paper. Static: no model call. Exact categories first, then the
 * archive (the part before the dot), then a shortened title.
 * Category list: https://arxiv.org/category_taxonomy
 */

const EXACT: Record<string, string> = {
  'cs.AI': 'Artificial Intelligence',
  'cs.LG': 'Machine Learning',
  'cs.CL': 'Natural Language Processing',
  'cs.CV': 'Computer Vision',
  'cs.NE': 'Neural and Evolutionary Computing',
  'cs.RO': 'Robotics',
  'cs.IR': 'Information Retrieval',
  'cs.CR': 'Cryptography and Security',
  'cs.DS': 'Data Structures and Algorithms',
  'cs.DB': 'Databases',
  'cs.DC': 'Distributed Computing',
  'cs.PL': 'Programming Languages',
  'cs.SE': 'Software Engineering',
  'cs.HC': 'Human-Computer Interaction',
  'cs.GT': 'Game Theory',
  'cs.IT': 'Information Theory',
  'cs.LO': 'Logic in Computer Science',
  'cs.NI': 'Networking',
  'cs.SY': 'Systems and Control',
  'cs.MA': 'Multiagent Systems',
  'cs.GR': 'Computer Graphics',
  'cs.SD': 'Sound and Audio',
  'cs.CC': 'Computational Complexity',
  'cs.CG': 'Computational Geometry',
  'cs.DM': 'Discrete Mathematics',
  'cs.FL': 'Formal Languages',
  'cs.MS': 'Mathematical Software',
  'cs.NA': 'Numerical Analysis',
  'cs.SI': 'Social Networks',
  'cs.CY': 'Computers and Society',
  'stat.ML': 'Statistical Machine Learning',
  'stat.ME': 'Statistical Methodology',
  'stat.TH': 'Statistics Theory',
  'stat.AP': 'Applied Statistics',
  'stat.CO': 'Computational Statistics',
  'eess.IV': 'Image and Video Processing',
  'eess.AS': 'Audio and Speech Processing',
  'eess.SP': 'Signal Processing',
  'eess.SY': 'Systems and Control',
  'math.OC': 'Optimization and Control',
  'math.PR': 'Probability',
  'math.ST': 'Statistics Theory',
  'math.NA': 'Numerical Analysis',
  'math.AG': 'Algebraic Geometry',
  'math.DG': 'Differential Geometry',
  'math.CO': 'Combinatorics',
  'math.NT': 'Number Theory',
  'math.LO': 'Mathematical Logic',
  'quant-ph': 'Quantum Physics',
  'hep-th': 'High Energy Physics Theory',
  'hep-ph': 'High Energy Physics Phenomenology',
  'hep-ex': 'High Energy Physics Experiment',
  'hep-lat': 'Lattice Field Theory',
  'gr-qc': 'General Relativity and Quantum Cosmology',
  'astro-ph.CO': 'Cosmology',
  'astro-ph.GA': 'Galaxies',
  'astro-ph.SR': 'Stellar Astrophysics',
  'astro-ph.HE': 'High Energy Astrophysics',
  'astro-ph.EP': 'Planetary Astrophysics',
  'astro-ph.IM': 'Astronomical Instrumentation',
  'cond-mat.stat-mech': 'Statistical Mechanics',
  'cond-mat.mtrl-sci': 'Materials Science',
  'cond-mat.dis-nn': 'Disordered Systems and Neural Networks',
  'q-bio.NC': 'Computational Neuroscience',
  'q-bio.QM': 'Quantitative Methods in Biology',
  'q-fin.ST': 'Statistical Finance',
  'q-fin.CP': 'Computational Finance',
}

const ARCHIVE: Record<string, string> = {
  cs: 'Computer Science',
  stat: 'Statistics',
  math: 'Mathematics',
  eess: 'Electrical Engineering',
  econ: 'Economics',
  'q-bio': 'Quantitative Biology',
  'q-fin': 'Quantitative Finance',
  'astro-ph': 'Astrophysics',
  'cond-mat': 'Condensed Matter Physics',
  physics: 'Physics',
  'math-ph': 'Mathematical Physics',
  nlin: 'Nonlinear Sciences',
  'nucl-th': 'Nuclear Physics',
  'nucl-ex': 'Nuclear Physics',
  'quant-ph': 'Quantum Physics',
  'gr-qc': 'General Relativity and Quantum Cosmology',
  hep: 'High Energy Physics',
}

/** Readable name for an arXiv category code, or '' when unknown. */
export function categoryName(code: string): string {
  const c = (code ?? '').trim()
  if (!c) return ''
  if (EXACT[c]) return EXACT[c]
  const archive = c.split('.')[0]
  if (ARCHIVE[archive]) return ARCHIVE[archive]
  if (archive.startsWith('hep-')) return ARCHIVE.hep
  return ''
}

/** A short workspace name from a paper title: the part before a colon, at most five words. */
export function shortTitle(title: string): string {
  const head = (title ?? '').split(/[:—]|\s-\s/)[0].trim()
  const words = head.split(/\s+/).filter(Boolean)
  return words.slice(0, 5).join(' ') + (words.length > 5 ? '…' : '')
}

/** Suggested workspace name for a paper: its category's readable name, else a shortened title. */
export function suggestWorkspaceName(category: string, title: string): string {
  return categoryName(category) || shortTitle(title) || 'New workspace'
}
