import { SETTINGS_KEY } from '#/server/core/constants'
import $ from '#/server/core/app'

export function getCreateItemPosition() {
  const createItemPosition = (($.read(SETTINGS_KEY) || {}) as any)
    ?.appearanceSetting?.createItemPosition

  return createItemPosition === 'top' ? 'top' : 'bottom'
}
