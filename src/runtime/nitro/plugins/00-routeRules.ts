import { defineNitroPlugin, useRuntimeConfig, useStorage } from "#imports"
import { defuReplaceArray } from "../utils"
import { OptionKey, SecurityHeaders } from "../../../types/headers"
import { getKeyFromName, headerObjectFromString } from "../../utils/headers"
import { getAppSecurityOptions } from '../context'

/**
 * This plugin merges all security options into the global security context
 */
export default defineNitroPlugin(async(nitroApp) => {
  const appSecurityOptions = getAppSecurityOptions()
  const runtimeConfig = useRuntimeConfig()
  // First insert standard route rules headers
  for (const route in runtimeConfig.nitro.routeRules) {
    const rule = runtimeConfig.nitro.routeRules[route]
    const { headers } = rule
    const securityHeaders = standardToSecurity(headers)
    if (securityHeaders) {
      appSecurityOptions[route] = { headers: securityHeaders }
    }
  }

  // Then insert global security config
  const securityOptions = runtimeConfig.security
  appSecurityOptions['/**'] = defuReplaceArray(
    securityOptions,
    appSecurityOptions['/**']
  )

  // Then insert route specific security headers
  for (const route in runtimeConfig.nitro.routeRules) {
    const rule = runtimeConfig.nitro.routeRules[route]
    const { security } = rule
    if (security) {
      const { headers } = security
      const securityHeaders = backwardsCompatibleSecurity(headers)
      appSecurityOptions[route] = defuReplaceArray(
        { headers: securityHeaders },
        security,
        appSecurityOptions[route],
      )
    }
  }

  // TO DO : DEPRECATE IN FAVOR OF NUXT-SECURITY:ROUTERULES HOOK
  nitroApp.hooks.hook('nuxt-security:headers', ({ route, headers }) => {
    appSecurityOptions[route] = defuReplaceArray(
      { headers },
      appSecurityOptions[route]
    )
  })

  // NEW HOOK HAS ABILITY TO CONFIGURE ALL SECURITY OPTIONS FOR EACH ROUTE
  nitroApp.hooks.hook('nuxt-security:ready', async() => {
    await nitroApp.hooks.callHook('nuxt-security:routeRules', appSecurityOptions)
  })

  await nitroApp.hooks.callHook('nuxt-security:ready')
})

/**
 * Convert standard headers string format to security headers object format, returning undefined if no valid security header is found
 */
function standardToSecurity(standardHeaders?: Record<string, any>) {
  if (!standardHeaders) {
    return undefined
  }

  const standardHeadersAsObject: SecurityHeaders = {}

  Object.entries(standardHeaders).forEach(([headerName, headerValue])  => {
    const optionKey = getKeyFromName(headerName)
    if (optionKey) {
      if (typeof headerValue === 'string') {
        // Normally, standard radix headers should be supplied as string
        const objectValue: any = headerObjectFromString(optionKey, headerValue)
        standardHeadersAsObject[optionKey] = objectValue
      } else {
        // Here we ensure backwards compatibility
        // Because in the pre-rc1 syntax, standard headers could also be supplied in object format
        standardHeadersAsObject[optionKey] = headerValue
        //standardHeaders[headerName] = headerStringFromObject(optionKey, headerValue)
      }
    }
  })

  if (Object.keys(standardHeadersAsObject).length === 0) {
    return undefined
  }

  return standardHeadersAsObject
}

/**
 *
 * Ensure backwards compatibility with pre-rc1 syntax, returning undefined if no securityHeaders is passed
 */
function backwardsCompatibleSecurity(securityHeaders?: SecurityHeaders | false) {

  if (!securityHeaders) {
    return undefined
  }

  const securityHeadersAsObject: SecurityHeaders = {}

  Object.entries(securityHeaders).forEach(([key, value]) => {
    const optionKey = key as OptionKey
    if ((optionKey === 'contentSecurityPolicy' || optionKey === 'permissionsPolicy' || optionKey === 'strictTransportSecurity') && (typeof value === 'string')) {
      // Altough this does not make sense in post-rc1 typescript definitions
      // It was possible before rc1 though, so let's ensure backwards compatibility here
      const objectValue: any = headerObjectFromString(optionKey, value)
      securityHeadersAsObject[optionKey] = objectValue
    } else if (value === '') {
      securityHeadersAsObject[optionKey] = false
    } else {
      securityHeadersAsObject[optionKey] = value
    }
  })
  return securityHeadersAsObject
}
