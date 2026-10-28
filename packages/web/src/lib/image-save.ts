/** How the image part of an event save went. `unavailable`: the server has no image storage, retrying won't help. */
export type ImageSaveOutcome = 'saved' | 'failed' | 'unavailable'

export function imageSaveOutcome(status: number, code: string | undefined): ImageSaveOutcome {
  if (status >= 200 && status < 300) return 'saved'
  return status === 503 && code === 'images_unavailable' ? 'unavailable' : 'failed'
}

/** The `?saved=` value the event page turns into its message after a save. */
export function savedParam(mode: 'create' | 'edit', outcome: ImageSaveOutcome): string {
  const saved = mode === 'create' ? 'created' : 'updated'
  return outcome === 'saved' ? saved : `${saved}_image_${outcome}`
}
