import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'

import { cn } from '@/admin/lib/utils'

// A styled native <select> — kept native (not a Radix popover) so the operator gets the platform
// picker while editing on a phone (mobile-first CRUD, ADR-0016). Matches the shadcn Input look so
// it sits cleanly next to the other field controls in the detail panel.
const NativeSelect = ({ className, children, ...props }: React.ComponentProps<'select'>) => {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          'border-input h-9 w-full appearance-none rounded-md border bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
    </div>
  )
}

export { NativeSelect }
