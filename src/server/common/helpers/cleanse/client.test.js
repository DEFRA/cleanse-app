import { vi } from 'vitest'

import { createCleanseClient, CleanseApiError } from './client.js'

const ok = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

const problem = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' }
  })

function stubFetch(response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
}

const urlOf = (fetchSpy) => new URL(fetchSpy.mock.calls[0][0])

describe('#createCleanseClient query building', () => {
  test('Should drop empty values rather than send them as blank filters', async () => {
    const fetchSpy = stubFetch(ok({ items: [] }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.searchIssues({
      groupId: 'cts-sam',
      searchTerm: '',
      ruleId: undefined,
      assignedTo: null
    })

    const { searchParams } = urlOf(fetchSpy)
    expect(searchParams.get('groupId')).toBe('cts-sam')
    expect(searchParams.has('searchTerm')).toBe(false)
    expect(searchParams.has('ruleId')).toBe(false)
    expect(searchParams.has('assignedTo')).toBe(false)
  })

  test('Should repeat a key for each value, which is how the backend binds a multi-filter', async () => {
    const fetchSpy = stubFetch(ok({ items: [] }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.searchIssues({ workflowStatus: ['todo', 'in-progress'] })

    expect(urlOf(fetchSpy).searchParams.getAll('workflowStatus')).toEqual([
      'todo',
      'in-progress'
    ])
  })

  test('Should encode an id that is not already URL-safe', async () => {
    const fetchSpy = stubFetch(ok({}))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await client.getIssue('2:01/036/8000')

    expect(fetchSpy.mock.calls[0][0]).toContain('/v1/issues/2%3A01%2F036%2F8000')
  })

  test('Should send the auth headers the strategy supplies', async () => {
    const fetchSpy = stubFetch(ok({}))
    const client = createCleanseClient({
      auth: { headers: async () => ({ 'x-cleanse-api-key': 'secret' }) }
    })

    await client.getRules()

    expect(fetchSpy.mock.calls[0][1].headers).toMatchObject({
      'x-cleanse-api-key': 'secret'
    })
  })
})

describe('#createCleanseClient error handling', () => {
  test('Should surface the stable code from the problem document', async () => {
    stubFetch(
      problem(409, {
        title: 'Conflict',
        detail: 'Issue has version 4, not the expected 3.',
        code: 'issue.concurrency_conflict'
      })
    )
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await expect(client.getIssue('abc')).rejects.toMatchObject({
      name: 'CleanseApiError',
      status: 409,
      code: 'issue.concurrency_conflict'
    })
  })

  test('Should flag a conflict and a not-found distinctly', async () => {
    expect(new CleanseApiError({ status: 409 }).isConflict).toBe(true)
    expect(new CleanseApiError({ status: 404 }).isNotFound).toBe(true)
    expect(new CleanseApiError({ status: 400 }).isConflict).toBe(false)
  })

  test('Should still raise a usable error when the body is not a problem document', async () => {
    stubFetch(new Response('<html>502</html>', { status: 502 }))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await expect(client.getRules()).rejects.toMatchObject({ status: 502 })
  })

  test('Should turn a transport failure into an unreachable error, not a crash', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const client = createCleanseClient({ auth: { headers: async () => ({}) } })

    await expect(client.getRules()).rejects.toMatchObject({
      status: 503,
      code: 'api.unreachable'
    })
  })
})
