import { defineNuxtModule, addServerHandler, installModule, addVitePlugin, addServerPlugin, createResolver, addImportsDir, addServerImportsDir, useNitro } from '@nuxt/kit'
import { defu } from 'defu'
import type { Nuxt } from '@nuxt/schema'
import viteRemove from 'unplugin-remove/vite'
import { defuReplaceArray } from './utils'
import type { ModuleOptions, NuxtSecurityRouteRules } from './types/index'
import type { BasicAuth } from './types/middlewares'
import { defaultSecurityConfig } from './defaultConfig'
import type { CheerioAPI } from 'cheerio'
import { hashBundledAssets } from './utils'

declare module 'nuxt/schema' {
  interface NuxtOptions {
    security: ModuleOptions
  }
  interface RuntimeConfig {
    security: ModuleOptions,
    private: { basicAuth: BasicAuth | false, [key: string]: any }
  }
}

declare module 'nitropack' {
  interface NitroRouteConfig {
    security?: NuxtSecurityRouteRules;
  }
  interface NitroRuntimeHooks {
    /**
     * @deprecated
     */
    'nuxt-security:headers': (config: {
      /**
       * The route for which the headers are being configured
       */
      route: string,
      /**
       * The headers configuration for the route
       */
      headers: NuxtSecurityRouteRules['headers']
    }) => void
    /**
     * @deprecated
     */
    'nuxt-security:ready': () => void
    /**
     * Runtime hook to configure security rules for each route 
     */
    'nuxt-security:routeRules': (routeRules: Record<string, NuxtSecurityRouteRules>) => void
  }
}

type Section = 'body' | 'bodyAppend' | 'bodyPrepend' | 'head'
declare module 'h3' {
  interface H3EventContext {
    security?: {
      route?: string;
      rules?: NuxtSecurityRouteRules;
      nonce?: string;
      hashes?: {
        script: Set<string>;
        style: Set<string>;
      };
      cheerios?: Record<Section, CheerioAPI[]>;
    }
  }
}

