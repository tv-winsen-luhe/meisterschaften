import { LayoutDashboard } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'

// The Übersicht surface is intentionally a stub in this slice (ADR-0019): it will summarise the
// "neu — zu bestätigen" call-to-action, fill per Konkurrenz, and total counts in a later slice.
// The shell already reaches it in every phase, so it shows an empty state explaining why.
export const OverviewSurface = () => (
  <Empty className="m-5 border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <LayoutDashboard />
      </EmptyMedia>
      <EmptyTitle>Übersicht folgt</EmptyTitle>
      <EmptyDescription>
        Hier fassen wir bald Anmeldezahlen, Feld-Auslastung und offene Bestätigungen auf einen Blick zusammen. Bis dahin
        verwaltest du alles unter „Anmeldungen“.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
)
