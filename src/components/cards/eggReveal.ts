/**
 * Which eggs have been opened up to look inside.
 *
 * An egg laid at a Breeding Farm already knows what it will hatch, and the
 * save says so. Half the point of an egg is not knowing, so nothing in the app
 * shows it unasked: an egg's card says that there is something to see and
 * which key shows it, and only that key, pressed over that egg, does.
 *
 * Per egg, so looking in one does not spoil the twenty beside it. Kept for the
 * visit and no longer — not stored, not in the URL — because a reveal is a
 * thing done on purpose each time, not a setting.
 */

import { create } from 'zustand'

import type { Guid } from '../../domain/types.ts'

/** The key that shows and hides an egg's contents while its card is up. */
export const REVEAL_KEY = 'r'

interface EggRevealState {
  revealed: ReadonlySet<Guid>
  /** Show what is in this egg, or hide it again. */
  toggle: (dynamicId: Guid) => void
}

export const useEggReveal = create<EggRevealState>((set) => ({
  revealed: new Set(),
  toggle: (dynamicId) =>
    set((s) => {
      const revealed = new Set(s.revealed)
      if (!revealed.delete(dynamicId)) revealed.add(dynamicId)
      return { revealed }
    }),
}))
