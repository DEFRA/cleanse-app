export function buildNavigation(request) {
  const path = request?.path ?? ''

  return [
    {
      text: 'Home',
      href: '/',
      current: path === '/'
    },
    {
      text: 'Issues',
      href: '/issues',
      current: path.startsWith('/issues')
    }
  ]
}
