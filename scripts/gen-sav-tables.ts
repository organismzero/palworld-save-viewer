/**
 * Regenerates the two save-format lookup tables from a PalworldSaveTools
 * checkout.
 *
 * Both are data rather than logic, and both drift when Palworld ships an
 * update: `TYPE_HINTS` gains paths when a new struct appears, and
 * `CONCRETE_MODEL_CLASS` gains ids when new buildable objects do. A stale
 * table is not an error — the reader tolerates unknown ids — but it does mean
 * `Structure.concreteModelType` goes unset for new objects, which is exactly
 * the drift `test/golden/savPipeline.golden.test.ts` measures.
 *
 * Usage:
 *
 *     pnpm gen:sav-tables [path-to-PalworldSaveTools]
 *
 * Defaults to a sibling checkout. Prints what changed and writes nothing if
 * the tables are already current.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const PST = process.argv[2] ?? resolve(process.cwd(), '..', 'PalworldSaveTools')
const SRC = join(PST, 'src', 'palsav', 'palsav')
const OUT = resolve(process.cwd(), 'src', 'parse', 'sav')

if (!existsSync(SRC)) {
  console.error(
    `No PalworldSaveTools checkout at ${PST}.\n` +
      `Pass one explicitly: pnpm gen:sav-tables /path/to/PalworldSaveTools`,
  )
  process.exit(1)
}

/**
 * Pulls a Python `{'a': 'b', ...}` literal out of a source file.
 *
 * These are flat string→string dicts written on one line, so a targeted regex
 * beats any attempt at parsing Python — and it fails loudly rather than
 * silently half-matching if the shape ever changes.
 */
function pythonStringDict(file: string, name: string): Map<string, string> {
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf(name)
  if (start === -1) throw new Error(`${name} not found in ${file}`)
  const open = source.indexOf('{', start)
  const close = source.indexOf('}\n', open)
  if (open === -1 || close === -1) {
    throw new Error(`Could not delimit ${name} in ${file}`)
  }

  const body = source.slice(open + 1, close)
  const out = new Map<string, string>()
  for (const m of body.matchAll(/'([^']+)':\s*'([^']*)'/g)) {
    out.set(m[1]!, m[2]!)
  }
  if (out.size === 0) throw new Error(`${name} parsed to nothing`)
  return out
}

/** Wraps a long space-separated list into concatenated string literals. */
function wrap(ids: string[], indent: string, width = 68): string {
  const lines: string[] = []
  let line = ''
  for (const id of ids) {
    if (line && line.length + id.length + 1 > width) {
      lines.push(line)
      line = id
    } else {
      line = line ? `${line} ${id}` : id
    }
  }
  if (line) lines.push(line)
  return lines
    .map((l, i) => `${indent}'${i === 0 ? '' : ' '}${l}'`)
    .join(' +\n')
}

/* -------------------------------------------------------------------------
   Type hints
   ------------------------------------------------------------------------- */

const hints = pythonStringDict(join(SRC, 'paltypes.py'), 'PALWORLD_TYPE_HINTS')

const hintsFile = `/**
 * Struct types the archive format cannot infer.
 *
 * Unreal writes a map's key/value struct type only sometimes; where it does
 * not, the reader has to be told. Every entry here is a path whose struct type
 * is otherwise ambiguous — get one wrong and the reader desynchronises and
 * every subsequent property is garbage.
 *
 * Generated from PalworldSaveTools \`paltypes.py\` (MIT) by
 * \`scripts/gen-sav-tables.ts\`. Do not edit by hand.
 */

export const TYPE_HINTS: Readonly<Record<string, string>> = {
${[...hints.keys()]
  .sort()
  .map((k) => `  '${k}': '${hints.get(k)}',`)
  .join('\n')}
}
`

/* -------------------------------------------------------------------------
   Concrete model classes
   ------------------------------------------------------------------------- */

const models = pythonStringDict(
  join(SRC, 'rawdata', 'map_concrete_model.py'),
  'MAP_OBJECT_NAME_TO_CONCRETE_MODEL_CLASS',
)

const byClass = new Map<string, string[]>()
for (const id of [...models.keys()].sort()) {
  const cls = models.get(id)!
  const bucket = byClass.get(cls)
  if (bucket) bucket.push(id)
  else byClass.set(cls, [id])
}

const modelsFile = `/**
 * Map-object id → concrete model class.
 *
 * Save-format metadata rather than game content: the class name is not stored
 * in the save, it is looked up from the object's id, and it is what
 * \`Structure.concreteModelType\` reports.
 *
 * Stored inverted — ${models.size} ids collapse to ${byClass.size} classes —
 * and flattened once at module load. An unknown id is not an error: a game
 * update adds objects faster than a table like this gets refreshed, and the
 * reader simply leaves \`concrete_model_type\` unset for those.
 *
 * Generated from PalworldSaveTools \`rawdata/map_concrete_model.py\` (MIT) by
 * \`scripts/gen-sav-tables.ts\`. Do not edit by hand.
 */

const BY_CLASS: Record<string, string> = {
${[...byClass.keys()]
  .sort()
  .map((cls) => `  ${cls}:\n${wrap(byClass.get(cls)!, '    ')},`)
  .join('\n')}
}

/** Keyed by lowercased map object id, as the source table is. */
export const CONCRETE_MODEL_CLASS: ReadonlyMap<string, string> = new Map(
  Object.entries(BY_CLASS).flatMap(([cls, ids]) =>
    ids.split(' ').map((id) => [id, cls] as const),
  ),
)
`

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

let changed = 0
for (const [name, contents] of [
  ['typeHints.ts', hintsFile],
  ['concreteModels.ts', modelsFile],
] as const) {
  const path = join(OUT, name)
  const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (before === contents) {
    console.log(`  unchanged  ${name}`)
    continue
  }
  writeFileSync(path, contents)
  changed += 1
  console.log(`  written    ${name}`)
}

console.log(
  `\n${hints.size} type hints, ${models.size} map objects across ` +
    `${byClass.size} model classes.` +
    (changed ? '\nRun `pnpm format` — output is not prettier-shaped.' : ''),
)
