/**
 * Browser trajectory plugin contributing one entry to the conversation view
 * slot without defining a service.
 */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { en, NS, zh } from './locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory-compaction-definition.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory-request-header-definition.ts'
import {
  EMPTY_TRAJECTORY_SNAPSHOT, registerTrajectoryConversationView,
} from './trajectory-snapshot-builder.ts'
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import { registerTrajectoryToolDefinition } from './trajectory-tool-definition.ts'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'

export type { TrajectoryKey } from './locales.ts'
export type {
  TrajectoryContribution,
  TrajectoryConversationViewNode,
  TrajectoryRequestHeaderState,
  TrajectorySnapshot,
  UseTrajectory,
} from './trajectory-contract.ts'

/** Required services: the conversation slot, registries, ordinary Session paging, and the locale service. */
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale']

/** Browser trajectory plugin configuration. */
export interface Config {
  /**
   * The view-ring slot this ledger registers its tab into: a session-scoped
   * list slot whose owner share matches ui-conversation's ConvViewOwnerProps
   * (viewRequest/openView/completeViewRequest). A composition whose shell
   * never renders the upstream conversation ring — a replacement middle
   * column — hosts the ledger in its own declared ring by pointing this at
   * that ring's key; the key must name a slot some entry declares, or the
   * registration never lands. Default keeps upstream's conversation shell.
   */
  viewSlot?: string
}

/** Validated trajectory plugin configuration. */
export const Config: z<Config> = z.object({
  viewSlot: z.string().default('conversation.view'),
})

/**
 * Client plugin body: register the trajectory view tab. The registration
 * rides the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config = Config({})): void {
  // The validated string must narrow back to the literal key for the typed
  // register overloads below; the runtime register still validates the target
  // is a declared list slot when the declaration lands. The default-ring flag
  // is a separate boolean so the register branches never narrow it away.
  const defaultRing = config.viewSlot === 'conversation.view'
  const viewSlot = config.viewSlot as 'conversation.view'
  const trajectorySources = new WeakMap<SessionBinding, ObservableSnapshot<TrajectorySnapshot>>()
  const trajectorySource = (binding: SessionBinding): ObservableSnapshot<TrajectorySnapshot> => {
    let source = trajectorySources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('trajectory')
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_TRAJECTORY_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      trajectorySources.set(binding, source)
    }
    return source
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-trajectory: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  const duration = createTrajectoryDurationStore()
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  registerTrajectoryConversationView(ctx)
  ctx.uiSession.provide({
    hooks: ['trajectory'],
    resolve: binding => ({ hooks: { trajectory: trajectorySource(binding) } }),
  })
  const injectView = (sessionId: SessionId): TrajectoryViewInjected => {
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) {
      throw new Error(`ui-trajectory: session "${sessionId}" is unavailable`)
    }
    const trajectory = ctx.uiConversation.binding(sessionId).target('trajectory')
    return {
      hooks: { duration },
      loadOlder: async () => {
        const before = trajectory.getSnapshot()
        await session.loadOlder()
        return trajectory.getSnapshot() !== before
      },
      loadImage: Object.assign(
        (attachment: ImageAttachmentRef) => ctx.uiConversation.imageUrl(sessionId, attachment),
        { peek: (attachment: ImageAttachmentRef) => ctx.uiConversation.peekImageUrl(sessionId, attachment) },
      ),
      setActualDuration: (value) => { duration.set(value) },
    }
  }
  // The default branch keeps its options fully literal: the client slot
  // catalog is generated from register call sites and reads literal keys
  // only. A retargeted host takes the second branch with the same entry.
  ctx.slots.inject(viewSlot, () => defaultRing
    ? ctx.slots.register({
      name: 'conversation.view',
      id: 'trajectory',
      order: 10,
      locale: NS,
      label: () => t('view.trajectory'),
      children: {
        'conversation.trajectory.images': { kind: 'single', scope: 'session' },
      },
      inject: injectView,
    }, TrajectoryView)
    : ctx.slots.register({
      name: viewSlot,
      id: 'trajectory',
      order: 10,
      locale: NS,
      label: () => t('view.trajectory'),
      children: {
        'conversation.trajectory.images': { kind: 'single', scope: 'session' },
      },
      inject: injectView,
    }, TrajectoryView))
}
