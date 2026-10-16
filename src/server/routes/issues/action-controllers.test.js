import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

const issue = {
  id: '2-JBSWY3DPEHPK3PXP',
  groupId: 'cts-sam',
  ruleId: '2',
  status: 'active',
  workflowStatus: 'todo',
  version: 4,
  createdAtUtc: '2026-10-01T09:00:00Z',
  updatedAtUtc: '2026-10-02T09:00:00Z',
  context: {
    cph: '01/036/8000',
    ruleNumber: '2',
    errorCode: '02',
    errorDescription: 'CTS-CPH-missing-in-Sam'
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

/** Answers whichever backend call the controller makes, in the order it makes them. */
function stubBackend({ onMutate } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(
        url.includes('/history') ? json({ items: [], totalCount: 0 }) : json(issue)
      )
    }

    return Promise.resolve(onMutate ? onMutate(url, init) : json(issue))
  })
}

describe('#issue actions', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  /** A POST needs a valid crumb, so take one from a rendered page the way a browser would. */
  async function withCrumb(url) {
    const page = await server.inject({ method: 'GET', url })
    const cookie = page.headers['set-cookie']?.[0].split(';')[0]
    const crumb = /name="crumb" value="([^"]+)"/.exec(page.result)?.[1]

    return { crumb, cookie }
  }

  test('Should reject a POST that carries no CSRF token', async () => {
    stubBackend()

    const { statusCode } = await server.inject({
      method: 'POST',
      url: `/issues/${issue.id}/start`,
      payload: { expectedVersion: '4' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('Should send the version the form carried, so a stale page cannot overwrite', async () => {
    const fetchSpy = stubBackend()
    const { crumb, cookie } = await withCrumb(`/issues/${issue.id}`)

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: `/issues/${issue.id}/start`,
      headers: { cookie },
      payload: { crumb, expectedVersion: '4' }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(`/issues/${issue.id}`)

    const mutation = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(mutation[1].body)).toEqual({
      workflowStatus: 'in-progress',
      expectedVersion: 4
    })
  })

  test('Should explain a conflict rather than silently overwriting', async () => {
    stubBackend({
      onMutate: () =>
        json(
          {
            title: 'Conflict',
            detail: 'Issue has version 5, not the expected 4.',
            code: 'issue.concurrency_conflict'
          },
          statusCodes.conflict
        )
    })

    const { crumb, cookie } = await withCrumb(`/issues/${issue.id}`)
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: `/issues/${issue.id}/start`,
      headers: { cookie },
      payload: { crumb, expectedVersion: '4' }
    })

    expect(statusCode).toBe(statusCodes.conflict)
    expect(result).toEqual(expect.stringContaining('This issue has changed'))
  })
})
