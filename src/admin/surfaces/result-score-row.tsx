import { cn } from '@/admin/lib/utils'
import { Input } from '@/admin/ui/input'

// The result drawer's score inputs, split out of result-drawer.tsx so the drawer file stays about the two
// save paths rather than about number fields. Both sets and the Match-Tie-Break render through this one row.

// Two input strings for a set's two slots; '' when not entered.
export type Pair = [string, string]

// One set's two score inputs: the two slots' games (or, for the MTB, points), with the player names above.
// `invalid` flags an impossible score (a normal result only) so the operator sees which row blocks the save.
interface ScoreRowProps {
  label: string
  name1: string
  name2: string
  value: Pair
  onChange: (next: Pair) => void
  invalid?: boolean
}
export const ScoreRow = ({ label, name1, name2, value, onChange, invalid = false }: ScoreRowProps) => (
  <div className="flex flex-col gap-1">
    <span className="text-muted-foreground text-xs font-medium">{label}</span>
    <div className="flex items-center gap-2">
      <ScoreInput
        aria-label={`${label} — ${name1}`}
        value={value[0]}
        onChange={v => onChange([v, value[1]])}
        invalid={invalid}
      />
      <span className="text-muted-foreground">:</span>
      <ScoreInput
        aria-label={`${label} — ${name2}`}
        value={value[1]}
        onChange={v => onChange([value[0], v])}
        invalid={invalid}
      />
    </div>
    {invalid && <span className="text-destructive text-xs">Kein gültiges Ergebnis</span>}
  </div>
)

interface ScoreInputProps {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  'aria-label': string
}
const ScoreInput = ({ value, onChange, invalid = false, ...rest }: ScoreInputProps) => (
  <Input
    {...rest}
    type="number"
    inputMode="numeric"
    min={0}
    max={99}
    value={value}
    onChange={e => onChange(e.target.value)}
    className={cn('w-16 text-center tabular-nums', invalid && 'border-destructive focus-visible:ring-destructive')}
  />
)
