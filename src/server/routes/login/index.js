import { signInController, signOutController } from './controller.js'

/**
 * Signing in and out. The service sign-in page is the only page open to everyone; the admin one
 * is behind the service password, so the admin password is only asked of someone signed in.
 */
export const login = {
  plugin: {
    name: 'login',
    register(server) {
      const service = signInController('service')
      const admin = signInController('admin')

      server.route([
        {
          method: 'GET',
          path: '/login',
          options: { auth: false },
          handler: service.show
        },
        {
          method: 'POST',
          path: '/login',
          options: { auth: false },
          handler: service.submit
        },
        {
          method: 'GET',
          path: '/admin/login',
          options: { auth: 'service' },
          handler: admin.show
        },
        {
          method: 'POST',
          path: '/admin/login',
          options: { auth: 'service' },
          handler: admin.submit
        },
        {
          method: 'GET',
          path: '/logout',
          options: { auth: false },
          ...signOutController
        }
      ])
    }
  }
}