export * from './types/index'
export * from './types/headers'
export * from './types/middlewares'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-security',
    configKey: 'security'
  },
  async setup (options, nuxt) {
    const resolver = createResolver(import.meta.url)
    
    nuxt.options.build.transpile.push(resolver.resolve('./runtime'))

    // First merge module options with default options
    nuxt.options.security = defuReplaceArray(
      { ...options, ...nuxt.options.security },
      {
        ...defaultSecurityConfig(nuxt.options.devServer.url)
      }
    )

    // Then transfer basicAuth to private runtimeConfig
    nuxt.options.runtimeConfig.private = defu(
      nuxt.options.runtimeConfig.private,
      {
        basicAuth: nuxt.options.security.basicAuth
      }
    )
    delete (nuxt.options.security as any).basicAuth

    // Lastly, merge runtimeConfig with module options
    nuxt.options.runtimeConfig.security = defu(
      nuxt.options.runtimeConfig.security,
      {
        ...nuxt.options.security
      }
    )

    // At this point we have all security options merged into runtimeConfig
    const securityOptions = nuxt.options.runtimeConfig.security

    // Disable module when `enabled` is set to `false`
    if (!securityOptions.enabled) { return }

    // Register Vite transform plugin to remove loggers
    if (securityOptions.removeLoggers) {
      addVitePlugin(viteRemove(securityOptions.removeLoggers))
    }
    
    // Register nitro plugin to manage security rules at the level of each route
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/00-routeRules'))

    // Pre-process HTML into DOM tree
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/10-preprocessHtml'))

    // Register nitro plugin to enable Subresource Integrity
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/20-subresourceIntegrity'))

    // Register nitro plugin to enable CSP Hashes for SSG
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/30-cspSsgHashes'))

    // Nitro plugin to enable CSP Nonce for SSR
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/40-cspSsrNonce'))

    // Register nitro plugin to update CSP with actual nonce or hashes
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/50-updateCsp'))

    // Recombine HTML from DOM tree
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/60-recombineHtml'))

    // Register nitro plugin to insert Security Headers in response
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/70-securityHeaders'))

    // Register nitro plugin to hide X-Powered-By header
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/80-hidePoweredBy'))

    // Register nitro plugin to save and retrieve prerendered headers in SSG mode
    addServerPlugin(resolver.resolve('./runtime/nitro/plugins/90-prerenderedHeaders'))

    // Register hook that will reorder nitro plugins to be applied last
    reorderNitroPlugins(nuxt)

    // Register request size limiter middleware
    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/requestSizeLimiter')
    })

    // Register CORS middleware
    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/corsHandler')
    })

    // Register allowed methods restricter middleware
    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/allowedMethodsRestricter')
    })

    // Register rate limiter middleware
    registerRateLimiterStorage(nuxt, securityOptions)
    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/rateLimiter')
    })
    
    // Register XSS validator middleware
    addServerHandler({
      handler: resolver.resolve('./runtime/server/middleware/xssValidator')
    })
    
    // Register basicAuth middleware that is disabled by default
    const basicAuthConfig = nuxt.options.runtimeConfig.private.basicAuth
    if (basicAuthConfig && (basicAuthConfig.enabled || (basicAuthConfig as any)?.value?.enabled)) {
      addServerHandler({
        route: (basicAuthConfig as any).route || '',
        handler: resolver.resolve('./runtime/server/middleware/basicAuth')
      })
    }

    // Import CSURF module
    if (securityOptions.csrf) {
      if (Object.keys(securityOptions.csrf).length) {
        await installModule('nuxt-csurf', securityOptions.csrf)
      } else {
        await installModule('nuxt-csurf')
      }
    }

    // Import server utils
    addServerImportsDir(resolver.resolve('./runtime/server/utils'))

    // Import composables
    addImportsDir(resolver.resolve('./runtime/composables'))

    // Calculates SRI hashes at build time
    nuxt.hook('nitro:build:before', hashBundledAssets)

    // When the prerendering is done, we need to add the prerendered headers to the server assets
    nuxt.hook('nitro:init', nitro => {  
      nitro.hooks.hook('prerender:done', async() => {
        nitro.options.serverAssets.push({ 
          baseName: 'nuxt-security', 
          dir: createResolver(nuxt.options.buildDir).resolve('./nuxt-security') 
        })

        // In some Nitro presets (e.g. Vercel), the header rules are generated for the static server
        // By default we update the nitro headers route rules with their calculated value to support this possibility
        const prerenderedHeaders = await nitro.storage.getItem<any>('build:nuxt-security:headers.json')
        const n = useNitro()
        n.options.routeRules = defuReplaceArray(
          prerenderedHeaders,
          n.options.routeRules
        )
      })
    })
  }
})

/**
 * 
 * Register storage driver for the rate limiter
 */
function registerRateLimiterStorage(nuxt: Nuxt, securityOptions: ModuleOptions) {
  nuxt.hook('nitro:config', (config) => {
    const driver = defu(
      securityOptions.rateLimiter ? securityOptions.rateLimiter.driver : undefined,
      { name: 'lruCache' }
    )
    const { name, options } = driver
    config.storage = defu(
      {
        '#rate-limiter-storage': {
          driver: name,
          options
        }
      },
      config.storage
    )
  })
}

/**
 * Make sure our nitro plugins will be applied last,
 * After all other third-party modules that might have loaded their own nitro plugins
 */
function reorderNitroPlugins(nuxt: Nuxt) {  
  nuxt.hook('nitro:init', nitro => {    
    const resolver = createResolver(import.meta.url)
    const securityPluginsPrefix = resolver.resolve('./runtime/nitro/plugins')

    // SSR: Reorder plugins in Nitro options
    nitro.options.plugins.sort((a, b) => {
      if (a.startsWith(securityPluginsPrefix)) {
        if (b.startsWith(securityPluginsPrefix)) {
          return 0
        } else {
          return 1
        }
      } else {
        if (b.startsWith(securityPluginsPrefix)) {
          return -1
        } else {
          return 0
        }
      }
    })
    // SSG: Reorder plugins in Nitro hook
    nitro.hooks.hook('prerender:config', config => {
      config.plugins?.sort((a, b) => {
        if (a?.startsWith(securityPluginsPrefix)) {
          if (b?.startsWith(securityPluginsPrefix)) {
            return 0
          } else {
            return 1
          }
        } else {
          if (b?.startsWith(securityPluginsPrefix)) {
            return -1
          } else {
            return 0
          }
        }
      })
    })
  })
}
