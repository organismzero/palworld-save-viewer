import { describe, expect, it } from 'vitest'

import { exportName, toCsv, type Column } from '@/lib/export.ts'

interface Row {
  name: string
  level?: number
  boss?: boolean
}

const COLUMNS: Column<Row>[] = [
  { header: 'name', value: (r) => r.name },
  { header: 'level', value: (r) => r.level },
  { header: 'alpha', value: (r) => r.boss },
]

/** CSV is CRLF-delimited; splitting on it is how these tests read rows. */
function rows(csv: string): string[] {
  return csv.split('\r\n')
}

describe('toCsv', () => {
  it('writes a header even with no rows', () => {
    expect(toCsv([], COLUMNS)).toBe('name,level,alpha')
  })

  it('quotes a value containing a comma', () => {
    const csv = toCsv([{ name: 'Lamball, the Second' }], COLUMNS)
    expect(rows(csv)[1]).toBe('"Lamball, the Second",,')
  })

  it('doubles embedded quotes and wraps the field', () => {
    // The rule people get wrong: escaping is doubling, not backslashes.
    const csv = toCsv([{ name: 'He said "hi"' }], COLUMNS)
    expect(rows(csv)[1]).toBe('"He said ""hi""",,')
  })

  it('quotes a value containing a newline, keeping it inside one field', () => {
    const csv = toCsv([{ name: 'two\nlines' }], COLUMNS)
    // Splitting on CRLF must still see exactly two records: the LF is data.
    expect(rows(csv)).toHaveLength(2)
    expect(rows(csv)[1]).toBe('"two\nlines",,')
  })

  it('quotes a value containing a carriage return', () => {
    const csv = toCsv([{ name: 'a\rb' }], COLUMNS)
    expect(csv.endsWith('"a\rb",,')).toBe(true)
  })

  it('leaves ordinary values unquoted', () => {
    const csv = toCsv([{ name: 'Lamball', level: 12, boss: false }], COLUMNS)
    expect(rows(csv)[1]).toBe('Lamball,12,false')
  })

  it('writes undefined and null as empty, not as the words', () => {
    // The single most common way an exported sheet ends up full of garbage.
    const csv = toCsv([{ name: 'x', level: undefined }], COLUMNS)
    expect(rows(csv)[1]).toBe('x,,')
    expect(csv).not.toMatch(/undefined|null/)
  })

  it('keeps zero and false, which are not absent', () => {
    const csv = toCsv([{ name: 'x', level: 0, boss: false }], COLUMNS)
    expect(rows(csv)[1]).toBe('x,0,false')
  })

  it('passes unicode through untouched', () => {
    const csv = toCsv([{ name: 'ケルバイダ 🐑' }], COLUMNS)
    expect(rows(csv)[1]).toBe('ケルバイダ 🐑,,')
  })

  it('quotes a header that needs it', () => {
    const csv = toCsv<Row>([], [{ header: 'name, full', value: (r) => r.name }])
    expect(csv).toBe('"name, full"')
  })

  it('separates records with CRLF', () => {
    const csv = toCsv([{ name: 'a' }, { name: 'b' }], COLUMNS)
    expect(csv).toBe('name,level,alpha\r\na,,\r\nb,,')
  })

  it('emits no trailing newline', () => {
    // A trailing CRLF reads as an extra empty row in several spreadsheets.
    expect(toCsv([{ name: 'a' }], COLUMNS).endsWith('\r\n')).toBe(false)
  })
})

describe('exportName', () => {
  it('strips the save extension and names the kind and count', () => {
    expect(exportName('Level.sav', 'pals', 412, 'csv')).toBe(
      'Level-pals-412.csv',
    )
  })

  it('copes with no save loaded', () => {
    expect(exportName(undefined, 'pals', 0, 'csv')).toBe('save-pals-0.csv')
  })

  it('replaces characters a filesystem would reject', () => {
    expect(exportName('My World: 2024/06.sav', 'pals', 1, 'csv')).toBe(
      'My_World_2024_06-pals-1.csv',
    )
  })

  it('keeps only the last extension', () => {
    expect(exportName('Level.backup.sav', 'pals', 1, 'json')).toBe(
      'Level.backup-pals-1.json',
    )
  })
})
