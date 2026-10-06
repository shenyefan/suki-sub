/**
 * 脚本操作符执行入口:返回 fn(proxies, targetPlatform, context) → Promise。
 */
import { execUserScript } from '../sandbox/loader'
import { getEngineStore } from '../../store/engine-store'

export type DynamicFunction = (
  proxies: any,
  targetPlatform: any,
  context: any,
) => Promise<any>

export async function createDynamicFunction(
  fnName: string,
  script: string,
  $arguments?: Record<string, unknown>,
  $options?: unknown,
): Promise<DynamicFunction> {
  // 惰性绑定 loader:工厂创建时不强制要求绑定存在,真正执行时才报错
  return async (proxies, targetPlatform, context) => {
    const store = getEngineStore()
    return execUserScript(store.scriptLoader, script, fnName, {
      proxies,
      targetPlatform,
      context,
      $arguments,
      $options,
      settings: store.settings,
    })
  }
}
