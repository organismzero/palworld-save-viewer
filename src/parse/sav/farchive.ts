/**
 * The GVAS archive reader.
 *
 * A port of PalworldSaveTools' `FArchiveReader` (`src/palsav/palsav/archive.py`),
 * which is itself a reimplementation of Unreal's property serialisation.
 *
 * ## The output shape is not a design choice
 *
 * Everything here produces exactly the object graph that the Python tool emits
 * when it writes `Level.json` — including field names, field order-independence,
 * and the two byte encodings (`{'~b': base64}` for opaque blobs, plain number
 * arrays where the original decoder returned a list). That is deliberate and
 * load-bearing: `buildIndexes` already consumes that shape, so matching it
 * means the `.sav` path and the `.json` path converge on one parser rather than
 * two, and the golden test can assert they produce identical results.
 *
 * ## GUIDs
 *
 * Unreal stores a GUID as four little-endian u32s, so the textual form is a
 * byte-swapped read of the 16 raw bytes rather than a straight hex dump.
 * Getting this wrong produces plausible-looking GUIDs that match nothing.
 */

export type Json = unknown

const decoder = new TextDecoder('utf-8')
const utf16 = new TextDecoder('utf-16le')
const ascii = new TextDecoder('latin1')

export class FArchiveReader {
  readonly view: DataView
  readonly bytes: Uint8Array
  offset = 0

  constructor(
    bytes: Uint8Array,
    /** Struct types the format cannot infer; keyed by property path. */
    readonly typeHints: Readonly<Record<string, string>> = {},
    /** Palworld's byte-blob decoders, keyed by property path. */
    readonly customProperties: Readonly<
      Record<
        string,
        (
          r: FArchiveReader,
          type: string,
          size: number,
          path: string,
        ) => Record<string, Json>
      >
    > = {},
  ) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  /** A reader over a slice, sharing the hint and custom-property registries. */
  sub(bytes: Uint8Array): FArchiveReader {
    return new FArchiveReader(bytes, this.typeHints, this.customProperties)
  }

  get size(): number {
    return this.bytes.length
  }

  eof(): boolean {
    return this.offset >= this.size
  }

  read(n: number): Uint8Array {
    const out = this.bytes.subarray(this.offset, this.offset + n)
    this.offset += n
    return out
  }

  readToEnd(): Uint8Array {
    return this.read(this.size - this.offset)
  }

  skip(n: number): void {
    this.offset += n
  }

  bool(): boolean {
    return this.byte() > 0
  }

