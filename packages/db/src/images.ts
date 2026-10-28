/**
 * What the operator still has to do after hard-deleting an event that had an image: the CLI cannot reach
 * the image bucket (its credentials live on the API container), and the object is public-read.
 */
export function imageRemovalNotice(imageKey: string | null): string | null {
  if (!imageKey) return null
  const folder = imageKey.slice(0, imageKey.lastIndexOf('/') + 1)
  return [
    `The event's image is still public in the image bucket: ${imageKey}`,
    `Delete the folder ${folder} in the Scaleway console (Object Storage → the event images bucket),`,
    'otherwise the image stays reachable at its URL.',
  ].join('\n')
}
