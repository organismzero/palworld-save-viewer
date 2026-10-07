/**
 * Ordering for a table whose cells are rendered nodes.
 *
 * A cell can be a pill, a link or a dash, none of which can be compared, so a
 * sortable table is given a plain value per cell beside the node. Pure, so the
 * order can be tested without rendering anything.
 */

/** What a cell sorts by. Undefined is "no value", shown as a dash. */
export type SortKey = number | string | undefined

export interface SortState {
  column: number
  desc: boolean
}

/**
 * Row indices in display order.
 *
 * A row with no value in the sorted column goes last whichever way the column
 * is turned: "—" is not a small number, and flipping the sort to see the
 * biggest should not put a column of dashes on top. Ties keep the order the
 * rows were given in.
 */
export function sortOrder(
  keys: readonly (readonly SortKey[])[],
  sort: SortState | undefined,
): number[] {
  const order = keys.map((_, i) => i)
  if (!sort) return order
  const at = (i: number) => keys[i]?.[sort.column]
  return order.sort((a, b) => {
    const x = at(a)
    const y = at(b)
    if (x === undefined || y === undefined) {
      return x === y ? a - b : x === undefined ? 1 : -1
    }
    const c =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y))
    return (sort.desc ? -c : c) || a - b
  })
}

/**
 * What a click on a column heading does.
 *
 * The same column turns over. A new one starts with the biggest number on top,
 * because that is what a count is sorted to find, and with names from A.
 */
export function nextSort(
  keys: readonly (readonly SortKey[])[],
  prev: SortState | undefined,
  column: number,
): SortState {
  if (prev?.column === column) return { column, desc: !prev.desc }
  const sample = keys.find((r) => r[column] !== undefined)?.[column]
  return { column, desc: typeof sample === 'number' }
}
