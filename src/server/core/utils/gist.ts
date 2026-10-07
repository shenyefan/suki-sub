/**
 * GitHub Gist / GitLab Snippet 同步(fetch 实现)。
 */
import $ from '#/server/core/app'
import { SETTINGS_KEY } from '#/server/core/constants'

const DEFAULT_GITHUB_API_URL = 'https://api.github.com'

interface GistOptions {
  token: string
  key: string
  syncPlatform?: 'gist' | 'gitlab'
}

type GistFiles = Record<string, { content: string | null }>

function validateGistFiles(input: unknown): void {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.values(input).some((file: unknown) => {
      if (!file || typeof file !== 'object') return true
      const content = (file as Record<string, unknown>).content
      return content !== null && typeof content !== 'string'
    })
  )
    throw new Error('备份文件必须是以文件名为键、包含 content 的对象集合')
}

function HTTP(defaultOptions: any = { baseURL: '' }) {
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']
  const URL_REGEX =
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/

  async function send(method: string, options: any) {
    options = typeof options === 'string' ? { url: options } : options
    const baseURL = defaultOptions.baseURL
    if (baseURL && !URL_REGEX.test(options.url || '')) {
      options.url = baseURL ? baseURL + options.url : options.url
    }
    options = { ...defaultOptions, ...options }
    const timeout = options.timeout
    const events = {
      ...{
        onRequest: () => {},
        onResponse: (resp: any) => resp,
        onTimeout: () => {},
      },
      ...options.events,
    }

    events.onRequest(method, options)

    let res: Response
    try {
      res = await fetch(options.url, {
        method,
        headers: options.headers,
        ...(options.body != null && !['GET', 'HEAD'].includes(method)
          ? { body: options.body }
          : {}),
        signal: AbortSignal.timeout(Number(timeout) || 8000),
      })
    } catch (e) {
      if ((e as any)?.name === 'TimeoutError') {
        events.onTimeout(e as any)
      }
      throw e
    }
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    const resp = {
      statusCode: res.status,
      headers,
      body: await res.text(),
    }
    return events.onResponse(resp)
  }

  const http: any = {}
  for (const method of methods) {
    http[method.toLowerCase()] = (options: any) => send(method, options)
  }
  return http
}

function describeGistApiErrorResponse(resp: any) {
  let body
  try {
    body = JSON.parse(resp.body)
  } catch (e) {
    //
  }
  const message =
    body?.message?.error ??
    body?.error ??
    body?.message ??
    resp.body ??
    'Unknown error'
  return `ERROR: HTTP ${resp.statusCode}: ${message}`
}

function normalizeApiUrl(url: any, fallback = DEFAULT_GITHUB_API_URL) {
  const normalizedUrl = String(url ?? '').trim() || fallback

  return normalizedUrl.replace(/\/+$/, '')
}

export function getGithubGistBaseURL({ githubApiUrl, githubProxy }: any = {}) {
  const normalizedGithubApiUrl = normalizeApiUrl(githubApiUrl)
  const isCustomGithubApiUrl = normalizedGithubApiUrl !== DEFAULT_GITHUB_API_URL
  const normalizedGithubProxy = String(githubProxy || '')
    .trim()
    .replace(/\/+$/, '')

  if (isCustomGithubApiUrl) {
    return normalizedGithubApiUrl
  }

  return `${
    normalizedGithubProxy ? `${normalizedGithubProxy}/` : ''
  }${DEFAULT_GITHUB_API_URL}`
}

export function hasGistSyncCredentials(settings: any = {}) {
  return Boolean(settings?.gistToken)
}

export { describeGistApiErrorResponse }

/**
 * Gist backup
 */
export default class Gist {
  headers: any
  http: any
  key: any
  syncPlatform: any
  _requestQueue: Promise<any>

