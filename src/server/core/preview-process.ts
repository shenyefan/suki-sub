import {
  assertResourceValid,
  contextualResourceError,
} from './validate-resource'
import { ProxyUtils } from './proxy-utils/index'
import { getEngineStore, runWithEngineStore } from '../store/engine-store'
import { produceArtifact } from './produce-artifact'
import type { Collection, Subscription } from '#/shared/types'

/** Preview unsaved drafts in isolated snapshots; no resource is written back. */
export async function previewProcess(
  kind: 'sub' | 'collection',
  draft: Subscription | Collection,
  saving = false,
) {
  assertResourceValid(kind, draft)
  const store = getEngineStore()
  const name = draft.name || '__preview__'
  const produce = async (process: unknown) => {
    const item = {
      ...structuredClone(draft),
      name,
      process,
      ignoreFailedRemoteSub: false,
    }
    const snapshot = {
      ...store,
      subs: structuredClone(store.subs).map((sub) => ({
        ...sub,
        ignoreFailedRemoteSub: false,
      })),
      collections: structuredClone(store.collections),
      modules: structuredClone(store.modules),
      settings: structuredClone(store.settings),
    }
    if (kind === 'collection') {
      snapshot.collections = [
        ...snapshot.collections.filter((entry) => entry.name !== name),
        item as Collection,
      ]
    }
    try {
      return await runWithEngineStore(snapshot, () =>
        produceArtifact({
          type: kind === 'sub' ? 'subscription' : kind,
          ...(kind === 'sub' ? { subscription: item } : { name }),
          platform: 'JSON',
          produceType: 'internal',
          noFlow: true,
          validation: true,
          noCache: saving,
        }),
      )
    } catch (error) {
      throw contextualResourceError(error, kind, draft)
    }
  }
  const before = saving ? undefined : await produce([])
  // Use the same pipeline as downloads: only the existing disabled flag controls execution.
  const after = await produce(draft.process ?? [])
  await runWithEngineStore(
    {
      ...store,
      subs: structuredClone(store.subs),
      collections: structuredClone(store.collections),
      modules: structuredClone(store.modules),
      settings: structuredClone(store.settings),
    },
    () =>
      ProxyUtils.processResponse(
        { status: 200, headers: {}, body: JSON.stringify(after) },
        draft.process ?? [],
        'JSON',
        { [name]: draft },
        {},
        { noFlow: true, validation: true },
      ),
  )
  return { before, after }
}

/** 保存前的完整校验:静态检查 + 以保存模式跑一遍预览管线。 */
export async function validateForSave(
  kind: 'sub' | 'collection',
  draft: Subscription | Collection,
) {
  assertResourceValid(kind, draft)
  try {
    await previewProcess(kind, draft, true)
  } catch (error) {
    // 保存使用同一条错误链，保留上游原因、状态与字段定位。
    throw contextualResourceError(error, kind, draft)
  }
}
