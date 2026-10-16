import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const diagnostics = {
  database: {
    provider: 'Postgres',
    target: 'db.example:5432/cleanse',
    state: 'ok',
    detail: '12 issues',
    elapsedMilliseconds: 4.2
  },
  krds: {
    provider: 'DataBridge',
    target: 'https://krds.example',
    state: 'failed',
    detail: 'The Data Bridge answered 503.',
    elapsedMilliseconds: 31
  },
  issues: {
    state: 'ok',
    detail: null,
    total: 12,
    breakdown: [
      { status: 'active', workflowStatus: 'todo', count: 7 },
      { status: 'active', workflowStatus: 'in-progress', count: 3 },
      { status: 'inactive', workflowStatus: 'resolved', count: 2 }
    ]
  },
  lastResetAtUtc: '2026-10-01T09:30:00Z'
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

describe('#admin status', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  const get = (url = '/admin/status') => server.inject({ method: 'GET', url })

  test('Should list every dependency with its state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))

    const { statusCode, result } = await get()

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('Cleanse service connection')
    expect(result).toContain('Postgres')
    expect(result).toContain('The Data Bridge answered 503.')
  })

  test('Should show a cross for a failed dependency and a tick for a healthy one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))

    const { result } = await get()

    expect(result).toContain('app-status--ok')
    expect(result).toContain('app-status--failed')
  })

  test('Should count every status against every workflow status, including the empty ones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))

    const { result } = await get()

    // Workflow statuses with no issues still get a row, so "none suppressed" is readable.
    expect(result).toContain('Suppressed')
    expect(result).toContain('Not actionable')
    expect(result).toContain('12 issues in')
  })

  test('Should report the last reset', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(diagnostics))

    const { result } = await get()

    expect(result).toContain('1 October 2026')
  })

  test('Should say never reset when the backend has no record', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ ...diagnostics, lastResetAtUtc: null })
    )

    const { result } = await get()

    expect(result).toContain('Never reset.')
  })

  /**
   * The point of the page is to be readable when something is broken, so the one dependency it
   * cannot delegate — the backend itself — must degrade rather than throw.
   */
  test('Should still render when the backend cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { statusCode, result } = await get()

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('The Cleanse backend did not answer')
    expect(result).toContain('app-status--unknown')
    expect(result).toContain('Unknown.')
  })

  test('Should mark an unrecognised state as unknown rather than trusting it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ ...diagnostics, krds: { ...diagnostics.krds, state: 'something-new' } })
    )

    const { result } = await get()

    expect(result).toContain('app-status--unknown')
  })
})
