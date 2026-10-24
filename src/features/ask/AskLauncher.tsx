import { useRef, useState, type PointerEvent } from 'react'
import { MessageCircleQuestion } from 'lucide-react'

type Spot = { side: 'left' | 'right'; bottom: number }

const DRAG_START_PX = 6

/**
 * The floating Ask button (PRD 0011 Q10, Q10b). It starts in the bottom
 * corner above the phone bottom bar and any action bar; it can be dragged
 * up or down and to either side, where it snaps to the edge. The spot is
 * not saved: it is back in its corner the next time the app opens.
 */
export function AskLauncher({ onOpen }: { onOpen: () => void }) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const dragged = useRef(false)

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY, moved: false }
    button.current?.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current
    if (!s) return
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_START_PX) return
    s.moved = true
    setDrag({ x: e.clientX, y: e.clientY })
  }
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current
    start.current = null
    if (!s?.moved) return
    dragged.current = true
    const height = button.current?.offsetHeight ?? 56
    const bottom = Math.min(Math.max(window.innerHeight - e.clientY - height / 2, 16), window.innerHeight - height - 72)
    setSpot({ side: e.clientX < window.innerWidth / 2 ? 'left' : 'right', bottom })
    setDrag(null)
  }

  const floor = 'calc(var(--nav-h) + var(--action-h, 0px) + 1rem)'
  const style = drag
    ? { left: drag.x, top: drag.y, transform: 'translate(-50%, -50%)', transition: 'none' }
    : spot
      ? { [spot.side]: '1rem', bottom: `max(${floor}, ${spot.bottom}px)` }
      : undefined

  return (
    <button
      ref={button}
      type="button"
      onClick={() => {
        // A drag that ends on the button is not a click.
        if (dragged.current) {
          dragged.current = false
          return
        }
        onOpen()
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null
        setDrag(null)
      }}
      aria-label="Ask the assistant"
      title="Ask the assistant (drag to move)"
      style={style}
      className={`fixed z-40 inline-flex h-13 touch-none select-none items-center gap-2 rounded-full bg-brand pl-4 pr-5 text-sm font-semibold text-on-brand shadow-pop hover:bg-brand-strong ${
        spot || drag ? '' : 'bottom-[calc(var(--nav-h)+var(--action-h,0px)+1rem)] right-4 md:right-6 md:bottom-[calc(var(--action-h,0px)+1.5rem)]'
      } ${drag ? 'cursor-grabbing opacity-90' : 'cursor-grab'}`}
    >
      <MessageCircleQuestion className="size-5" aria-hidden="true" />
      Ask
    </button>
  )
}
