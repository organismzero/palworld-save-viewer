/**
 * `GotStatusPointList` keys arrive as Japanese strings regardless of the
 * client's language, so they need mapping before display.
 *
 * Unknown keys pass through as `unknown:<raw>` rather than being dropped — when
 * a patch adds a stat we want it to show up looking odd, not to vanish.
 */

export type StatusKey =
  'maxHp' | 'maxSp' | 'attack' | 'weight' | 'captureRate' | 'workSpeed'

export const STATUS_NAMES: Readonly<Record<string, StatusKey>> = Object.freeze({
  最大HP: 'maxHp',
  最大SP: 'maxSp',
  攻撃力: 'attack',
  所持重量: 'weight',
  捕獲率: 'captureRate',
  作業速度: 'workSpeed',
})

export const STATUS_LABELS: Readonly<Record<StatusKey, string>> = Object.freeze(
  {
    maxHp: 'Max HP',
    maxSp: 'Max SP',
    attack: 'Attack',
    weight: 'Carry Weight',
    captureRate: 'Capture Rate',
    workSpeed: 'Work Speed',
  },
)

/** Display order, matching the in-game status screen. */
export const STATUS_ORDER: readonly StatusKey[] = [
  'maxHp',
  'maxSp',
  'attack',
  'weight',
  'captureRate',
  'workSpeed',
]

export function mapStatusName(raw: string): string {
  return STATUS_NAMES[raw] ?? `unknown:${raw}`
}
