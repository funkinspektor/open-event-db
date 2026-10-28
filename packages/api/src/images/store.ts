import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AwsClient } from 'aws4fetch'
import { isTestRun } from '../extract/vision.js'
import type { ImageType } from './sniff.js'

export type { ImageType } from './sniff.js'

/** Where event images live. Keys look like `events/<event id>/<uuid>.jpg`. */
export interface ImageStore {
  put(key: string, data: Buffer, type: ImageType): Promise<void>
  delete(key: string): Promise<void>
  /** The public URL of a stored key. */
  url(key: string): string
}

/** A store whose files the API serves itself at `GET /images/*` (development only). */
export interface LocalImageStore extends ImageStore {
  read(key: string): Promise<{ data: Buffer; type: ImageType } | null>
}

const EXTENSIONS: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const TYPES: Record<string, ImageType> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

/** Keys never repeat, so objects can be cached forever. */
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export const imageKey = (eventId: string, type: ImageType) => `events/${eventId}/${randomUUID()}.${EXTENSIONS[type]}`

const joinUrl = (base: string, key: string) => `${base.replace(/\/+$/, '')}/${key}`

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Public URL the bucket's objects are reachable at, e.g. `https://<bucket>.s3.fr-par.scw.cloud`. */
  baseUrl: string
}

/** S3-compatible object storage (Scaleway), path-style, objects public-read. */
export function s3ImageStore(cfg: S3Config, fetchImpl: typeof fetch = fetch): ImageStore {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: cfg.region,
  })
  const objectUrl = (key: string) => joinUrl(`${cfg.endpoint.replace(/\/+$/, '')}/${cfg.bucket}`, key)

  async function send(key: string, init: RequestInit) {
    const res = await fetchImpl(await client.sign(objectUrl(key), init))
    if (!res.ok) throw new Error(`Object storage answered HTTP ${res.status} for ${init.method} ${key}`)
  }

  return {
    put: (key, data, type) =>
      send(key, {
        method: 'PUT',
        body: data,
        headers: { 'content-type': type, 'cache-control': IMAGE_CACHE_CONTROL, 'x-amz-acl': 'public-read' },
      }),
    delete: (key) => send(key, { method: 'DELETE' }),
    url: (key) => joinUrl(cfg.baseUrl, key),
  }
}

/** Files under `dir`, for development without a bucket. */
export function localImageStore(dir: string, baseUrl: string): LocalImageStore {
  const root = resolve(dir)
  // A key that resolves outside the folder (`../`) is not one of ours.
  const pathOf = (key: string) => {
    const path = resolve(root, key)
    return path.startsWith(root + sep) ? path : null
  }

  return {
    async put(key, data) {
      const path = pathOf(key)
      if (!path) throw new Error(`Invalid image key ${key}`)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },
    async delete(key) {
      const path = pathOf(key)
      if (path) await rm(path, { force: true })
    },
    url: (key) => joinUrl(baseUrl, key),
    async read(key) {
      const path = pathOf(key)
      const type = TYPES[extname(key)]
      if (!path || !type) return null
      try {
        return { data: await readFile(path), type }
      } catch {
        return null
      }
    },
  }
}

export const isLocalStore = (store: ImageStore | null): store is LocalImageStore => !!store && 'read' in store

function storeFromEnv(): ImageStore | null {
  // Automated tests install their own store via imageStore.setStore().
  if (isTestRun) return null
  const env = process.env
  if (env.S3_BUCKET) {
    const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, IMAGE_BASE_URL } = env
    if (!S3_ENDPOINT || !S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !IMAGE_BASE_URL) {
      console.error('S3_BUCKET is set, but S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY or IMAGE_BASE_URL is missing; event images are off')
      return null
    }
    return s3ImageStore({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      baseUrl: IMAGE_BASE_URL,
    })
  }
  // Production without a bucket: no images rather than files on a container disk that a redeploy wipes.
  if (env.NODE_ENV === 'production') return null
  const dir = env.IMAGE_DIR || fileURLToPath(new URL('../../../../.data/images', import.meta.url))
  const port = env.API_PORT ?? env.PORT ?? '3001'
  return localImageStore(dir, env.IMAGE_BASE_URL || `http://localhost:${port}/images`)
}

const defaultStore = storeFromEnv()
let store: ImageStore | null = defaultStore

/** The configured store, or null when images are off. Tests swap it with `setStore`. */
export const imageStore = {
  get store(): ImageStore | null {
    return store
  },
  setStore(s: ImageStore | null) {
    store = s
  },
  reset() {
    store = defaultStore
  },
}

/** In-memory store for tests. */
export function memoryImageStore(base = 'https://images.test'): ImageStore & {
  objects: Map<string, { data: Buffer; type: ImageType }>
} {
  const objects = new Map<string, { data: Buffer; type: ImageType }>()
  return {
    objects,
    async put(key, data, type) {
      objects.set(key, { data, type })
    },
    async delete(key) {
      objects.delete(key)
    },
    url: (key) => joinUrl(base, key),
  }
}
