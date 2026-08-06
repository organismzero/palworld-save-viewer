/**
 * The GVAS reader's primitives.
 *
 * The golden suite exercises this against 13.8 MB of a real save, which is the
 * real proof. These cover the handful of things that are wrong in a way a
 * whole-file comparison would still catch but never *explain* — a byte-swapped
 * GUID, a mis-decoded string — plus the header checks, which by design nothing
 * in the reference data trips.
 */

import { describe, expect, it } from 'vitest'

import { FArchiveReader, formatGuid } from '@/parse/sav/farchive.ts'
import { GVAS_MAGIC, readHeader } from '@/parse/sav/gvasHeader.ts'

function reader(bytes: number[] | Uint8Array): FArchiveReader {
  return new FArchiveReader(Uint8Array.from(bytes))
}

/** Builds a little-endian byte sequence from mixed values. */
function bytes(...parts: (number[] | Uint8Array)[]): number[] {
  return parts.flatMap((p) => Array.from(p))
}

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
}

function ascii(s: string): number[] {
  // Unreal strings are length-prefixed and null-terminated.
  return bytes(
    u32(s.length + 1),
    [...s].map((c) => c.charCodeAt(0)),
    [0],
  )
}

describe('formatGuid', () => {
  it('reads the four little-endian words, not a straight hex dump', () => {
    // The trap: dumping these bytes in order gives
    // "00010203-0405-0607-..." which looks entirely plausible and matches
    // nothing in the save.
    const raw = Uint8Array.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
      0x0c, 0x0d, 0x0e, 0x0f,
    ])
    expect(formatGuid(raw)).toBe('03020100-0706-0504-0b0a-09080f0e0d0c')
  })

  it('renders an all-zero GUID as the canonical empty one', () => {
    expect(formatGuid(new Uint8Array(16))).toBe(
      '00000000-0000-0000-0000-000000000000',
    )
  })

  it('round-trips through the reader', () => {
    const raw = Uint8Array.from({ length: 16 }, (_, i) => i * 17)
    expect(reader(raw).guid()).toBe(formatGuid(raw))
  })
})

describe('fstring', () => {
  it('reads an ASCII string without its null terminator', () => {
    expect(reader(ascii('Kitsunebi')).fstring()).toBe('Kitsunebi')
  })

  it('reads a UTF-16 string, signalled by a negative length', () => {
    const text = '新規生成拠点'
    const units = [...text].map((c) => c.charCodeAt(0))
    const body = units.flatMap((u) => [u & 0xff, u >> 8])
    // Negative count, in UTF-16 code units, including the terminator.
    const data = bytes(u32(-(units.length + 1) >>> 0), body, [0, 0])
    expect(reader(data).fstring()).toBe(text)
  })

  it('decodes UTF-8 that is nominally declared as ASCII', () => {
    // Base names arrive this way: a positive (ASCII) length prefix over bytes
    // that are really UTF-8. Reading them as latin1 mangles every one.
    const text = '拠点'
    const utf8 = Array.from(new TextEncoder().encode(text))
    const data = bytes(u32(utf8.length + 1), utf8, [0])
    expect(reader(data).fstring()).toBe(text)
  })

  it('reads an empty string without consuming a terminator', () => {
    const r = reader(bytes(u32(0), u32(7)))
    expect(r.fstring()).toBe('')
    expect(r.u32()).toBe(7)
  })
})

describe('integers', () => {
  it('reads signed and unsigned 32-bit values differently', () => {
    const data = [0xff, 0xff, 0xff, 0xff]
    expect(reader(data).i32()).toBe(-1)
    expect(reader(data).u32()).toBe(4_294_967_295)
  })

  it('returns 64-bit values as numbers, matching the JSON path', () => {
    // .NET ticks land around 6.4e17, past Number.MAX_SAFE_INTEGER. The JSON
    // path rounds them identically because JSON.parse produces doubles, so
    // both paths agree — which is the property that matters.
    const ticks = 638_000_000_000_000_000n
    const buf = new Uint8Array(8)
    new DataView(buf.buffer).setBigInt64(0, ticks, true)
    expect(reader(buf).i64()).toBe(Number(ticks))
  })
})

describe('readHeader', () => {
  /** A minimal but valid GVAS header. */
  function header({
    magic = GVAS_MAGIC,
    saveVersion = 3,
    customFormat = 3,
  } = {}): number[] {
    return bytes(
      u32(magic),
      u32(saveVersion),
      u32(522), // package_file_version_ue4
      u32(1008), // package_file_version_ue5
      [5, 0, 1, 0, 1, 0], // engine major/minor/patch, u16 each
      u32(0), // changelist
      ascii('++UE5+Release-5.1'),
      u32(customFormat),
      u32(0), // no custom versions
      ascii('PalSaveGame'),
    )
  }

  it('reads a well-formed header', () => {
    const h = readHeader(reader(header()))
    expect(h.magic).toBe(GVAS_MAGIC)
    expect(h.engine_version_branch).toBe('++UE5+Release-5.1')
    expect(h.save_game_class_name).toBe('PalSaveGame')
    expect(h.custom_versions).toEqual([])
  })

  it('refuses a file that is not GVAS at all', () => {
    expect(() => readHeader(reader(header({ magic: 0xdeadbeef })))).toThrow(
      /not a GVAS archive/i,
    )
  })

  it('refuses a save-game version it has never seen', () => {
    // Deliberately strict: a different version may lay properties out
    // differently, and failing here beats producing subtly wrong numbers.
    expect(() => readHeader(reader(header({ saveVersion: 4 })))).toThrow(
      /save game version 4/i,
    )
  })

  it('refuses an unknown custom version format', () => {
    expect(() => readHeader(reader(header({ customFormat: 2 })))).toThrow(
      /custom version format 2/i,
    )
  })
})

describe('propertiesUntilEnd', () => {
  it('stops at the None sentinel', () => {
    const prop = (name: string, type: string, body: number[]) =>
      bytes(ascii(name), ascii(type), u32(body.length), u32(0), body)

    const data = bytes(
      // IntProperty: an optional-guid flag byte, then the value.
      prop('Level', 'IntProperty', bytes([0], u32(42))),
      prop('Rank', 'IntProperty', bytes([0], u32(3))),
      ascii('None'),
      u32(0xabcdef),
    )

    const r = reader(data)
    const props = r.propertiesUntilEnd()
    expect(props).toEqual({
      Level: { id: null, value: 42, type: 'IntProperty' },
      Rank: { id: null, value: 3, type: 'IntProperty' },
    })
    // And it left the reader positioned right after the sentinel.
    expect(r.u32()).toBe(0xabcdef)
  })

  it('throws on a property type it does not know', () => {
    const data = bytes(
      ascii('Mystery'),
      ascii('WidgetProperty'),
      u32(4),
      u32(0),
      u32(1),
    )
    expect(() => reader(data).propertiesUntilEnd()).toThrow(
      /Unknown property type: WidgetProperty/,
    )
  })
})
