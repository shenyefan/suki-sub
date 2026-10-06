import { SETTINGS_KEY } from '#/server/core/constants'
import $ from '#/server/core/app'

export const DEFAULT_BACKEND_REQUEST_CONCURRENCY = 10
export const BACKEND_REQUEST_CONCURRENCY_SETTING = 'backendRequestConcurrency'
export const DEFAULT_BACKEND_REQUEST_CONCURRENCY_WAIT_TIME = 0
export const BACKEND_REQUEST_CONCURRENCY_WAIT_TIME_SETTING =
  'backendRequestConcurrencyWaitTime'

let activeRequestCount = 0

const pendingRequestResolvers: any[] = []

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeBackendRequestConcurrency(concurrency: any) {
  if (
    typeof concurrency === 'undefined' ||
    concurrency === null ||
    (typeof concurrency === 'string' && concurrency.trim() === '')
  ) {
    return DEFAULT_BACKEND_REQUEST_CONCURRENCY
  }

  const parsed = Number(concurrency)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_BACKEND_REQUEST_CONCURRENCY
  }

  return parsed
}

export function normalizeBackendRequestConcurrencyWaitTime(waitTime: any) {
  if (
    typeof waitTime === 'undefined' ||
    waitTime === null ||
    (typeof waitTime === 'string' && waitTime.trim() === '')
  ) {
    return DEFAULT_BACKEND_REQUEST_CONCURRENCY_WAIT_TIME
  }

  const parsed = Number(waitTime)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_BACKEND_REQUEST_CONCURRENCY_WAIT_TIME
  }

  return parsed
}

export function getBackendRequestConcurrency() {
  const settings = ($.read(SETTINGS_KEY) || {}) as any
  return normalizeBackendRequestConcurrency(
    settings[BACKEND_REQUEST_CONCURRENCY_SETTING],
  )
}

export function getBackendRequestConcurrencyWaitTime() {
  const settings = ($.read(SETTINGS_KEY) || {}) as any
  return normalizeBackendRequestConcurrencyWaitTime(
    settings[BACKEND_REQUEST_CONCURRENCY_WAIT_TIME_SETTING],
  )
}

function formatRequestConcurrencyState(limit: number, waitTime: number) {
  return `active=${activeRequestCount}, pending=${pendingRequestResolvers.length}, limit=${limit}, waitTime=${waitTime}ms`
}

function logRequestConcurrency(
  message: string,
  label: string,
  limit: number,
  waitTime: number,
) {
  $.debug(
    `[Backend Request Concurrency] ${message}: ${label} (${formatRequestConcurrencyState(
      limit,
      waitTime,
    )})`,
  )
}

function resolveNextPendingRequest() {
  const nextResolver = pendingRequestResolvers.shift()
  if (nextResolver) nextResolver()
}

async function waitForRequestSlot(label: string) {
  let limit = getBackendRequestConcurrency()
  let waitTime = getBackendRequestConcurrencyWaitTime()

  while (activeRequestCount >= limit) {
    logRequestConcurrency('queued', label, limit, waitTime)
    await new Promise((resolve) => {
      pendingRequestResolvers.push(resolve)
    })
    limit = getBackendRequestConcurrency()
    waitTime = getBackendRequestConcurrencyWaitTime()
  }

  activeRequestCount += 1
  logRequestConcurrency('acquired', label, limit, waitTime)

  if (waitTime > 0) {
    logRequestConcurrency('waiting before request', label, limit, waitTime)
    await sleep(waitTime)
  }
}

function releaseRequestSlot(label: string) {
  activeRequestCount = Math.max(0, activeRequestCount - 1)
  logRequestConcurrency(
    'released',
    label,
    getBackendRequestConcurrency(),
    getBackendRequestConcurrencyWaitTime(),
  )
  resolveNextPendingRequest()
}

export async function runBackendRequestTask(
  task: () => Promise<any>,
  label = 'request',
) {
  await waitForRequestSlot(label)

  try {
    return await task()
  } finally {
    releaseRequestSlot(label)
  }
}

export function runBackendRequestTasks(
  tasks: (() => Promise<any>)[],
  label = 'request',
) {
  return Promise.all(tasks.map((task) => runBackendRequestTask(task, label)))
}
