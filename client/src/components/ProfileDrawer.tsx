import { type ReactNode, useEffect, useId, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
}

/** Side drawer on a native modal <dialog>, which provides the focus trap, Esc and an inert page behind it. */
export function ProfileDrawer({ open, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current!
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby={titleId}
      onClose={onClose}
      // .drawer-body fills the dialog, so a click landing on the dialog itself came from the backdrop.
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="drawer-body">
          <div className="drawer-head">
            <h2 id={titleId}>Edit profile</h2>
            <button type="button" className="drawer-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
