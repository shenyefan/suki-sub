import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { EditorView, EditorState } from '@uiw/react-codemirror'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import type { CodeTextareaProps } from './code-textarea'
import { cn } from '#/lib/utils'

const translations = {
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  'by word': '全词匹配',
  regexp: '正则表达式',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'Go to line': '跳转到行',
  go: '跳转',
  'Fold line': '折叠行',
  'Unfold line': '展开行',
  'folded code': '已折叠代码',
  'No diagnostics': '没有诊断信息',
  'Control character': '控制字符',
}

/** 语法自动识别用于本地订阅和输出；脚本、操作 JSON 使用显式语言。 */
export default function CodeEditor({
  value = '',
  onChange,
  language = 'auto',
  className,
  id,
  placeholder,
  readOnly,
  disabled,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: CodeTextareaProps) {
  const editor = useRef<ReactCodeMirrorRef>(null)
  const [dark, setDark] = useState(false)
  const [label, setLabel] = useState(ariaLabel || placeholder || '代码编辑器')
  useEffect(() => {
    const update = () =>
      setDark(document.documentElement.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    const fieldLabel = id
      ? Array.from(document.querySelectorAll('label')).find(
          (element) => element.htmlFor === id,
        )
      : undefined
    if (!ariaLabel && fieldLabel?.textContent)
      setLabel(fieldLabel.textContent.trim())
    const focus = () => editor.current?.view?.focus()
    fieldLabel?.addEventListener('click', focus)
    return () => {
      observer.disconnect()
      fieldLabel?.removeEventListener('click', focus)
    }
  }, [ariaLabel, id])
  const detected =
    language === 'auto'
      ? /^\s*(?:\{|\[)/.test(value)
        ? 'json'
        : /^\s*(?:---\s*$|[\w.-]+:\s)/m.test(value)
          ? 'yaml'
          : 'text'
      : language
  const extensions = useMemo(
    () => [
      EditorView.lineWrapping,
      EditorState.phrases.of(translations),
      EditorView.contentAttributes.of({
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(invalid != null ? { 'aria-invalid': String(invalid) } : {}),
        ...(readOnly ? { 'aria-readonly': 'true' } : {}),
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
      }),
      ...(detected === 'javascript'
        ? [javascript()]
        : detected === 'json'
          ? [json()]
          : detected === 'yaml'
            ? [yaml()]
            : []),
    ],
    [detected, label, describedBy, invalid, readOnly, disabled],
  )
  return (
    <CodeMirror
      {...props}
      ref={editor}
      id={id}
      tabIndex={-1}
      className={cn(
        'code-editor relative min-h-48 min-w-0 overflow-hidden rounded-md border border-input bg-card text-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        disabled && 'opacity-50',
        invalid && 'border-destructive',
        className,
      )}
      value={value}
      onChange={onChange}
      theme={dark ? 'dark' : 'light'}
      extensions={extensions}
      height="100%"
      minHeight="inherit"
      maxHeight="32rem"
      placeholder={placeholder}
      editable={!disabled && !readOnly}
      readOnly={readOnly || disabled}
      indentWithTab={false}
      basicSetup={{
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) editor.current?.view?.focus()
      }}
    />
  )
}
