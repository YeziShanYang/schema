import { describe, expect, it } from 'vitest'
import {
  checkedPerPaperAll,
  coverage,
  hasStarted,
  inLibrary,
  libraryEntries,
  nameList,
  placementLabel,
  removeText,
  saveState,
  savedAtOnFile,
  savedAtOnRemove,
  savedAtOnReopen,
  savedAtOnSave,
  type FiledPaper,
  type RoadmapRow,
} from './membership'

const NOW = 1_800_000_000_000

const roadmap = (paperId: string, data: Partial<RoadmapRow['data']> = {}): RoadmapRow => ({
  recordId: `r-${paperId}`,
  data: { paperId, arxivId: `a-${paperId}`, title: `Paper ${paperId}`, status: 'reading', lastOpenedAt: 0, ...data },
})
const filed = (workspaceId: string, paperId: string, addedAt = 0): FiledPaper => ({
  workspaceId,
  paperId,
  arxivId: `a-${paperId}`,
  title: `Paper ${paperId}`,
  addedAt,
})
const ids = (entries: { id: string }[]) => entries.map((e) => e.id)

describe('saveState', () => {
  it('reads a missing value as undecided, a time as saved and 0 as removed', () => {
    expect(saveState(undefined)).toBe('undecided')
    expect(saveState(null)).toBe('undecided')
    expect(saveState(Number.NaN)).toBe('undecided')
    expect(saveState(NOW)).toBe('saved')
    expect(saveState(0)).toBe('removed')
  })
})

describe('hasStarted', () => {
  it('counts a checked concept, the overview read and a finished paper', () => {
    expect(hasStarted({ status: 'reading' }, 1)).toBe(true)
    expect(hasStarted({ status: 'reading', overviewReadAt: NOW }, 0)).toBe(true)
    expect(hasStarted({ status: 'finished' }, 0)).toBe(true)
  })

  it('does not count opening the paper', () => {
    expect(hasStarted({ status: 'reading', overviewReadAt: 0 }, 0)).toBe(false)
    expect(hasStarted(undefined, 0)).toBe(false)
  })
})

describe('checkedPerPaperAll', () => {
  it('counts known checkmarks per paper, stale ones included', () => {
    const rows = [
      { data: { paperId: 'p1', status: 'known' } },
      { data: { paperId: 'p1', status: 'known', stale: true } },
      { data: { paperId: 'p2', status: 'learning' } },
    ]
    expect([...checkedPerPaperAll(rows)]).toEqual([['p1', 2]])
  })
})

describe('inLibrary', () => {
  it('holds a paper that is in a workspace, whatever its save state', () => {
    for (const savedAt of [undefined, 0, NOW]) expect(inLibrary({ savedAt, workspaceCount: 1, started: false })).toBe(true)
  })

  it('holds a saved paper in no workspace', () => {
    expect(inLibrary({ savedAt: NOW, workspaceCount: 0, started: false })).toBe(true)
  })

  it('holds a started paper only while the reader never decided', () => {
    expect(inLibrary({ savedAt: undefined, workspaceCount: 0, started: true })).toBe(true)
    expect(inLibrary({ savedAt: 0, workspaceCount: 0, started: true })).toBe(false)
  })

  it('leaves out a paper the reader only opened', () => {
    expect(inLibrary({ savedAt: undefined, workspaceCount: 0, started: false })).toBe(false)
    expect(inLibrary({ savedAt: 0, workspaceCount: 0, started: false })).toBe(false)
  })
})

describe('transitions', () => {
  it('Save sets the time, and unsave or Remove from Library sets 0', () => {
    expect(savedAtOnSave(NOW)).toBe(NOW)
    expect(savedAtOnRemove()).toBe(0)
  })

  it('filing saves a paper that is not saved yet and keeps an earlier save time', () => {
    expect(savedAtOnFile(undefined, NOW)).toBe(NOW)
    expect(savedAtOnFile(null, NOW)).toBe(NOW)
    expect(savedAtOnFile(0, NOW)).toBe(NOW)
    expect(savedAtOnFile(NOW - 5, NOW)).toBeNull()
  })

  it('reading again saves only an undecided paper', () => {
    expect(savedAtOnReopen(undefined, NOW)).toBe(NOW)
    expect(savedAtOnReopen(0, NOW)).toBeNull()
    expect(savedAtOnReopen(NOW - 5, NOW)).toBeNull()
  })

  it('a filed paper taken out of its last workspace stays in the Library', () => {
    // Added to a workspace while undecided and not started.
    const afterAdd = savedAtOnFile(undefined, NOW) ?? undefined
    expect(inLibrary({ savedAt: afterAdd, workspaceCount: 1, started: false })).toBe(true)
    expect(inLibrary({ savedAt: afterAdd, workspaceCount: 0, started: false })).toBe(true)
  })

  it('a finished paper read again stays in the Library', () => {
    expect(inLibrary({ savedAt: undefined, workspaceCount: 0, started: hasStarted({ status: 'finished' }, 0) })).toBe(true)
    const afterReopen = savedAtOnReopen(undefined, NOW) ?? undefined
    expect(inLibrary({ savedAt: afterReopen, workspaceCount: 0, started: hasStarted({ status: 'reading' }, 0) })).toBe(true)
  })
})

