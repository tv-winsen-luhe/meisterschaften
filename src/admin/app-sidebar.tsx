import { Bug, CalendarDays, ClipboardList, LayoutDashboard, ListOrdered, LogOut, Shuffle, Trophy } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator
} from '@/admin/ui/sidebar'

// The two surfaces this slice ships (ADR-0019). The overview is the home dashboard; registrations is
// the registration workbench. Surface switching is client-side inside the single island (ADR-0008) —
// these are not Astro routes.
export type Surface = 'overview' | 'registrations' | 'seeding' | 'competitions' | 'schedule' | 'debug'

// Navigation is one flat list in event-flow order (ADR-0023): overview (home), then the phase
// surfaces in the order the event runs them. Registrations is live; the later phases are disabled
// placeholders so the frame is set before they exist (ADR-0019). The old administration/tournament
// grouping is dropped — it was a false axis (registrations is as much "tournament" as "administration").
interface NavItem {
  id: Surface
  label: string
  icon: typeof LayoutDashboard
}
const HOME: NavItem = {
  id: 'overview',
  label: 'Übersicht',
  icon: LayoutDashboard
}

interface PhaseEntry {
  label: string
  icon: typeof LayoutDashboard
  // The live surfaces carry a Surface id; the not-yet-built phases are disabled placeholders.
  surface?: Surface
}
const PHASES: PhaseEntry[] = [
  { label: 'Anmeldungen', icon: ClipboardList, surface: 'registrations' },
  // The provisional seeding list (issue #72): the pre-draw review the operator eyeballs before
  // auslosen, so it sits just before Auslosung in event-flow order.
  { label: 'Setzliste', icon: ListOrdered, surface: 'seeding' },
  { label: 'Auslosung', icon: Shuffle, surface: 'competitions' },
  // The schedule grid (issue #88): the operator places drawn matches onto courts × time slots, so it
  // sits right after the draw in event-flow order.
  { label: 'Spielplan', icon: CalendarDays, surface: 'schedule' },
  { label: 'Ergebnisse', icon: Trophy }
]

interface AppSidebarProps {
  active: Surface
  onSelect: (surface: Surface) => void
  // The "new" queue size, shown as an ambient badge on registrations (ADR-0023) now that the
  // overview no longer carries the big call-to-action.
  newCount: number
  // Whether the debug-only reset surface exists in this environment (RESET_ENABLED, ADR-0029).
  // Off in production, so the nav entry never shows there.
  showDebug: boolean
}

// The shell's navigation (ADR-0019): an icon-collapsible sidebar that answers "where am I",
// independent of the phase stepper's "where is the event". Neutral, light-only (ADR-0016).
export const AppSidebar = ({ active, onSelect, newCount, showDebug }: AppSidebarProps) => (
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild className="pointer-events-none">
            <div>
              {/* Full club emblem, not the signet — a deliberate operator override (ADR-0023): the
                  rim text is illegible at this size, accepted as decorative. */}
              <img src="/club-logos/tv-winsen.svg" alt="TV Winsen" width={32} height={32} className="size-8 shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Meisterschaften</span>
                <span className="text-muted-foreground truncate text-xs">2026 · Admin</span>
              </div>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={active === HOME.id} tooltip={HOME.label} onClick={() => onSelect(HOME.id)}>
                <HOME.icon />
                <span>{HOME.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {PHASES.map(p =>
              p.surface ? (
                <SidebarMenuItem key={p.label}>
                  <SidebarMenuButton
                    isActive={active === p.surface}
                    tooltip={p.label}
                    onClick={() => onSelect(p.surface!)}
                  >
                    <p.icon />
                    <span>{p.label}</span>
                  </SidebarMenuButton>
                  {p.surface === 'registrations' && newCount > 0 && <SidebarMenuBadge>{newCount}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ) : (
                <SidebarMenuItem key={p.label}>
                  <SidebarMenuButton disabled tooltip={`${p.label} — folgt`} className="opacity-50">
                    <p.icon />
                    <span>{p.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      {/* Set off from the nav by a separator (ADR-0023). */}
      <SidebarSeparator />
      <SidebarMenu>
        {/* Debug-only reset surface (ADR-0029): present solely when RESET_ENABLED is on, set apart in
            the footer so it never reads as part of the operator's event-flow navigation. */}
        {showDebug && (
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={active === 'debug'}
              tooltip="Debug"
              onClick={() => onSelect('debug')}
              className="text-amber-700 data-[active=true]:bg-amber-50 data-[active=true]:text-amber-900"
            >
              <Bug />
              <span>Debug</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenuItem>
          {/* Edge-only auth (ADR-0008): logout hands off to the Cloudflare Access endpoint. */}
          <SidebarMenuButton asChild tooltip="Abmelden">
            <a href="/cdn-cgi/access/logout">
              <LogOut />
              <span>Abmelden</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
)
