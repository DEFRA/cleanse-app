import { config } from '#/config/config.js'
import { presentIssue } from './presenter.js'
import {
  issueStatuses,
  workflowStatuses,
  openWorkflowStatuses
} from '#/server/common/constants/workflow.js'

const pageSize = 20

const toArray = (value) => {
  if (value === undefined || value === null || value === '') {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

/**
 * The first visit gets a working queue rather than every issue ever raised. `filtered=true`
 * marks a deliberate choice, so that unticking everything shows everything rather than nothing.
 */
export function readFilters(query = {}) {
  const chosen = query.filtered === 'true'

  return {
    status: chosen ? toArray(query.status) : ['active'],
    workflowStatus: chosen
      ? toArray(query.workflowStatus)
      : [...openWorkflowStatuses],
    ruleId: query.ruleId ?? 'all',
    searchTerm: (query.searchTerm ?? '').trim(),
    page: Math.max(1, Number.parseInt(query.page, 10) || 1),
    isDefault: !chosen
  }
}

/** Rebuilds the current filters as a query string, for pagination and for the back link. */
export function buildQuery(filters, page) {
  const params = new URLSearchParams({ filtered: 'true' })

  filters.status.forEach((value) => params.append('status', value))
  filters.workflowStatus.forEach((value) =>
    params.append('workflowStatus', value)
  )

  if (filters.ruleId !== 'all') {
    params.append('ruleId', filters.ruleId)
  }

  if (filters.searchTerm) {
    params.append('searchTerm', filters.searchTerm)
  }

  if (page > 1) {
    params.append('page', String(page))
  }

  return `?${params.toString()}`
}

/**
 * GOV.UK pagination shows first, last, current and its neighbours, with ellipses for the gaps.
 * Returns null for a single page, because the component should not appear at all then.
 */
export function buildPagination(filters, pageNumber, totalPages) {
  if (totalPages <= 1) {
    return null
  }

  const wanted = new Set([
    1,
    totalPages,
    pageNumber - 1,
    pageNumber,
    pageNumber + 1
  ])
  const pages = [...wanted]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)

  const items = []
  let previous = 0

  for (const page of pages) {
    if (page - previous > 1) {
      items.push({ ellipsis: true })
    }

    items.push({
      number: page,
      href: buildQuery(filters, page),
      current: page === pageNumber
    })

    previous = page
  }

  return {
    items,
    previous:
      pageNumber > 1
        ? { href: buildQuery(filters, pageNumber - 1) }
        : undefined,
    next:
      pageNumber < totalPages
        ? { href: buildQuery(filters, pageNumber + 1) }
        : undefined
  }
}

export const listController = {
  async handler(request, h) {
    const filters = readFilters(request.query)
    const groupId = config.get('cleanse.groupId')

    const [results, rules] = await Promise.all([
      request.cleanse.searchIssues({
        groupId,
        status: filters.status.length === 1 ? filters.status[0] : undefined,
        workflowStatus: filters.workflowStatus,
        ruleId: filters.ruleId === 'all' ? undefined : filters.ruleId,
        searchTerm: filters.searchTerm || undefined,
        sortBy: 'UpdatedAtUtc',
        sortDirection: 'Descending',
        pageNumber: filters.page,
        pageSize
      }),
      request.cleanse.getRules()
    ])

    const totalPages = Math.ceil(results.totalCount / results.pageSize)
    const from =
      results.totalCount === 0
        ? 0
        : (results.pageNumber - 1) * results.pageSize + 1

    // Lets "Back to issues" return to the same filters and the same page.
    request.yar.set(
      'lastIssuesQuery',
      request.url.pathname + request.url.search
    )

    return h.view('issues/list', {
      pageTitle: 'Issues',
      filters,
      issues: results.items.map(presentIssue),
      totalCount: results.totalCount,
      from,
      to: Math.min(from + results.pageSize - 1, results.totalCount),
      pagination: buildPagination(filters, results.pageNumber, totalPages),
      workflowStatusItems: workflowStatuses.map((status) => ({
        value: status.id,
        text: status.name,
        checked: filters.workflowStatus.includes(status.id)
      })),
      statusItems: issueStatuses.map((status) => ({
        value: status.id,
        text: status.name,
        checked: filters.status.includes(status.id)
      })),
      ruleItems: [
        { value: 'all', text: 'All rules', selected: filters.ruleId === 'all' },
        ...rules.map((rule) => ({
          value: rule.ruleId,
          text: `${rule.ruleNumber}. ${rule.errorDescription}`,
          selected: filters.ruleId === rule.ruleId
        }))
      ]
    })
  }
}
