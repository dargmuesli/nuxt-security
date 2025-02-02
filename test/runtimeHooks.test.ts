import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, fetch } from '@nuxt/test-utils'

await setup({
  rootDir: fileURLToPath(new URL('./fixtures/runtimeHooks', import.meta.url))
})

describe('[nuxt-security] runtime hooks', () => {
  it('expect csp to be set to static values by the (deprecated) headers runtime hook', async () => {
    const res = await fetch('/headers-static')
    expect(res.headers.get('Content-Security-Policy')).toBe("base-uri 'none'; default-src 'none'; connect-src 'self' https:; font-src 'self' https: data:; form-action 'self'; frame-ancestors * weird-value.com; frame-src 'self'; img-src 'self' data:; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; script-src 'self' static-value.com; upgrade-insecure-requests; worker-src 'self';")
    expect(res.headers.get('X-Powered-By')).toBeNull()
  })
  

  it('expect csp to be set to dynamically-fetched values by the (deprecated) headers runtime hook', async () => {
    const res = await fetch('/headers-dynamic')
    expect(res.headers.get('Content-Security-Policy')).toBe("base-uri 'none'; default-src 'none'; connect-src 'self' https:; font-src 'self' https: data:; form-action 'self'; frame-ancestors * weird-value.com; frame-src 'self'; img-src 'self' data:; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; script-src 'self' *.dynamic-value.com; upgrade-insecure-requests; worker-src 'self';")
    expect(res.headers.get('X-Powered-By')).toBeNull()
  })

  it('expect any security option to be modified by the new routeRules runtime hook', async () => {
    const res = await fetch('/rules-static')
    expect(res.headers.get('Content-Security-Policy')).toBe("base-uri 'none'; default-src 'none'; connect-src 'self' https:; font-src 'self' https: data:; form-action 'self'; frame-ancestors * weird-value.com; frame-src 'self'; img-src 'self' data:; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; script-src 'self' static-value.com; upgrade-insecure-requests; worker-src 'self';")
    expect(res.headers.get('X-Powered-By')).toEqual('Nuxt')
  })

  it('expect any security option to be dynamically-fetched by the new routeRules runtime hook', async () => {
    const res = await fetch('/rules-dynamic')
    const csp = res.headers.get('Content-Security-Policy')
    expect(csp).toBe("base-uri 'none'; default-src 'none'; connect-src 'self' https:; font-src 'self' https: data:; form-action 'self'; frame-ancestors * weird-value.com; frame-src 'self'; img-src 'self' data:; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; script-src 'self' *.dynamic-value.com; upgrade-insecure-requests; worker-src 'self';")
    expect(res.headers.get('X-Powered-By')).toEqual('Nuxt')
  })
})