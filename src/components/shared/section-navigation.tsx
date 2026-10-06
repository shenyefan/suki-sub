import { useEffect, useState, useRef } from 'react'
import type { RefObject } from 'react'

type Section = { id: string; label: string }

/** A quiet page outline: hover a marker to preview its section, click to jump. */
export function SectionNavigation({
  root,
}: {
  root: RefObject<HTMLDivElement | null>
}) {
  const [sections, setSections] = useState<Section[]>([])
  const rail = useRef<HTMLElement>(null)
  const [preview, setPreview] = useState<(Section & { top: number }) | null>(
    null,
  )
  const [previewVisible, setPreviewVisible] = useState(false)
  const [active, setActive] = useState('editor-basic')
  useEffect(() => {
    const container = root.current
    if (!container) return
    const collect = () => {
      const next = Array.from(
        container.querySelectorAll<HTMLElement>('[data-editor-section]'),
      ).map((section) => ({
        id: section.id,
        label: section.dataset.editorSection!,
      }))
      setSections((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      )
    }
    collect()
    const observer = new MutationObserver(collect)
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'data-editor-section'],
    })
    return () => observer.disconnect()
  }, [root])
  useEffect(() => {
    const scroller = document.getElementById('content')
    const container = root.current
    if (!scroller || !container || !sections.length) return
    let frame = 0
    const update = () => {
      frame = 0
      const maxScroll = scroller.scrollHeight - scroller.clientHeight
      // The last card may never reach the header: the actual page end wins.
      if (maxScroll > 1 && scroller.scrollTop >= maxScroll - 2) {
        setActive(sections[sections.length - 1].id)
        return
      }
      const headerHeight =
        container.querySelector('.editor-topbar')?.getBoundingClientRect()
          .height ?? 0
      const readingTop =
        scroller.getBoundingClientRect().top + headerHeight + 24
      let current = sections[0].id
      for (const section of sections) {
        const target = document.getElementById(section.id)
        if (target && target.getBoundingClientRect().top <= readingTop)
          current = section.id
      }
      setActive(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(scroller)
    observer.observe(container)
    scroller.addEventListener('scroll', schedule, { passive: true })
    update()
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', schedule)
      cancelAnimationFrame(frame)
    }
  }, [root, sections])
  const showPreview = (section: Section, button: HTMLButtonElement) => {
    const bounds = button.getBoundingClientRect()
    const railTop = rail.current?.getBoundingClientRect().top ?? 0
    setPreview({ ...section, top: bounds.top - railTop + bounds.height / 2 })
    setPreviewVisible(true)
  }
  const visible =
    previewVisible && sections.some(({ id }) => id === preview?.id)
  if (!sections.length) return null
  return (
    <nav
      ref={rail}
      aria-label="页面快速导航"
      className="fixed right-1.5 top-1/2 z-30 hidden -translate-y-1/2 opacity-65 transition-opacity duration-200 ease-out hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none md:block"
      onMouseLeave={() => setPreviewVisible(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPreviewVisible(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setPreviewVisible(false)
      }}
    >
      <div className="max-h-[60dvh] overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-label={`跳转到${section.label}`}
            aria-current={active === section.id ? 'location' : undefined}
            aria-describedby={
              visible && preview?.id === section.id
                ? 'section-navigation-preview'
                : undefined
            }
            className="group flex h-4 w-7 items-center justify-end pr-0.5 focus-visible:outline-none"
            onMouseEnter={(event) => showPreview(section, event.currentTarget)}
            onFocus={(event) => showPreview(section, event.currentTarget)}
            onClick={() => {
              const target = document.getElementById(section.id)
              const scroller = document.getElementById('content')
              if (!target || !scroller) return
              const bounds = scroller.getBoundingClientRect()
              const targetBounds = target.getBoundingClientRect()
              const headerHeight =
                root.current
                  ?.querySelector('.editor-topbar')
                  ?.getBoundingClientRect().height ?? 0
              const visibleTop = bounds.top + headerHeight + 16
              const visibleBottom = bounds.top + scroller.clientHeight - 16
              let offset = 0
              if (
                targetBounds.top < visibleTop ||
                targetBounds.height > visibleBottom - visibleTop
              ) {
                offset = targetBounds.top - visibleTop
              } else if (targetBounds.bottom > visibleBottom) {
                offset = targetBounds.bottom - visibleBottom
              }
              // Scroll only the page pane, with no artificial space after the last card.
              const maxScroll = scroller.scrollHeight - scroller.clientHeight
              const destination =
                section.id === sections[sections.length - 1].id && offset > 0
                  ? maxScroll
                  : scroller.scrollTop + offset
              scroller.scrollTo({
                top: Math.max(0, Math.min(maxScroll, destination)),
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                  .matches
                  ? 'instant'
                  : 'smooth',
              })
              target.focus({ preventScroll: true })
              setActive(section.id)
              setPreviewVisible(false)
            }}
          >
            <span
              aria-hidden
              className={`h-[1.5px] w-6 origin-right rounded-full transition-[scale,background-color] duration-200 ease-out group-hover:scale-x-100 group-hover:bg-foreground/75 group-focus-visible:scale-x-100 group-focus-visible:bg-foreground motion-reduce:transition-none ${active === section.id ? 'scale-x-75 bg-foreground/80' : 'scale-x-50 bg-muted-foreground/40'}`}
            />
          </button>
        ))}
      </div>
      <div
        id="section-navigation-preview"
        role="tooltip"
        aria-hidden={!visible}
        style={{ top: preview?.top ?? '50%' }}
        className={`pointer-events-none absolute right-full mr-2 w-max max-w-44 -translate-y-1/2 rounded-md border border-border/60 bg-popover/95 px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm backdrop-blur-sm transition-[opacity,translate,top] duration-150 ease-out motion-reduce:transition-none ${visible ? 'translate-x-0 opacity-100' : 'translate-x-1 opacity-0'}`}
      >
        <p className="truncate">{preview?.label}</p>
      </div>
    </nav>
  )
}
