import { config } from '#/config/config.js'
import {
  issueStatuses,
  workflowStatuses,
  describeIssueStatus,
  describeWorkflowStatus
} from '#/server/common/constants/workflow.js'
import { CleanseApiError } from '#/server/common/helpers/cleanse/client.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

/** Rendered as a tick, a cross or a question mark. Anything unrecognised is treated as unknown. */
const states = {
  ok: { id: 'ok', label: 'OK', symbol: '✓', colour: 'green' },
  failed: { id: 'failed', label: 'Problem', symbol: '✗', colour: 'red' },
  unknown: { id: 'unknown', label: 'Unknown', symbol: '?', colour: 'grey' }
}

const describeState = (id) => states[id] ?? states.unknown

function check({ name, state, detail, value }) {
  return { name, value, detail, stateDetail: describeState(state) }
}

/**
 * Builds the grid of status by workflow status. Every combination is shown, including the empty
 * ones: "no issues are suppressed" is a useful thing to be able to read off a status page.
 */
function buildMatrix(breakdown = []) {
  const lookup = new Map(
    breakdown.map((entry) => [`${entry.status}|${entry.workflowStatus}`, entry.count])
  )

  const rows = workflowStatuses.map((workflow) => {
    const cells = issueStatuses.map((status) => ({
      status: status.id,
      count: lookup.get(`${status.id}|${workflow.id}`) ?? 0
    }))

    return {
      workflow: describeWorkflowStatus(workflow.id),
      cells,
      total: cells.reduce((sum, cell) => sum + cell.count, 0)
    }
  })

  return {
    columns: issueStatuses.map((status) => describeIssueStatus(status.id)),
    rows,
    columnTotals: issueStatuses.map((status) => ({
      status: status.id,
      count: rows.reduce(
        (sum, row) => sum + row.cells.find((cell) => cell.status === status.id).count,
        0
      )
    }))
  }
}

export const statusController = {
  async handler(request, h) {
    const groupId = config.get('cleanse.groupId')
    let diagnostics = null
    let connection = check({
      name: 'Cleanse service connection',
      state: 'ok',
      value: config.get('cleanse.apiUrl'),
      detail: `Authenticating with ${config.get('cleanse.auth')}`
    })

    try {
      diagnostics = await request.cleanse.getDiagnostics(groupId)
    } catch (error) {
      if (!(error instanceof CleanseApiError)) {
        throw error
      }

      // The one dependency this page cannot ask the backend about is the backend itself.
      logger.error({ err: error }, 'Admin status could not reach the Cleanse backend')
      connection = check({
        name: 'Cleanse service connection',
        state: 'failed',
        value: config.get('cleanse.apiUrl'),
        detail: error.detail ?? error.message
      })
    }

    const checks = [connection]

    if (diagnostics) {
      checks.push(
        check({
          name: 'Database provider',
          state: 'ok',
          value: diagnostics.database.provider,
          detail: diagnostics.database.target
        }),
        check({
          name: 'Database connection',
          state: diagnostics.database.state,
          value: diagnostics.database.detail,
          detail: `Answered in ${Math.round(diagnostics.database.elapsedMilliseconds)}ms`
        }),
        check({
          name: 'KRDS connection',
          state: diagnostics.krds.state,
          value: diagnostics.krds.provider,
          detail: diagnostics.krds.detail ?? diagnostics.krds.target
        })
      )
    } else {
      // Everything downstream is unknowable from here, and says so rather than guessing.
      for (const name of ['Database provider', 'Database connection', 'KRDS connection']) {
        checks.push(
          check({ name, state: 'unknown', detail: 'The Cleanse backend did not answer.' })
        )
      }
    }

    return h.view('admin/status', {
      pageTitle: 'Status',
      groupId,
      checks,
      issues: diagnostics?.issues ?? null,
      matrix: diagnostics ? buildMatrix(diagnostics.issues.breakdown) : null,
      lastResetAtUtc: diagnostics?.lastResetAtUtc ?? null,
      reachedBackend: Boolean(diagnostics),
      notification: request.yar.flash('notification')[0] ?? null
    })
  }
}
