/** 来源：shadcn.io QR Code；按项目风格补充扫码留白与异步清理。 */
import { formatHex, oklch } from 'culori'
import QR from 'qrcode'
import { useEffect, useState } from 'react'
import type { HTMLAttributes } from 'react'
import { cn } from '#/lib/utils'

export type QRCodeProps = HTMLAttributes<HTMLDivElement> & {
  data: string
  foreground?: string
  background?: string
  robustness?: 'L' | 'M' | 'Q' | 'H'
}

const oklchRegex = /oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/

const getOklch = (color: string, fallback: [number, number, number]) => {
  const oklchMatch = color.match(oklchRegex)

  if (!oklchMatch) {
    return { l: fallback[0], c: fallback[1], h: fallback[2] }
  }

  return {
    l: Number.parseFloat(oklchMatch[1]),
    c: Number.parseFloat(oklchMatch[2]),
    h: Number.parseFloat(oklchMatch[3]),
  }
}

export const QRCode = ({
  data,
  foreground,
  background,
  robustness = 'M',
  className,
  ...props
}: QRCodeProps) => {
  const [svg, setSVG] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const generateQR = async () => {
      try {
        const styles = getComputedStyle(document.documentElement)
        const foregroundColor =
          foreground ?? styles.getPropertyValue('--foreground')
        const backgroundColor =
          background ?? styles.getPropertyValue('--background')

        const foregroundOklch = getOklch(
          foregroundColor,
          [0.21, 0.006, 285.885],
        )
        const backgroundOklch = getOklch(backgroundColor, [0.985, 0, 0])

        const newSvg = await QR.toString(data, {
          type: 'svg',
          color: {
            dark: formatHex(oklch({ mode: 'oklch', ...foregroundOklch })),
            light: formatHex(oklch({ mode: 'oklch', ...backgroundOklch })),
          },
          width: 200,
          errorCorrectionLevel: robustness,
          margin: 4,
        })

        if (!cancelled) setSVG(newSvg)
      } catch (err) {
        if (!cancelled) console.error('二维码生成失败', err)
      }
    }

    void generateQR()
    return () => {
      cancelled = true
    }
  }, [data, foreground, background, robustness])

  if (!svg) {
    return null
  }

  return (
    <div
      className={cn('size-full', '[&_svg]:size-full', className)}
      dangerouslySetInnerHTML={{ __html: svg }}
      {...props}
    />
  )
}
