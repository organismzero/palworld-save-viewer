import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The DOM id a tab renders with.
 *
 * Lives here rather than beside `TabBar` so that both halves of the ARIA
 * relationship read from one convention: the strip sets these ids, and the
 * tabpanel it drives points back at the active one with `aria-labelledby`.
 */
export function tabId(name: string, id: string) {
  return `${name}-tab-${id}`
}
