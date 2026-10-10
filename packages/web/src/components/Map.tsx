import { ExtIcon } from './Icons'

interface Props {
  lat: number
  lng: number
  title: string
  /** 260 in event asides, 320 on venue pages, 240 in the venue form. */
  height?: number
}

// OpenStreetMap embed, darkened, centred on the venue with our own UV pin on top.
export function Map({ lat, lng, title, height = 260 }: Props) {
  const dLng = 0.006
  const dLat = 0.0035
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',')
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
  return (
    <figure className="m-0">
      <div className="kk-map" style={{ height }}>
        <iframe title={`Map of ${title}`} src={src} loading="lazy" tabIndex={-1} referrerPolicy="no-referrer-when-downgrade" />
        <span className="kk-map__pin" aria-hidden />
      </div>
      <figcaption className="kk-map__credit">
        <span>© OpenStreetMap contributors</span>
        <a href={href} target="_blank" rel="noreferrer">
          Open in OpenStreetMap
          <ExtIcon />
        </a>
      </figcaption>
    </figure>
  )
}
