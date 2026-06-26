import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// The shadcn class-merge helper: compose conditional class lists (clsx) and let the later
// Tailwind utility win on conflicts (tailwind-merge). Used by every component under @/admin/ui.
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
