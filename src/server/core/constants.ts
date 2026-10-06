/**
 * 引擎层存储键与缓存 TTL 常量。
 */
export const SCHEMA_VERSION_KEY = 'schemaVersion'
export const SETTINGS_KEY = 'settings'
export const SUBS_KEY = 'subs'
export const COLLECTIONS_KEY = 'collections'
export const MODULES_KEY = 'modules'
export const RULES_KEY = 'rules'

export const RESOURCE_CACHE_KEY = '#suki-sub-cached-resource'
export const HEADERS_RESOURCE_CACHE_KEY = '#suki-sub-cached-headers-resource'
export const SCRIPT_RESOURCE_CACHE_KEY = '#suki-sub-cached-script-resource'
export const LOGS_KEY = '#suki-sub-logs'

export const DEFAULT_CACHE_TTL = 60 * 60 * 1000 // 1 hour
export const DEFAULT_HEADERS_CACHE_TTL = 60 * 1000 // 1 min
export const DEFAULT_SCRIPT_CACHE_TTL = 48 * 3600 * 1000 // 48 hours
export const DEFAULT_LOGS_MAX_COUNT = 0
