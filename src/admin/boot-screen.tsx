import { Button } from '@/admin/ui/button'
import { Toaster } from '@/admin/ui/sonner'

interface BootScreenProps {
  // False until the first request has come back at all — the plain "Lädt …" state.
  ready: boolean
}

// The admin's boot screen: what stands in for the shell until the first successful load. A failed load
// must not look like an empty registration list (the operator could mistake a backend hiccup for
// "nobody signed up"), so the error state says so and offers a reload. Split out of the shell, which is
// held to its file budget; the shell decides *when* this shows, this only renders it.
export const BootScreen = ({ ready }: BootScreenProps) => (
  <main className="grid min-h-svh place-items-center p-5">
    {!ready ? (
      <p className="text-muted-foreground text-sm">Lädt …</p>
    ) : (
      <p className="text-muted-foreground text-center text-sm">
        Konnte die Anmeldungen nicht laden.{' '}
        <Button variant="outline" size="sm" onClick={() => location.reload()}>
          Neu laden
        </Button>
      </p>
    )}
    <Toaster />
  </main>
)
