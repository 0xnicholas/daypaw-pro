// PROTOTYPE example — crash-recovery walkthrough (annotated pseudocode; not executed).
// Ticket #10 react surface: what the ledger/boot-scan/re-drive story looks like
// from the SDK author's chair, at three kill points.
//
// Setup: review-pipeline (examples/code-reviewer-pipeline.ts), runId 'review-42'.

/*
[K1] kill DURING the 'aggregate' step (LLM call mid-flight)
     ledger:  run/start ✓ · step fetch-diff end ✓ · step partition end ✓ ·
              2× agent child-run rows end ✓ · step aggregate START, no end
     reboot → boot scan finds run 'review-42' unfinished → re-drives body:
       - 'fetch-diff'   → key hit, recorded result returned (no refetch)
       - both ctx.agent → child runs recorded done, typed results returned
       - 'aggregate'    → start-without-end → re-executes (at-least-once)
     Author-visible truth: the body is just async code; dedup is invisible
     until you ask why nothing refetched.

[K2] kill WHILE waiting on a gate (deploy-with-approval, 'deploy-approval')
     ledger:  promise create · pending
     reboot → run waiting, no overdue timer → boot scan drives nothing
     (zero-compute wait — no polling, no daemons)
     Manager UI resolves the gate (payload validated against the zod schema)
       → next boot/pull point observes the resolution → re-drive reaches
         waitFor → returns the resolved value → body continues to 'deploy'

[K3] kill AFTER ctx.spawn fired a child, BEFORE parent completed
     child has its own runId and ledger rows — boot scan revives BOTH runs
     independently (ADR 0003: spawn children self-revive); parent's later
     steps re-drive against the child's already-recorded state.

[EDGE] awaited SUB-WORKFLOW call (the open primitive question):
     Draft idiom — inside a step, plain def.run() with engine-derived runId:

       const merged = await ctx.step('merge-report', async () => {
         const child = summaryWorkflow.run({ reportId })        // start-or-attach
         return child.result                                    // awaited
       })

     Crash between child completion and step completion → re-drive re-executes
     the step → run() attaches (NOT a second child) ONLY IF the engine derives
     a deterministic child runId from (parentRunId, stepKey, occurrence).
     Alternatives on the table: a sixth primitive ctx.call, or generalizing
     ctx.agent to accept WorkflowDefinition. This is README Q1.
*/
export {}
