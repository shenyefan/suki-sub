import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'

/** 主题跟随 html 的 light/dark class */
function SonnerToaster({ ...props }: ToasterProps) {
  const getTheme = () =>
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'

  return (
    <Sonner
      data-slot="toaster"
      theme={getTheme()}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { SonnerToaster as Toaster }