  constructor({ token, key, syncPlatform }: GistOptions) {
    const { githubApiTimeout, githubProxy, githubApiUrl } = ($.read(
      SETTINGS_KEY,
    ) || {}) as any
    const githubApiRequestTimeout = githubApiTimeout || 10000
    const githubGistBaseURL = getGithubGistBaseURL({
      githubApiUrl,
      githubProxy,
    })

    if (syncPlatform === 'gitlab') {
      this.headers = {
        'PRIVATE-TOKEN': `${token}`,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.141 Safari/537.36',
      }
      this.http = HTTP({
        baseURL: 'https://gitlab.com/api/v4',
        headers: {
          ...this.headers,
        },

        timeout: githubApiRequestTimeout,

        events: {
          onResponse: (resp: any) => {
            if (/^[45]/.test(String(resp.statusCode))) {
              return Promise.reject(describeGistApiErrorResponse(resp))
            } else {
              return resp
            }
          },
        },
      })
    } else {
      this.headers = {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.141 Safari/537.36',
      }
      this.http = HTTP({
        baseURL: githubGistBaseURL,
        headers: {
          ...this.headers,
        },

        timeout: githubApiRequestTimeout,

        events: {
          onResponse: (resp: any) => {
            if (/^[45]/.test(String(resp.statusCode))) {
              return Promise.reject(describeGistApiErrorResponse(resp))
            } else {
              return resp
            }
          },
        },
      })
    }

    this.key = key
    this.syncPlatform = syncPlatform

    // 串行请求队列锁 防止响应串扰
    this._requestQueue = Promise.resolve()
    const queuedMethods = ['get', 'post', 'put', 'patch', 'delete']
    for (const method of queuedMethods) {
      const original = this.http[method]
      if (typeof original === 'function') {
        this.http[method] = (...args: any[]) => {
          return new Promise((resolve, reject) => {
            this._requestQueue = this._requestQueue.then(() =>
              original.apply(this.http, args).then(resolve, reject),
            )
          })
        }
      }
    }
  }

  async locate() {
    if (this.syncPlatform === 'gitlab') {
      return this.http.get('/snippets').then((response: any) => {
        const gists = JSON.parse(response.body)

        for (const g of gists) {
          if (g.title === this.key) {
            return g
          }
        }
        return
      })
    } else {
      return this.http
        .get('/gists?per_page=100&page=1')
        .then((response: any) => {
          const gists = JSON.parse(response.body)
          $.info(`获取到当前 GitHub 用户的 gist: ${gists.length} 个`)
          for (const g of gists) {
            if (g.description === this.key) {
              return g
            }
          }
          return
        })
    }
  }

