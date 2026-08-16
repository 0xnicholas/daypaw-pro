# Research: Palantir AIP Evolve — the mechanics beneath the headline

**Scope:** Primary sources only (palantir.com / docs.palantir.com / investors.palantir.com, official Palantir YouTube, official Palantir LinkedIn, Palantir Developer Community). Third-party material was used only to *locate* primary sources, never as evidence.

**Timeline correction to the task premise:** AIP Evolve was **not** announced in late 2025. First public marketing appears to be **~June 2, 2026** (Palantir LinkedIn launch post + the "Chad & Colton" video; third-party commentary on the announcement is dated 2026-06-02). **DevCon 6 was July 2026** (DevCon 6 videos published 2026-07-14 on the official Palantir channel; DevCon 6 LinkedIn posts 2026-07-15/16), where AIP Evolve was positioned inside the newly introduced "Agent Stack". The Q2 2026 investor deck (Aug 2026) recaps it. Note: an unanswered community question titled "AIP Evolve? Where's the tutorial?" is dated **2026-04-30**, i.e., the name was circulating slightly before the June launch — unexplained by public sources (see Gaps).

**Provenance caveats (read first):**
- The two demo "transcripts" quoted below are the **auto-captions of Palantir's own videos, embedded on Palantir's official LinkedIn post pages** (first-party distribution). ASR garbling exists; I mark obvious ones (`GT 4.1 mini` = GPT-4.1 mini, `OS DK` = OSDK, `Evolved` = Evolve).
- The investor-deck quote is from the OCR'd PDF of Palantir's Q2 2026 Business Update.
- The DevCon 6 "Product Launch: Agent Observability & Optimization" talk (YouTube `GZHSCMz6Aio`, official channel confirmed via oEmbed) could **not** be transcribed in this environment (no yt-dlp/credentials); only its title is used.

---

## Summary

AIP Evolve is Palantir's product for optimizing deployed agents/agent workflows: a human configures an optimization run (allowed change types, a validation strategy, and an iteration budget), clicks "Evolve", and an automated, multi-iteration optimization loop screens model swaps across providers, re-tunes prompts per candidate model, and proposes architectural changes (extract deterministic logic from LLM usage, lean on Ontology data to eliminate LLM calls, restructure tools/function calls). Candidates are filtered by **evals plus expert human pass/fail feedback** (collected through a review app that Evolve itself generates on the Ontology), producing a "final proposal" with a full lineage graph of every tested step. Everything shown is **on-demand, human-initiated, human-budgeted, and human-reviewed**; the marketing word "autonomous" describes the in-run change generation/testing, not unattended self-promotion. There is **no public product documentation, no pricing, no API surface** — all mechanics below come from two demo videos, LinkedIn copy, and one investor slide.

---

## 1. Optimization target & granularity

**What Evolve varies (all from the demos):**

