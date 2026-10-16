import { config } from '#/config/config.js'
import { runsController, runDetailController, triggerRunController } from './runs-controller.js'
import {
  importsController,
  uploadImportController,
  importDetailController
} from './imports-controller.js'
import { statusController } from './status-controller.js'
import { resetController, performResetController } from './reset-controller.js'

/** The admin menu. Reachable by URL and from the footer, never from the service navigation. */
const menu = [
  {
    text: 'Runs',
    href: '/admin/runs',
    description: 'Rule engine run history and progress, and a way to start one by hand.'
  },
  {
    text: 'SPOL imports',
    href: '/admin/imports',
    description: 'Upload a SharePoint extract and see which rows it could apply.'
  },
  {
    text: 'Status',
    href: '/admin/status',
    description: 'Dependency health, issue counts and when the database was last reset.'
  },
  {
    text: 'Reset',
    href: '/admin/reset',
    description: 'Permanently delete every issue and everything recorded against it.'
  }
]

export const adminHomeController = {
  handler: (request, h) =>
    h.view('admin/index', {
      pageTitle: 'Admin',
      groupId: config.get('cleanse.groupId'),
      menu
    })
}

export const admin = {
  plugin: {
    name: 'admin',
    register(server) {
      server.route([
        { method: 'GET', path: '/admin', ...adminHomeController },

        { method: 'GET', path: '/admin/runs', ...runsController },
        { method: 'POST', path: '/admin/runs', ...triggerRunController },
        { method: 'GET', path: '/admin/runs/{runId}', ...runDetailController },

        { method: 'GET', path: '/admin/imports', ...importsController },
        { method: 'POST', path: '/admin/imports', ...uploadImportController },
        { method: 'GET', path: '/admin/imports/{id}', ...importDetailController },

        { method: 'GET', path: '/admin/status', ...statusController },

        { method: 'GET', path: '/admin/reset', ...resetController },
        { method: 'POST', path: '/admin/reset', ...performResetController }
      ])
    }
  }
}