  async upload(input: GistFiles, options = {} as any) {
    validateGistFiles(input)
    if (Object.keys(input).length === 0) {
      return Promise.reject('未提供需上传的文件')
    }

    const gist = await this.locate()

    let files: any = input
    const emptyFileFallback = options.emptyFileFallback
    const hasEmptyFileFallback = Boolean(emptyFileFallback?.filename)
    const uploadMeta: any = {}

    const attachUploadMeta = async (request: any) => {
      const response = await request
      if (Object.keys(uploadMeta).length > 0) {
        response.sukiSubUploadMeta = uploadMeta
      }
      return response
    }

    const applyEmptyFileFallback = ({
      actions,
      existingFiles,
      result,
    }: any) => {
      if (!hasEmptyFileFallback) return

      const filename = emptyFileFallback.filename
      const content = emptyFileFallback.content ?? ''
      const realFileKeys = Object.keys(result).filter((key) => key !== filename)

      if (Object.keys(result).length === 0) {
        result[filename] = { content }
        uploadMeta.emptyFileFallback = {
          status: 'created',
          filename,
        }

        if (this.syncPlatform === 'gitlab') {
          actions.push({
            action: existingFiles[filename] ? 'update' : 'create',
            file_path: filename,
            content,
          })
        } else {
          files[filename] = { content }
        }
      } else if (result[filename] && realFileKeys.length > 0) {
        delete result[filename]
        uploadMeta.emptyFileFallback = {
          status: 'removed',
          filename,
        }

        if (this.syncPlatform === 'gitlab') {
          actions.push({
            action: 'delete',
            file_path: filename,
          })
        } else {
          files[filename] = null
        }
      } else if (result[filename] && realFileKeys.length === 0) {
        uploadMeta.emptyFileFallback = {
          status: 'retained',
          filename,
        }
      }
    }

    if (gist?.id) {
      if (this.syncPlatform === 'gitlab') {
        gist.files = gist.files.reduce((acc: any, item: any) => {
          acc[item.path] = item
          return acc
        }, {})
      }
      // console.log(`files`, files);
      // console.log(`gist`, gist.files);
      const actions: any[] = []
      const result = { ...gist.files }
      Object.keys(files).map((key) => {
        if (result[key]) {
          if (files[key].content == null || files[key].content === '') {
            delete result[key]
            files[key] = null
            actions.push({
              action: 'delete',
              file_path: key,
            })
          } else {
            result[key] = files[key]
            actions.push({
              action: 'update',
              file_path: key,
              content: files[key].content,
            })
          }
        } else {
          if (files[key].content == null || files[key].content === '') {
            delete result[key]
            delete files[key]
          } else {
            result[key] = files[key]
            actions.push({
              action: 'create',
              file_path: key,
              content: files[key].content,
            })
          }
        }
      })
      // console.log(`result`, result);
      // console.log(`files`, files);
      // console.log(`actions`, actions);

      applyEmptyFileFallback({
        actions,
        existingFiles: gist.files,
        result,
      })

      if (this.syncPlatform === 'gitlab') {
        if (Object.keys(result).length === 0) {
          return Promise.reject(
            '本次操作将导致所有文件的内容都为空, 无法更新 snippet',
          )
        }
        if (Object.keys(result).length > 10) {
          return Promise.reject(
            '本次操作将导致 snippet 的文件数超过 10, 无法更新 snippet',
          )
        }
        files = actions
        return attachUploadMeta(
          this.http.put({
            headers: {
              ...this.headers,
              'Content-Type': 'application/json',
            },
            url: `/snippets/${gist.id}`,
            body: JSON.stringify({ files }),
          }),
        )
      } else {
        if (Object.keys(result).length === 0) {
          return Promise.reject(
            '本次操作将导致所有文件的内容都为空, 无法更新 gist',
          )
        }
        return attachUploadMeta(
          this.http.patch({
            url: `/gists/${gist.id}`,
            headers: {
              ...this.headers,
              'Accept-Encoding': 'gzip, deflate, br',
            },
            body: JSON.stringify({ files }),
          }),
        )
      }
    } else {
      files = Object.entries(files).reduce((acc: any, [key, file]: any) => {
        if (file.content !== null && file.content !== '') {
          acc[key] = file
        }
        return acc
      }, {})
      if (this.syncPlatform === 'gitlab') {
        if (Object.keys(files).length === 0) {
          return Promise.reject('所有文件的内容都为空, 无法创建 snippet')
        }
        files = Object.keys(files).map((key) => ({
          file_path: key,
          content: files[key].content,
        }))
        return attachUploadMeta(
          this.http.post({
            headers: {
              ...this.headers,
              'Content-Type': 'application/json',
            },
            url: '/snippets',
            body: JSON.stringify({
              title: this.key,
              visibility: 'private',
              files,
            }),
          }),
        )
      } else {
        if (Object.keys(files).length === 0) {
          return Promise.reject('所有文件的内容都为空, 无法创建 gist')
        }
        return attachUploadMeta(
          this.http.post({
            url: '/gists',
            body: JSON.stringify({
              description: this.key,
              public: false,
              files,
            }),
          }),
        )
      }
    }
  }

  async download(filename: string) {
    const gist = await this.locate()
    if (gist?.id) {
      try {
        const { files } = await this.http
          .get(`/gists/${gist.id}`)
          .then((resp: any) => JSON.parse(resp.body))
        const url = files[filename].raw_url
        return await this.http.get(url).then((resp: any) => resp.body)
      } catch (err) {
        return Promise.reject(err)
      }
    } else {
      return Promise.reject(`找不到 Suki Sub Gist (${this.key})`)
    }
  }
}
