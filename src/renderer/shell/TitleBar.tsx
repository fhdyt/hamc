import logoUrl from '../assets/logo-mark.png'

/** Drag strip next to the window buttons that the OS draws over the page (titleBarOverlay); it is 0 px high without them. */
export function TitleBar() {
  return (
    <div className="mc-titlebar" aria-hidden="true">
      <img src={logoUrl} alt="" width={16} height={16} />
      <span>Hermes Agent Mission Control</span>
    </div>
  )
}