  byte(): number {
    return this.view.getUint8(this.offset++)
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true)
    this.offset += 2
    return v
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  i32(): number {
    const v = this.view.getInt32(this.offset, true)
    this.offset += 4
    return v
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  /**
   * 64-bit integers arrive as `number`.
   *
   * Lossy above 2^53, and deliberately so: the JSON path is lossy in exactly
   * the same way, because `JSON.parse` produces doubles. Tick counts (~6.4e17)
   * are the values this affects, and `domain/types.ts` already documents that
   * they are safe to display and never safe to compare. Reading them as
   * `bigint` here would make the two paths disagree.
   */
  i64(): number {
    const v = this.view.getBigInt64(this.offset, true)
    this.offset += 8
    return Number(v)
  }

  u64(): number {
    const v = this.view.getBigUint64(this.offset, true)
    this.offset += 8
    return Number(v)
  }

  float(): number {
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  double(): number {
    const v = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return v
  }

  /**
   * A length-prefixed Unreal string.
   *
   * A negative length means UTF-16; positive means ASCII. Both include a
   * trailing null that is stripped.
   */
  fstring(): string {
    const size = this.i32()
    if (size === 0) return ''
    if (size < 0) {
      const bytes = this.read(-size * 2)
      return utf16.decode(bytes.subarray(0, bytes.length - 2))
    }
    const bytes = this.read(size)
    const body = bytes.subarray(0, bytes.length - 1)
    // Nominally ASCII, but saves carry UTF-8 in these fields in practice —
    // Japanese base names among them. Decoding as latin1 would mangle those.
    try {
      return decoder.decode(body)
    } catch {
      return ascii.decode(body)
    }
  }

  /** 16 raw bytes, rendered in Unreal's byte-swapped textual order. */
  guid(): string {
    return formatGuid(this.read(16))
  }

  optionalGuid(): string | null {
    return this.byte() ? this.guid() : null
  }

  tarray<T>(read: (r: FArchiveReader) => T): T[] {
    const count = this.u32()
    const out: T[] = new Array(count)
    for (let i = 0; i < count; i++) out[i] = read(this)
    return out
  }

  /**
   * An opaque byte run.
   *
   * The JSON path renders these as `{'~b': base64}`; this path keeps the bytes.
   * That is the one place the two representations differ, and it is safe
   * because **no reader consumes a raw byte blob** — they are trailing padding,
   * custom-version stamps and unparsed tails. Base64-encoding them would mean
   * building megabytes of string for data nothing reads.
   */
  byteList(n: number): Uint8Array {
    return this.read(n)
  }

  /** A byte run as plain numbers, for decoders whose Python returns a list. */
  byteNumbers(n: number): number[] {
    return Array.from(this.read(n))
  }

  vectorDict(): { x: number; y: number; z: number } {
    return { x: this.double(), y: this.double(), z: this.double() }
  }

  quatDict(): { x: number; y: number; z: number; w: number } {
    return {
      x: this.double(),
      y: this.double(),
      z: this.double(),
      w: this.double(),
    }
  }

  ftransform() {
    return {
      rotation: this.quatDict(),
      translation: this.vectorDict(),
      scale3d: this.vectorDict(),
    }
  }

  compressedShortRotator(): [number, number, number] {
    const pitch = this.bool() ? this.u16() : 0
    const yaw = this.bool() ? this.u16() : 0
    const roll = this.bool() ? this.u16() : 0
    const s = 360 / 65536
    return [pitch * s, yaw * s, roll * s]
  }

  serializeInt(bitCount: number): number {
    const b = Array.from(this.read(Math.floor((bitCount + 7) / 8)))
    if (bitCount % 8 !== 0 && b.length > 0) {
      b[b.length - 1]! &= (1 << (bitCount % 8)) - 1
    }
    let value = 0
    for (let i = b.length - 1; i >= 0; i--) value = value * 256 + b[i]!
    return value
  }

  packedVector(scale: number): [number, number, number] {
    const info = this.u32()
    const bitCount = info & 63
    const extra = info >> 6
    if (bitCount > 0) {
      const raw = [
        this.serializeInt(bitCount),
        this.serializeInt(bitCount),
        this.serializeInt(bitCount),
      ]
      const signBit = 1 << (bitCount - 1)
      const signed = raw.map((v) => (v & (signBit - 1)) - (v & signBit)) as [
        number,
        number,
        number,
      ]
      return extra
        ? [signed[0] / scale, signed[1] / scale, signed[2] / scale]
        : signed
    }
    return extra
      ? [this.double(), this.double(), this.double()]
      : [this.float(), this.float(), this.float()]
  }

  /* ---------------------------------------------------------------------
     Properties
     --------------------------------------------------------------------- */

  typeOr(path: string, fallback: string): string {
    return this.typeHints[path] ?? fallback
  }

  propertiesUntilEnd(path = ''): Record<string, Json> {
    const out: Record<string, Json> = {}
    for (;;) {
      const name = this.fstring()
      if (name === 'None') break
      const typeName = this.fstring()
      const size = this.u64()
      out[name] = this.property(typeName, size, `${path}.${name}`)
    }
    return out
  }

  property(
    typeName: string,
    size: number,
    path: string,
    nestedCallerPath = '',
  ): Record<string, Json> {
    const custom = this.customProperties[path]
    let value: Record<string, Json>
    if (custom && (path !== nestedCallerPath || nestedCallerPath === '')) {
      value = custom(this, typeName, size, path)
      value['custom_type'] = path
    } else {
      value = this.readProperty(typeName, size, path)
    }
    value['type'] = typeName
    return value
  }

  private readProperty(
    typeName: string,
    size: number,
    path: string,
  ): Record<string, Json> {
    switch (typeName) {
      case 'StructProperty':
        return this.struct(path)
      case 'IntProperty':
        return { id: this.optionalGuid(), value: this.i32() }
      case 'UInt16Property':
        return { id: this.optionalGuid(), value: this.u16() }
      case 'UInt32Property':
        return { id: this.optionalGuid(), value: this.u32() }
      case 'UInt64Property':
        return { id: this.optionalGuid(), value: this.u64() }
      case 'Int64Property':
        return { id: this.optionalGuid(), value: this.i64() }
      // Despite the name, the on-disk form is a plain i32 — the fixed-point
      // scaling lives in the game, not the serialiser.
      case 'FixedPoint64Property':
        return { id: this.optionalGuid(), value: this.i32() }
      case 'FloatProperty':
        return { id: this.optionalGuid(), value: this.float() }
      case 'DoubleProperty':
        return { id: this.optionalGuid(), value: this.double() }
      case 'StrProperty':
      case 'NameProperty':
        return { id: this.optionalGuid(), value: this.fstring() }
      case 'EnumProperty': {
        const enumType = this.fstring()
        const id = this.optionalGuid()
        return { id, value: { type: enumType, value: this.fstring() } }
      }
      // Note the field order: `value` before `id`, unlike every other case.
      // It is what the Python emits, and object key order is not significant
      // to the consumer, but keeping it faithful makes diffs readable.
      case 'BoolProperty':
        return { value: this.bool(), id: this.optionalGuid() }
      case 'ByteProperty': {
        const enumType = this.fstring()
        const id = this.optionalGuid()
        const value = enumType === 'None' ? this.byte() : this.fstring()
        return { id, value: { type: enumType, value } }
      }
      case 'ArrayProperty': {
        const arrayType = this.fstring()
        const id = this.optionalGuid()
        return {
          array_type: arrayType,
          id,
          value: this.arrayProperty(arrayType, size, path),
        }
      }
      case 'MapProperty':
        return this.mapProperty(path)
      case 'SetProperty':
        return this.setProperty(path)
      default:
        throw new Error(`Unknown property type: ${typeName} (${path})`)
    }
  }

  private mapProperty(path: string): Record<string, Json> {
    const keyType = this.fstring()
    const valueType = this.fstring()
    const id = this.optionalGuid()
    this.u32()
    const count = this.u32()

    const keyPath = `${path}.Key`
    const keyStructType =
      keyType === 'StructProperty' ? this.typeOr(keyPath, 'Guid') : null
    const valuePath = `${path}.Value`
    const valueStructType =
      valueType === 'StructProperty'
        ? this.typeOr(valuePath, 'StructProperty')
        : null

    const values: { key: Json; value: Json }[] = new Array(count)
    for (let i = 0; i < count; i++) {
      values[i] = {
        key: this.propValue(keyType, keyStructType, keyPath),
        value: this.propValue(valueType, valueStructType, valuePath),
      }
    }
    return {
      key_type: keyType,
      value_type: valueType,
      key_struct_type: keyStructType,
      value_struct_type: valueStructType,
      id,
      value: values,
    }
  }

  private setProperty(path: string): Record<string, Json> {
    const setType = this.fstring()
    const id = this.optionalGuid()
    this.u32()
    const count = this.u32()
    let structType: string | null = null
    let values: Json[]
    if (setType === 'StructProperty') {
      structType = this.typeOr(`${path}.StructProperty`, 'StructProperty')
      values = Array.from({ length: count }, () =>
        this.structValue(structType!, `${path}.StructProperty`),
      )
    } else {
      values = Array.from({ length: count }, () => this.propertiesUntilEnd())
    }
    return { set_type: setType, struct_type: structType, id, value: values }
  }

  propValue(
    typeName: string,
    structTypeName: string | null,
    path: string,
  ): Json {
    switch (typeName) {
      case 'StructProperty':
        return this.structValue(structTypeName ?? 'StructProperty', path)
      case 'EnumProperty':
      case 'NameProperty':
      case 'StrProperty':
        return this.fstring()
      case 'IntProperty':
        return this.i32()
      case 'BoolProperty':
        return this.bool()
      case 'UInt32Property':
        return this.u32()
      case 'Int64Property':
        return this.i64()
      default:
        throw new Error(`Unknown property value type: ${typeName} (${path})`)
    }
  }

  struct(path: string): Record<string, Json> {
    const structType = this.fstring()
    const structId = this.guid()
    const id = this.optionalGuid()
    return {
      struct_type: structType,
      struct_id: structId,
      id,
      value: this.structValue(structType, path),
    }
  }

  structValue(structType: string, path = ''): Json {
    switch (structType) {
      case 'Vector':
        return this.vectorDict()
      case 'DateTime':
        return this.u64()
      case 'Guid':
        return this.guid()
      case 'Quat':
        return this.quatDict()
      case 'LinearColor':
        return {
          r: this.float(),
          g: this.float(),
          b: this.float(),
          a: this.float(),
        }
      case 'Color':
        return {
          b: this.byte(),
          g: this.byte(),
          r: this.byte(),
          a: this.byte(),
        }
      default:
        return this.propertiesUntilEnd(path)
    }
  }

  arrayProperty(
    arrayType: string,
    size: number,
    path: string,
  ): Record<string, Json> {
    const count = this.u32()
    if (arrayType === 'StructProperty') {
      const propName = this.fstring()
      const propType = this.fstring()
      this.u64()
      const typeName = this.fstring()
      const id = this.guid()
      this.skip(1)
      const values: Json[] = new Array(count)
      for (let i = 0; i < count; i++) {
        values[i] = this.structValue(typeName, `${path}.${propName}`)
      }
      return {
        prop_name: propName,
        prop_type: propType,
        values,
        type_name: typeName,
        id,
      }
    }
    return { values: this.arrayValue(arrayType, count, size - 4, path) }
  }

  arrayValue(
    arrayType: string,
    count: number,
    size: number,
    path: string,
  ): Json {
    switch (arrayType) {
      case 'EnumProperty':
      case 'NameProperty':
      case 'StrProperty':
        return Array.from({ length: count }, () => this.fstring())
      case 'Guid':
        return Array.from({ length: count }, () => this.guid())
      case 'ByteProperty':
        // Kept as bytes rather than tagged: the custom `RawData` decoders read
        // these directly, and the generic path's consumers never look.
        if (size === count) return this.read(count)
        throw new Error('Labelled ByteProperty not implemented')
      case 'IntProperty':
        return Array.from({ length: count }, () => this.i32())
      case 'FloatProperty':
        return Array.from({ length: count }, () => this.float())
      default:
        throw new Error(`Unknown array type: ${arrayType} (${path})`)
    }
  }
}

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
)

/**
 * Unreal's textual GUID order.
 *
 * The 16 bytes are four little-endian u32s, so the first group reverses bytes
 * 0–3, the next two reverse pairs, and the tail is byte-ordered. A plain hex
 * dump of the same bytes yields a different, wrong string that still *looks*
 * like a GUID — which is why this has its own test.
 */
export function formatGuid(b: Uint8Array): string {
  return (
    HEX[b[3]!]! +
    HEX[b[2]!] +
    HEX[b[1]!] +
    HEX[b[0]!] +
    '-' +
    HEX[b[7]!] +
    HEX[b[6]!] +
    '-' +
    HEX[b[5]!] +
    HEX[b[4]!] +
    '-' +
    HEX[b[11]!] +
    HEX[b[10]!] +
    '-' +
    HEX[b[9]!] +
    HEX[b[8]!] +
    HEX[b[15]!] +
    HEX[b[14]!] +
    HEX[b[13]!] +
    HEX[b[12]!]
  )
}