1. **Model selection — whole deployment swap, across providers.** "End results, we see a cut compute cost by 97% and that was just by swapping from GPT 5.1 to 5.4 nano [sic]." [Chad & Colton demo transcript, embedded on Palantir's official LinkedIn post](https://www.linkedin.com/posts/palantir-technologies_aip-evolve-our-new-product-for-making-agents-activity-7466229875868356608-PuLS). "We were able to replace Claude Sonnet entirely with GPT-5 mini for an overall reduction of 68% lower costs." [Palantir LinkedIn, Tampa General demo post](https://www.linkedin.com/posts/palantir-technologies_at-devcon6-see-how-dr-david-zihr-medical-activity-7485030356522336256-1oOV). "Evolve screened a whole different suite of models. It tried to cross providers, GT 4.1 mini [GPT-4.1 mini], some nano models on the later generations, Claude Haiku, Gemini Flash, etcetera." [TGH/Colton demo transcript, Palantir LinkedIn post](https://www.linkedin.com/posts/palantir-technologies_see-how-palantir-forward-deployed-engineer-activity-7485082212904800256-rMlx)
2. **Prompts — rewritten per candidate model, on the AIP Logic function being optimized.** "when I do swap models, I'm going to inevitably need to tune the prompt a bit because every model has its own quirks. Evolve can do that." [PuLS transcript] … "Evolve started to take each of these different options separately, then optimize the prompts for them each suited to whatever model we were swapping to" … the new prompt "goes into all sorts of detail around the tone, details to include and exclude … ways of structuring these utilization reviews." [rMlx transcript]
3. **Architecture / agent design — the headline "4th dimension".** Allowed change categories in the config UI: "architectural changes like extracting deterministic logic out of LLM usage or even like leaning more on the ontology … thinking more about how I've designed my agent, tuning how we've set up tools and function calls and restructuring those." [PuLS transcript]. Post copy: "find structured ontology data that eliminated 2 LLM calls." [PuLS post text]
4. **Output validation — a user-chosen "validation strategy".** "what level of divergence am I OK with? Do I really need like an exact match on the outputs? Am I looking for just kind of semantic equivalents? … or do I kind of want to let evolve decide and kind of have a best effort sort of thing? So that's a validation strategy." [PuLS transcript]
5. **Investor-deck one-liner (broadest phrasing):** "Optimize your AI systems with agents that automatically test model swaps and architecture changes." — paired with the **AIP EVOLVE** label on the DevCon 6 slide. [Palantir Q2 2026 Business Update, p.11](https://investors.palantir.com/files/Palantir%20-%20Q2%202026%20Business%20Update.pdf)

**Granularity:** Demos show optimization at the level of **one deployed agent / AIP Logic function** (e.g., a utilization-review agent), with the model swap applied to the whole function. Whether Evolve can vary models **per step / per call-site within an agent** is **not documented**. The "variant" artifact is not formally named; the closest concepts are the per-step nodes in the optimization **lineage graph** and the "**final proposal**" ("that's what progressed us towards this final proposal", [rMlx transcript]).

## 2. Loop mechanics

- **Agentic, not a plain search grid — but with search-like behavior.** The investor deck calls it "agents that automatically test model swaps and architecture changes" [Q2 2026 deck, p.11]. The TGH demo shows screening across a model suite, pruning, then per-survivor prompt optimization across "multiple iterations": "based on both the evals and the expert feedback, it was able to rule out certain options, keep some for further optimization … it gets more and more complex as Evolve started to take each of these different options separately, then optimize the prompts for them each." [rMlx transcript]
- **Run kickoff is a human click after a config wizard.** "we can add constraints about what's the budget we have for this optimization. So in this example, I'm going to say 5 iterations is fine and then I'm prompted to kind of review all my choices. And I can click this big purple evolve button at the bottom and that will kind of kick off this optimization." [PuLS transcript]
- **Every optimization step is recorded as a graph.** "here's the agent graph, the lineage here of each optimization step Evolve took … you can see really everything that Evolve tested." [rMlx transcript]
- **Cadence:** Marketing says "AIP Evolve for **continuous, end-to-end** optimization" [Palantir LinkedIn, Agent Stack unveiling](https://www.linkedin.com/posts/palantir-technologies_at-devcon-6-palantir-software-engineer-ankit-activity-7483180033675509760-Uprt), but every demonstrated run is **on-demand**. Scheduled/always-on operation: **not documented**.
- **Who generates candidates:** not stated in engineering terms. The demos + deck imply an LLM-driven optimizer agent proposing and testing changes (it rewrites prompts "suited to whatever model we were swapping to" and even builds a review application). Internal architecture: **not documented**.

## 3. Evaluation

- **Test-case selection is done by Evolve, by category.** "Here's how it selected test cases. So it divided all of these different rod [sic] scenarios into different categor[ies]." [PuLS transcript] … "Evolve sampled a list of different test cases it wanted expert review on." [rMlx transcript]
- **Two gates: automatic evals + expert human feedback.** "Evolve screened a whole suite of models across providers, then used **evals and expert feedback** to rule out certain options and keep others for further optimization." [rMlx post text]
- **Evolve generates the expert-review instrument itself — a custom OSDK app on the Ontology.** "Evolve built out this application … It's a fully custom OS DK [OSDK] application built on the TH [TGH] ontology … It placed them in this interface where it gave the old version of the outputs versus the new optimized version of the outputs. [It] gave its analysis … situated all of that within the actual ontology context of, in this example, the patients chart, the notes, the labs, et cetera … an expert could go in, leave their feedback, their pass fail results here on this optimization test case by test case." [rMlx transcript]
- **Reported outcomes:** "cut compute cost by 97% … improved on latency … improved on quality by 7 percentage points" [PuLS transcript]; "68% lower compute costs, but at the same time, after we did this expert side-by-side review, we found that 90% of the time our expert preferred the optimized version over the unoptimized version." [rMlx transcript]
- **Relationship to the AIP Evals product:** **not explicitly documented.** AIP Evals itself is a fully documented public product — "a testing environment to evaluate the performance of your AIP Logic functions, AIP Chatbot functions, or code-authored functions … create test cases, define evaluation functions to measure performance, and compare the results against previous versions" ([docs: AIP Evals overview](https://palantir.com/docs/foundry/aip-evals/overview/)), with pass criteria ("AIP Evals will automatically determine a `Passed` or `Failed` status for each test case", [analyze run results](https://palantir.com/docs/foundry/aip-evals/analyze-run-results/)), auto-generated evals ("select **Generate evals** … to have AIP bootstrap useful tests and evaluators for you", [getting started](https://palantir.com/docs/foundry/aip-evals/getting-started/)), and LLM-as-judge evaluators ("out-of-the-box provided Rubric grader", [analyze run results](https://palantir.com/docs/foundry/aip-evals/analyze-run-results/)). Evolve's demos say "evals" and its "validation strategy" (exact / semantic-equivalent / best-effort) plausibly maps onto these evaluators, but the integration is **inference, not documentation**.
- **Statistical significance / must-not-be-worse thresholds:** **not documented.**

## 4. Promotion & versioning

- **Diff/preview exists for prompts and outputs.** "here on the left side you can see the old unoptimized version of the AIP logic, on the right you can see the optimized version" (prompt diff), and the review app shows "the old version of the outputs versus the new optimized version" (output diff). [rMlx transcript]
- **The run terminates in a "final proposal"** — "that's what progressed us towards this final proposal." [rMlx transcript]
- **Full per-step lineage is retained:** "the agent graph, the lineage here of each optimization step Evolve took." [rMlx transcript]
- **How a proposal becomes the production version, versioning of variants, rollback, provenance records:** **not documented** in any public source.

## 5. Human-in-the-loop & safety

- **Human-configured guardrails before every run:** the user selects allowed change types (model swap, prompt tuning, architectural changes), the validation strategy, and the iteration budget, then reviews "all my choices" before clicking the Evolve button. [PuLS transcript]
- **Expert humans inside the loop during the TGH run:** pass/fail feedback per test case in the generated review app fed the pruning decisions. [rMlx transcript] Customer quote framing the constraint: "We can't have cheaper AI at the expense of a worse clinical narrative being told with worse evidence." [1oOV]
- **What "autonomous" actually means:** the word appears in post copy — "See how Chad and Colton used it to **autonomously** swap models, tune prompts, validate outputs, and find structured ontology data" [PuLS post text] — describing the automated generation/testing of changes **inside** a human-initiated, human-budgeted run. No source shows Evolve promoting changes to production unattended.
- **Budgets/caps:** only an **iteration-count budget** is shown ("5 iterations"). Monetary cost caps, approval workflows, autonomous promotion: **not documented**.

## 6. Infrastructure prerequisites

- **Ontology is load-bearing, in two ways:** (a) the stack framing — "All built on the Ontology, to power agents that actually work in production" [Palantir LinkedIn, Agent Stack post](https://www.linkedin.com/posts/palantir-technologies_anyone-can-build-an-agent-but-to-build-a-activity-7482798828824248320-vGDW); (b) the optimization target set includes "leaning more on the ontology" to eliminate LLM calls, and the expert-review app is generated as "a fully custom OSDK application built on the TGH ontology." [PuLS / rMlx transcripts]
- **The optimization target shown is an AIP Logic function** ("the old unoptimized version of the AIP logic"). [rMlx transcript]
- **Telemetry/observability context (Agent Stack sibling products):** "Agent Manager for actionable telemetry and observability" [Uprt]; AIP Inspect / Agent Timeline demo: "Most platforms will give you raw telemetry and expect you to drink from the firehose … There's no homework for you. **This telemetry is generated by every agent**." [Palantir LinkedIn, AIP Inspect post](https://www.linkedin.com/posts/palantir-technologies_at-devcon-6-see-how-palantir-group-lead-activity-7483964343961722880-dsbB). Platform docs separately document trace views ("visualize the full request journey across functions, actions, and LLM calls", [docs: Observability overview](https://palantir.com/docs/foundry/observability/overview/)).
- **Whether Evolve strictly requires Agent Manager telemetry / traces as input:** **not documented.** The demos don't show the input corpus explicitly; the lineage graph and category-based test-case selection imply stored scenario/run data, but the source (traffic replay vs. curated) is **not documented**.

## 7. Maturity & availability

- **Positioning:** "our new product" (June 2026 LinkedIn launch); part of the Agent Stack unveiled at DevCon 6 (July 2026); one-line feature in the Q2 2026 investor deck. [PuLS; Uprt; Q2 2026 deck p.11]
- **No public documentation exists.** Negative checks performed: no AIP Evolve page anywhere under palantir.com/docs (site-wide searches; direct URL guesses 404); the docs [Announcements for 2026-07](https://palantir.com/docs/foundry/announcements/2026-07/) and 2026-08 contain **zero** mentions of "Evolve", "Agent Manager", or agent optimization; nothing on build.palantir.com or learn.palantir.com; no blog.palantir.com post about Evolve found.
- **Community confirms the doc gap:** "Has anyone successfully used AIP Evolve? I'm trying to learn more and AIP Assist didn't know what it was (maybe this isn't a Palantir off-the-shelf product?). It took me a minute to realize this was not Evals." — posted 2026-04-30, **zero replies** as of retrieval. [Palantir Developer Community](https://community.palantir.com/t/aip-evolve-where-s-the-tutorial/6526)
- **Real usage shown is FDE-led:** the only customer deployment shown is Tampa General Hospital with a Palantir Forward Deployed Engineer driving. [1oOV; rMlx]
- **Pricing, GA/beta status, waitlist, public API/SDK:** **not documented / no signals found.**

---

## Not publicly documented (explicit gap list)

1. Internal architecture of the optimizer (rules vs. LLM proposer vs. hybrid); the name/nature of the "variant" artifact.
2. Model-routing granularity (per-agent vs. per-step vs. per-call-site routing).
3. Prompt-variation granularity (whole system prompt vs. segments/templates/few-shot).
4. Source of eval sets (production traffic replay vs. human-curated vs. synthetic); the meaning of the "rod [sic] scenarios" categories.
5. Formal integration with the AIP Evals product (shared suites? separate?).
6. Pass/regression criteria, thresholds, statistical-significance handling.
7. Promotion mechanics: how a "final proposal" is deployed; versioning; rollback; provenance records; approval workflows.
8. Whether any promotion is autonomous; monetary cost budgets/caps.
9. Hard infrastructure prerequisites (Ontology mandatory? Agent Manager traces mandatory?).
10. Availability (GA/beta/waitlist), pricing, API/SDK surface.
11. Full transcript of the DevCon 6 launch talk "Product Launch: Agent Observability & Optimization" ([YouTube GZHSCMz6Aio](https://www.youtube.com/watch?v=GZHSCMz6Aio), official channel) — not retrievable in this environment.
12. Why the name "AIP Evolve" was already circulating by 2026-04-30 (unanswered forum question predates the June launch).

## Sources

**Kept (primary):**
- Palantir LinkedIn — AIP Evolve launch post with embedded demo transcript (activity-7466229875868356608-PuLS) — the single richest mechanics source (config wizard, validation strategy, change types, budget, results).
- Palantir LinkedIn — Colton Rusch / TGH post with full demo transcript (activity-7485082212904800256-rMlx) — model screening, expert-review OSDK app, lineage graph, prompt diff, 68%/90% numbers.
- Palantir LinkedIn — Dr. Zihr / TGH post (activity-7485030356522336256-1oOV) — customer constraint quote, Claude Sonnet → GPT-5 mini swap.
- Palantir LinkedIn — Agent Stack unveiling (activity-7483180033675509760-Uprt) and Agent Stack post (activity-7482798828824248320-vGDW) — product framing, Ontology dependency.
- Palantir Q2 2026 Business Update PDF (investors.palantir.com) — official one-line definition of AIP Evolve.
- YouTube official Palantir channel — "Chad & Colton | Making Agents More Efficient and Cost Effective" (p0pjtkg1ny4) and "Product Launch: Agent Observability & Optimization | DevCon 6" (GZHSCMz6Aio) — canonical video sources (transcript of the latter unavailable).
- docs.palantir.com — AIP Evals docs (overview / getting-started / create-suite / run-suite / analyze-run-results) — documented sibling product used for Q3 context.
- docs.palantir.com — Observability overview; Announcements 2026-07 / 2026-08 — context + negative evidence.
- Palantir Developer Community thread 6526 — negative evidence on docs/maturity.

**Dropped (third-party, used only to locate primaries):**
- BestHub / Ena Pragma / agno.com write-ups — commentary; not used as evidence.
- Rahul Garg / DWJC / Anthony Mansfield LinkedIn commentary — third-party interpretations; DWJC used only to date the June 2026 announcement.

## Gaps / suggested next steps

1. Watch [GZHSCMz6Aio](https://www.youtube.com/watch?v=GZHSCMz6Aio) and the Agent Stack full demo manually with captions on — the launch talk likely names the optimizer's internals and the promotion flow.
2. Re-check docs.palantir.com monthly: the 2026-07/08 announcement silence suggests docs land later (as with other Agent Stack products).
3. Ask in the Palantir Developer Community (build-with-aip tag) about Evolve access — the existing thread has no answers, but new posts after DevCon 6 may.
4. For the self-hosted clone decision: treat as design freedom the 12 undocumented items above; the documented contract is: human-configured run → automated multi-iteration candidate generation (model swaps + per-model prompt rewrites + architecture changes) → automatic evals + human expert pass/fail review in a generated side-by-side app → lineage-graphed "final proposal" with prompt/output diffs.
