/**
 * daypaw shell IA skeleton (inbox workbench), browser half: three
 * registrations over ui-layout's frame — InboxNav into 'sidebar' (replacing
 * the upstream ui-sidebar roster row), WorkspaceSwitch into 'conversation'
 * and TaskDetail into 'details', both at priority -1 so they shadow
 * ui-conversation's priority-0 placeholder occupants while its declared
 * seats stay live for the dormant ecosystem. The cordis fiber inject waits
 * on the `layout` service, which ui-layout provides in the same effect that
 * declares the four slots, so direct `ctx.slots.register` is safe here (the
 * ui-sidebar precedent). Shared selection crosses the three scopes through
 * the inject hooks compartments of one apply-closure controller.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-layout's SlotMap merge ('sidebar'/'conversation'/'details').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InboxNavInjected } from './InboxNav.tsx'
import { InboxNav } from './InboxNav.tsx'
import type { WorkspaceSwitchInjected } from './WorkspaceSwitch.tsx'
import { WorkspaceSwitch } from './WorkspaceSwitch.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { InboxSelectionController } from './selection.ts'
import { en, zh, type InboxKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** daypaw inbox workbench copy. */
    inbox: InboxKey
  }
}

/** Dictionary namespace owned by this plugin (workbench copy). */
const NS = 'inbox'

/** Services required by the inbox workbench plugin. */
export const inject = ['slots', 'layout', 'locale']

/** Priority below ui-conversation's default-0 occupants: lowest live priority renders. */
const SHADOW_PRIORITY = -1

/** Registers the three column occupants sharing one selection controller.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-inbox: dictionaries')

  // One apply-closure controller; a shared store handle cannot cross the
  // three slot scopes, so the bare source travels through each register
  // call's inject hooks compartment (renderer binds it as useSelection).
  const selection = new InboxSelectionController()

  ctx.effect(() => {
    const nav = ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      inject: (): InboxNavInjected => ({
        hooks: { selection: selection.store },
        select: (next) => { selection.select(next) },
        toggleSidebar: () => { ctx.layout.toggleSidebar() },
      }),
    }, InboxNav)
    const workspace = ctx.slots.register({
      name: 'conversation',
      priority: SHADOW_PRIORITY,
      locale: NS,
      inject: (): WorkspaceSwitchInjected => ({ hooks: { selection: selection.store } }),
    }, WorkspaceSwitch)
    const detail = ctx.slots.register({
      name: 'details',
      priority: SHADOW_PRIORITY,
      locale: NS,
    }, TaskDetail)
    return () => {
      nav()
      workspace()
      detail()
    }
  }, 'ui-inbox: slot registrations')
}
