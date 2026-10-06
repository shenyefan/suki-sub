import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '#/components/ui/button'

type ThemeMode = 'light' | 'dark' | 'auto'

const THEME_KEY = 'theme'

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function apply(mode: ThemeMode) {
  const resolved = resolve(mode)
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  if (mode === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
  root.style.colorScheme = resolved
}

function readMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'auto'
    ? stored
    : 'auto'
}

export function applyTheme(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode)
  apply(mode)
  window.dispatchEvent(new Event('theme-change'))
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>('auto')
  useEffect(() => {
    const sync = () => {
      const next = readMode()
      setMode(next)
      apply(next)
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    sync()
    window.addEventListener('theme-change', sync)
    window.addEventListener('storage', sync)
    media.addEventListener('change', sync)
    return () => {
      window.removeEventListener('theme-change', sync)
      window.removeEventListener('storage', sync)
      media.removeEventListener('change', sync)
    }
  }, [])
  return [mode, applyTheme] as const
}

/** 主题切换:浅色 / 深色 / 跟随系统(与 __root 的防闪烁脚本共用 localStorage 键) */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, update] = useThemeMode()

  const cycle = () => {
    const order: ThemeMode[] = ['light', 'dark', 'auto']
    update(order[(order.indexOf(mode) + 1) % order.length])
  }

  const label =
    mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={cycle}
      aria-label={`主题:${label},点击切换`}
      title={`主题:${label}`}
      className={className}
    >
      {mode === 'light' ? <Sun /> : mode === 'dark' ? <Moon /> : <Monitor />}
    </Button>
  )
}

/** 供设置页直接选择模式 */
export { readMode, THEME_KEY }
