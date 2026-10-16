import { createCleanseClient } from './client.js'
import { config } from '#/config/config.js'

/**
 * Exposes the backend client on every request, pre-bound to the trace id so the frontend
 * request and the backend work it causes land under one correlation id in the logs.
 */
export const cleanseApi = {
  plugin: {
    name: 'cleanse-api',
    register(server) {
      const client = createCleanseClient()
      const traceHeader = config.get('tracing.header')

      server.decorate('server', 'cleanse', client)

      // `apply` resolves this per request, passing the request in rather than binding `this`.
      server.decorate(
        'request',
        'cleanse',
        (request) => client.forRequest(request.headers[traceHeader]),
        { apply: true }
      )
    }
  }
}
