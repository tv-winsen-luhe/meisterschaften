'use client'

import { type CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// shadcn/ui Sonner Toaster — owned source (ADR-0016), adapted to arrow-function style. The admin is
// light-only (ADR-0016), so the theme is pinned to "light" instead of reading next-themes (which
// this Astro island does not use). The CSS variables map the default (neutral) toast surface onto the
// shadcn palette. `richColors` colour-codes the typed toasts by severity (#139) — error red, warning
// amber, success green, info blue — so the operator reads severity at a glance instead of one flat
// surface; a plain `toast()` (no type) stays neutral.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      richColors
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