describe('libraryEntries', () => {
  it('keeps old rows correct: a started paper is in, a paper only opened is out', () => {
    const entries = libraryEntries(
      [roadmap('opened', { lastOpenedAt: 3 }), roadmap('checked', { lastOpenedAt: 2 }), roadmap('overview', { lastOpenedAt: 1, overviewReadAt: 1 })],
      [],
      new Map([['checked', 2]]),
    )
    expect(ids(entries)).toEqual(['checked', 'overview'])
  })

  it('lists saved papers and leaves out removed ones, even when started', () => {
    const entries = libraryEntries(
      [roadmap('saved', { savedAt: NOW }), roadmap('removed', { savedAt: 0, status: 'finished' })],
      [],
      new Map([['removed', 4]]),
    )
    expect(ids(entries)).toEqual(['saved'])
  })

  it('lists a paper that is only in a workspace, with no roadmaps row', () => {
    const [e] = libraryEntries([], [filed('w1', 'p1', 7)], new Map())
    expect(e).toEqual({
      id: 'p1',
      data: { paperId: 'p1', arxivId: 'a-p1', title: 'Paper p1', status: 'reading', lastOpenedAt: 0, savedAt: null, workspaceIds: ['w1'], roadmapId: null },
    })
  })

  it('names every workspace of a paper once, in the order given, and keeps a removed paper that is filed', () => {
    const [e] = libraryEntries([roadmap('p1', { savedAt: 0 })], [filed('w2', 'p1'), filed('w1', 'p1'), filed('w2', 'p1')], new Map())
    expect(e.data.workspaceIds).toEqual(['w2', 'w1'])
    expect(e.data.roadmapId).toBe('r-p1')
  })

  it('orders by last opened, then never-opened papers by when they were saved or filed', () => {
    const entries = libraryEntries(
      [
        roadmap('old', { lastOpenedAt: 10, savedAt: NOW }),
        roadmap('new', { lastOpenedAt: 20, savedAt: NOW }),
        roadmap('savedEarly', { savedAt: 100 }),
        roadmap('savedLate', { savedAt: 300 }),
      ],
      [filed('w1', 'filedOnly', 200)],
      new Map(),
    )
    expect(ids(entries)).toEqual(['new', 'old', 'savedLate', 'filedOnly', 'savedEarly'])
  })

  it('reads a finished roadmap as finished and anything else as reading', () => {
    const entries = libraryEntries([roadmap('f', { status: 'finished', lastOpenedAt: 2 }), roadmap('r', { status: 'reading', savedAt: NOW, lastOpenedAt: 1 })], [], new Map())
    expect(entries.map((e) => e.data.status)).toEqual(['finished', 'reading'])
  })
})

describe('placementLabel', () => {
  it('names where the paper is', () => {
    expect(placementLabel(false, [])).toBe('Save')
    expect(placementLabel(true, [])).toBe('In Library')
    expect(placementLabel(true, ['CS 229'])).toBe('In CS 229')
    expect(placementLabel(true, ['CS 229', 'Climate'])).toBe('In CS 229 +1')
    expect(placementLabel(true, ['CS 229', 'Climate', 'Vision'])).toBe('In CS 229 +2')
  })
})

describe('coverage', () => {
  it('says whether a workspace holds all, some or none of the papers', () => {
    const ws = new Set(['p1', 'p2'])
    expect(coverage(ws, ['p1', 'p2'])).toBe('all')
    expect(coverage(ws, ['p1', 'p3'])).toBe('some')
    expect(coverage(ws, ['p3'])).toBe('none')
  })
})

describe('removeText', () => {
  it('names the workspaces the paper leaves and says the checkmarks stay', () => {
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C')
    expect(removeText([])).toBe('It leaves your Library. Your checkmarks stay, so your progress is kept if you add it again.')
    expect(removeText(['CS 229'])).toBe('It leaves your Library and is taken out of CS 229. Your checkmarks stay, so your progress is kept if you add it again.')
    expect(removeText(['CS 229', 'Climate'])).toBe(
      'It leaves your Library and is taken out of 2 workspaces: CS 229 and Climate. Your checkmarks stay, so your progress is kept if you add it again.',
    )
  })
})
