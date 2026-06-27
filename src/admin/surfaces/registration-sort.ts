import { type AdminRegistration } from '../../../shared'

// Queue sort (ADR-0023): the operator picks the order. Default is Anmeldedatum oldest-first — the
// FIFO triage order the queue had before sorting was offered. The status tab already does the
// status filtering, so status is no longer a sort key.
export type SortKey = 'date-asc' | 'date-desc' | 'lk-asc' | 'lk-desc' | 'name-asc' | 'name-desc'

interface SortOption {
  value: SortKey
  label: string
}
export const SORT_OPTIONS: SortOption[] = [
  { value: 'date-asc', label: 'Datum ↑ (älteste)' },
  { value: 'date-desc', label: 'Datum ↓ (neueste)' },
  { value: 'lk-asc', label: 'LK ↑ (niedrigste)' },
  { value: 'lk-desc', label: 'LK ↓ (höchste)' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' }
]

// Numeric LK or null when absent/unparseable — nulls always sort to the end (ADR-0023), in both
// directions, so "no LK yet" never jumps to the top of an ascending sort.
const lkValue = (reg: AdminRegistration): number | null => {
  const n = reg.lk ? Number.parseFloat(reg.lk) : NaN
  return Number.isNaN(n) ? null : n
}
const byName = (a: AdminRegistration, b: AdminRegistration) =>
  a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')

export const compareBy =
  (sort: SortKey) =>
  (a: AdminRegistration, b: AdminRegistration): number => {
    switch (sort) {
      case 'date-asc':
        return a.createdAt.localeCompare(b.createdAt)
      case 'date-desc':
        return b.createdAt.localeCompare(a.createdAt)
      case 'name-asc':
        return byName(a, b)
      case 'name-desc':
        return byName(b, a)
      case 'lk-asc':
      case 'lk-desc': {
        const av = lkValue(a)
        const bv = lkValue(b)
        if (av === null && bv === null) return byName(a, b)
        if (av === null) return 1
        if (bv === null) return -1
        return sort === 'lk-asc' ? av - bv : bv - av
      }
    }
  }
