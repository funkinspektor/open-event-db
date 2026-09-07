interface Props {
  lat: number
  lng: number
  title: string
}

export function Map({ lat, lng, title }: Props) {
  const dLng = 0.006
  const dLat = 0.0035
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',')
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
  return (
    <figure className="overflow-hidden rounded-xl border border-neutral-200">
      <iframe
        title={`Map of ${title}`}
        src={src}
        className="h-64 w-full"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <figcaption className="flex justify-between bg-neutral-50 px-3 py-1.5 text-xs text-neutral-500">
        <span>© OpenStreetMap contributors</span>
        <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
          Open in OpenStreetMap ↗
        </a>
      </figcaption>
    </figure>
  )
}
