import { CalendarDays, ClipboardList, LayoutDashboard, LogOut, Shuffle, Trophy } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/admin/ui/sidebar'

// The two surfaces this slice ships (ADR-0019). Übersicht is a thin stub here; Anmeldungen is the
// existing registration workbench. Surface switching is client-side inside the single island
// (ADR-0008) — these are not Astro routes.
export type Surface = 'overview' | 'registrations'

const SURFACES: { id: Surface; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Übersicht', icon: LayoutDashboard },
  { id: 'registrations', label: 'Anmeldungen', icon: ClipboardList }
]

// The surfaces whose phase has not yet produced data: shown so the frame is set before they
// exist, disabled so they cannot be entered (ADR-0019).
const PLACEHOLDERS: { label: string; icon: typeof LayoutDashboard }[] = [
  { label: 'Auslosung', icon: Shuffle },
  { label: 'Spielplan', icon: CalendarDays },
  { label: 'Ergebnisse', icon: Trophy }
]

interface AppSidebarProps {
  active: Surface
  onSelect: (surface: Surface) => void
}

// The shell's navigation (ADR-0019): an icon-collapsible sidebar that answers "where am I",
// independent of the phase stepper's "where is the event". Neutral, light-only (ADR-0016).
export const AppSidebar = ({ active, onSelect }: AppSidebarProps) => (
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild className="pointer-events-none">
            <div>
              <img src="/signet.svg" alt="TV Winsen" width={32} height={32} className="size-8 shrink-0" />
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
        <SidebarGroupLabel>Verwaltung</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {SURFACES.map(s => (
              <SidebarMenuItem key={s.id}>
                <SidebarMenuButton isActive={active === s.id} tooltip={s.label} onClick={() => onSelect(s.id)}>
                  <s.icon />
                  <span>{s.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Turnier</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {PLACEHOLDERS.map(p => (
              <SidebarMenuItem key={p.label}>
                <SidebarMenuButton disabled tooltip={`${p.label} — folgt`} className="opacity-50">
                  <p.icon />
                  <span>{p.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
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
