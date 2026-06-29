import { isActive } from '../../shared'
import type { RegistrationRow } from '../db/schema'
import {
  byListOrder,
  bySeedingThenTime,
  nowIso,
  toConfirmedParticipant,
  type PersonInCompetition,
  type RegistrationsStore
} from './registrations'

// The in-memory registrations adapter — test scaffolding for the deep registrations Store (the D1
// adapter and the interface live in registrations.ts). It holds whole rows so the write transitions
// have something to mutate; tests seed it and drive the domain/seedingLk through the interface. Kept
// in its own file so the production adapter stays within the module line budget (the shared comparator
// and projection are imported, so the two adapters still can't drift on either).
export const createInMemoryRegistrationsStore = (seed: RegistrationRow[] = []): RegistrationsStore => {
  const rows = [...seed]
  let nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1

  const eqCi = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const matchesPerson = (r: RegistrationRow, person: PersonInCompetition) =>
    eqCi(r.email, person.email) && eqCi(r.lastName, person.lastName) && r.competition === person.competition
  const byId = (id: number) => {
    const row = rows.find(r => r.id === id)
    if (!row) throw new Error(`registration ${id} not found`)
    return row
  }

  return {
    async listConfirmed() {
      return rows
        .filter(r => r.status === 'confirmed')
        .sort(byListOrder)
        .map(toConfirmedParticipant)
    },

    async listAll() {
      return [...rows].sort(
        (a, b) =>
          a.status.localeCompare(b.status) ||
          a.competition.localeCompare(b.competition) ||
          a.createdAt.localeCompare(b.createdAt)
      )
    },

    async confirmedForDraw(competition) {
      return rows
        .filter(r => r.competition === competition && r.status === 'confirmed')
        .sort(bySeedingThenTime)
        .map(r => ({ id: r.id, lk: r.lk }))
    },

    async revealPlayers(ids) {
      const wanted = new Set(ids)
      return new Map(
        rows.filter(r => wanted.has(r.id)).map(r => [r.id, { firstName: r.firstName, lastName: r.lastName, lk: r.lk }])
      )
    },

    async findById(id) {
      return rows.find(r => r.id === id) ?? null
    },

    async findActiveRegistration(person) {
      return rows.find(r => matchesPerson(r, person) && isActive(r.status)) ?? null
    },

    async findCancelledRegistration(person) {
      return rows.find(r => matchesPerson(r, person) && r.status === 'cancelled') ?? null
    },

    async insert(data) {
      const row: RegistrationRow = {
        id: nextId++,
        playerId: null,
        lk: null,
        status: 'new',
        ...data,
        updatedAt: data.createdAt
      }
      rows.push(row)
      return row
    },

    async revive(id, fields) {
      const row = byId(id)
      Object.assign(row, { status: 'new', ...fields, updatedAt: fields.createdAt })
      return row
    },

    async setMatch(id, playerId, lk) {
      const row = byId(id)
      row.playerId = playerId
      row.lk = lk
      row.updatedAt = nowIso()
    },

    async setFields(id, fields) {
      const row = byId(id)
      Object.assign(row, fields)
      row.updatedAt = nowIso()
      return row
    },

    async setStatus(id, status) {
      const row = byId(id)
      row.status = status
      row.updatedAt = nowIso()
      return row
    },

    async setLk(id, lk) {
      const row = byId(id)
      row.lk = lk
      row.updatedAt = nowIso()
    },

    async remove(id) {
      const i = rows.findIndex(r => r.id === id)
      if (i < 0) return 0
      rows.splice(i, 1)
      return 1
    },

    async cancelActiveByPerson(person) {
      const matched = rows.filter(
        r => eqCi(r.email, person.email) && eqCi(r.lastName, person.lastName) && isActive(r.status)
      )
      matched.forEach(r => {
        r.status = 'cancelled'
        r.updatedAt = nowIso()
      })
      return matched
    },

    async countRecentByIp(ip, sinceIso) {
      return rows.filter(r => r.ip === ip && r.createdAt > sinceIso).length
    },

    async readmitAllConfirmed() {
      const confirmed = rows.filter(r => r.status === 'confirmed')
      confirmed.forEach(r => {
        r.status = 'new'
        r.updatedAt = nowIso()
      })
      return confirmed.length
    }
  }
}
