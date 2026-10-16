import { buildNavigation } from './build-navigation.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildNavigation', () => {
  test('Should provide expected navigation details', () => {
    expect(buildNavigation(mockRequest({ path: '/non-existent-path' }))).toEqual([
      {
        current: false,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Issues',
        href: '/issues'
      }
    ])
  })

  test('Should provide expected highlighted navigation details', () => {
    expect(buildNavigation(mockRequest({ path: '/' }))).toEqual([
      {
        current: true,
        text: 'Home',
        href: '/'
      },
      {
        current: false,
        text: 'Issues',
        href: '/issues'
      }
    ])
  })

  test('Should highlight Issues for any page beneath it', () => {
    const navigation = buildNavigation(mockRequest({ path: '/issues/2-ABCDEFGH/suppress' }))

    expect(navigation[1]).toEqual({
      current: true,
      text: 'Issues',
      href: '/issues'
    })
  })

  test('Should cope with a request that has no path', () => {
    expect(buildNavigation(undefined)).toEqual([
      { current: false, text: 'Home', href: '/' },
      { current: false, text: 'Issues', href: '/issues' }
    ])
  })
})
