/**
 * New-task dialog body (the 'inbox.new-task.dialog' occupant): definition
 * picker over the engine registry's roster (business names, first row
 * preselected) and the input surface the picked definition's `inputKind`
 * rules (ruling #65 §7): a free-text area for the starter text shapes, a JSON
 * area with inline syntax validation for every other shape. The Modal chrome
 * (title, mask, Escape) stays with InboxNav; on success the owner navigates
 * and dismisses — an agent run opens its conversation, a workflow run opens
 * the run itself. The roster loads on first open and submit stays disabled
 * until it is ready and the draft is usable.
 */
import { useEffect } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NewTaskState, NewTaskStore } from './new-task-store.ts'
import css from './new-task-dialog.module.css'

/** Registration-side business face for the dialog body. */
export interface NewTaskDialogInjected {
  hooks: {
    /** Dialog state, bound by the renderer as useNewTask. */
    newTask: SnapshotStore<NewTaskState>
  }
  /** The dialog controller (load roster, edit draft, submit). */
  store: NewTaskStore
}

/** Full component props: owner share + injected face + locale seat. */
export type NewTaskDialogProps =
  PropsRuntime<'inbox.new-task.dialog'>
  & InjectFace<NewTaskDialogInjected>
  & PropsLocale<'daypaw-tasks'>

/**
 * Render the new-task dialog body.
 * @param props - composed slot props (owner share + injected face + locale seat).
 * @returns the dialog body tree.
 */
export function NewTaskDialog({ openTask, openRun, useNewTask, store, t }: NewTaskDialogProps) {
  const state = useNewTask(s => s)
  // First-open roster load; a later re-open reuses the ready snapshot and
  // retries after a load failure (the roster error is not a wedge).
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'error') void store.load()
  }, [state.status, store])

  // A definition without a row is the unsettled-roster case (text is inert);
  // a row with `inputKind: null` carries no wire face and shares the JSON
  // surface with the json kind, exactly as `composeInput` reads it.
  const selectedRow = state.definitions.find(row => row.id === state.selected)
  const selectedKind = selectedRow === undefined ? 'text' : selectedRow.inputKind
  const jsonKind = selectedKind !== 'text'
  const parsedJson = jsonKind ? store.parseJsonDraft() : undefined
  const jsonInvalid = jsonKind && parsedJson instanceof SyntaxError
  const draftUsable = jsonKind
    ? state.json.trim() !== '' && !jsonInvalid
    : state.text.trim() !== ''

  const submit = (): void => {
    void store.submit().then((outcome) => {
      if (outcome === undefined) return
      if (outcome.kind === 'task') openTask(outcome.sessionId)
      else openRun(outcome.runId)
    })
  }
  const canSubmit = state.status === 'ready' && state.selected !== undefined && draftUsable && !state.submitting

  return (
    <div className={css.root}>
      <label className={css.field}>
        <span className={css.label}>{t('dialog.type.label')}</span>
        <select
          className={css.select}
          aria-label={t('dialog.type.label')}
          disabled={state.status !== 'ready' || state.definitions.length === 0 || state.submitting}
          value={state.selected ?? ''}
          onChange={(event) => { store.select(event.target.value) }}
        >
          {state.definitions.length === 0
            ? <option value="">{t('dialog.type.empty')}</option>
            : state.definitions.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
      </label>
      {jsonKind
        ? (
          <label className={css.field}>
            <span className={css.label}>{t('dialog.json.label')}</span>
            <textarea
              className={css.textarea}
              aria-label={t('dialog.json.label')}
              placeholder={t('dialog.json.placeholder')}
              disabled={state.submitting}
              value={state.json}
              onChange={(event) => { store.setJson(event.target.value) }}
            />
            {state.json.trim() !== '' && jsonInvalid && <p className={css.error}>{t('dialog.json.invalid')}</p>}
          </label>
        )
        : (
          <label className={css.field}>
            <span className={css.label}>{t('dialog.text.label')}</span>
            <textarea
              className={css.textarea}
              aria-label={t('dialog.text.label')}
              placeholder={t('dialog.text.placeholder')}
              disabled={state.submitting}
              value={state.text}
              onChange={(event) => { store.setText(event.target.value) }}
            />
          </label>
        )}
      {state.status === 'error' && <p className={css.error}>{t('dialog.load-failed')}</p>}
      {state.submitFailed && <p className={css.error}>{t('dialog.create-failed')}</p>}
      <div className={css.actions}>
        <Button
          variant="primary"
          className={clsx(css.submit)}
          disabled={!canSubmit}
          onClick={submit}
        >
          {state.submitting ? t('dialog.submitting') : t('dialog.submit')}
        </Button>
      </div>
    </div>
  )
}
