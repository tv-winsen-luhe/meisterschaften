'use client'

import { type CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// shadcn/ui Sonner Toaster — owned source (ADR-0016), adapted to arrow-function style. The admin is
// light-only (ADR-0016), so the theme is pinned to "light" instead of reading next-themes (which
// this Astro island does not use). The CSS variables map the toast surface onto the neutral shadcn
// palette so toasts match the rest of the admin.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)'
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
