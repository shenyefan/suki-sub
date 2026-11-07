import { useEffect, useRef, useState } from 'react'

/** 只同步未编辑的草稿，避免其他设置保存或后台刷新覆盖当前输入。 */
export function useSettingDraft(value: string) {
  const [draft, setDraft] = useState(value)
  const previous = useRef(value)
  useEffect(() => {
    const baseline = previous.current
    setDraft((current) => (current === baseline ? value : current))
    previous.current = value
  }, [value])
  return [draft, setDraft] as const
}
