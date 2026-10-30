# Lineups from Description Text — Design

Status: approved in conversation on 2026-10-30, awaiting spec review.

## Why

Events have a structured `lineup` field since `2ee6b77`. The Berghain/Kantine and Dunckerclub adapters fill it, and the one-off backfill moved Markdown lists. On 2026-10-30, 22 of 51 upcoming events still had none. All but two came from the Urban Spree, Slaughterhouse, Badehaus and ACUD feeds, and almost all of them name their acts in free text. Typical forms are "Bragolin(live) [Young And Cold]", "on decks: ▷ Uwe Marx ▷ Marko König" and "djs / terrorwave / karocky / + special guest: paura diamante (eisengrau)".

This is phase 2 of the lineup work: an LLM step reads the lineup out of the description text.

Success means:
- Feed events from these sources show a lineup section without anyone typing it.
- No invented names appear on the site.
- An editor can fill an event's lineup from its description with one click.

## Decisions (from the conversation)

- **Description unchanged.** The step only fills `lineup`; the description text stays as it is, including the acts. Keeping the description in sync with the source matters more than avoiding redundancy.
- **Scope:**
  - Feed events, automatically during ingest.
  - A "Read from description" button in the event editor.
  - No one-off run over existing scout or hand-made events.
- **Release:** accepted, still-synced feed events take the lineup through the normal sync, with no human review. The name check below is the safeguard.
- **Approach:** a dedicated lineup step with its own prompt, schema and eval (approach A). The flyer/text extraction prompt stays unchanged, and so does its flat `lineup: string[]`.

Rejected alternatives:
- Extending the shared extraction prompt (B). Every prompt change would also hit the flyer import and its eval. The feeds would also need `extract_from_text`, which touches times, categories and links that the pages already state correctly.
- Reusing the flat name list from `extract_from_text` (C). It has no live flags, notes or groups, and works only for sources that already run text extraction.

## 1. The lineup step

**`packages/api/src/extract/lineup.ts`:**
- **`LineupReader.read(text: string): Promise<Lineup>`.** It sends the text to `callScaleway` with its own system prompt and a JSON schema for groups → acts. Each act has `name`, `time`, `live` and `note`.
  - It uses the existing Scaleway access and model (`TEXT_MODEL || VISION_MODEL`).
  - It throws `ExtractionError` with the existing kinds: `unavailable`, `provider`, `timeout` and `invalid_output`.
- **`lineupReading` holder.** It has `reader`, `setReader()` and `reset()`, like `textExtraction`. Tests install stubs, and `isTestRun` never calls the provider.

**Prompt rules:**
- One act per performer, DJ or band. B2B pairs stay one act ("A b2b B").
- `live` is true when the text marks the act as live ("(live)", "live:" section, a band in a concert listing).
- `note` holds a label, crew, collective or origin written next to the name ("Young And Cold", "eisengrau", "FR").
- Groups only when the text names them: floors, or sections such as "Live" and "DJs". Otherwise there is one unnamed group.
- `time` only when a set time is written next to the act.
- These never count as acts:
  - organisers and presenters ("aufnahme + wiedergabe presents")
  - the event or series name
  - resident-crew labels such as "Factory DJs"
  - labels on their own
  - names that appear only in prose about history or influences
- No lineup in the text → an empty list.

**Name check (`checkAgainstText(lineup, text): Lineup`, pure function):**
- Comparison is case-insensitive. Runs of whitespace collapse to one space, and Markdown/formatting characters (`*`, `_`, `[`, `]`, `▷`, `#`) are ignored on both sides.
- An act is dropped when its name does not occur in the text.
- A note that does not occur becomes `null`; the act stays.
- A group name that does not occur becomes `null`.
- The result goes through `sanitizeLineup`, which also drops groups left empty.

The ingest path and the endpoint both get the checked result. They never see the raw model output.

## 2. Ingest

**Source config:**
- New `lineup_from_text: z.boolean().default(false)` in `ingestSourceConfigSchema`.
- It is set with the existing `ingest-set-config`.

**When it reads,** in `ingestEvent`, next to `extractTimes`. All of these must hold:
- the source sets `lineup_from_text`,
- the description is non-empty,
- the adapter delivered no lineup of its own (`ev.lineup` empty),
- the item is not settled (rejected or detached), the same rule `extractTimes` uses.

**Marker:**
- The draft gets `lineup_from_text: z.boolean().default(false)` in `ingestDraftSchema`. It is set to `true` when the step ran successfully, even with an empty result.
- An item whose hash is unchanged is still skipped, unless all of these hold: the source sets `lineup_from_text`, the stored draft's `lineup_from_text` is false, the feed event has no adapter lineup, and the item is not settled.
- So the first run after a source is switched on reads every stored, unsettled item once, even with an unchanged hash. Rejected and detached items are never re-read for it, and they never get the marker.

**Failure:**
- A failed read (`provider`, `timeout` or `invalid_output`) leaves `lineup` empty and the marker `false`.
- It also sets `contentHash` to null and skips the sync, exactly like a failed `extractTimes`. The next run retries.
- `unavailable` fails the source with a clear `lastError`: "Source sets lineup_from_text, but lineup reading is unavailable: …".

**Sync:**
- No change. `lineup` is already a synced field, so accepted, attached events take it.
- A failed read never syncs, so it cannot wipe a lineup.

**Fit scoring side effect:**
- `subjectOf` already puts act names in front of the description when there is a lineup.
- Pending items of these four sources get a new fingerprint and are scored once more. That is a few dozen calls, accepted.

## 3. Editor button

**Endpoint `POST /api/v1/events/extract-lineup`:**
- Body `{ text: string }`, 1 to 10,000 characters. Response `{ lineup: Lineup }`.
- `requireAuth` and the same rate-limit bucket and daily limit as `POST /events/extract`, since both cost model calls.
- Errors are mapped like the image route:
  - `unavailable` → 503
  - `timeout` → 504
  - `provider` → 502
  - `invalid_output` → 422
  - an empty checked lineup → 422 `nothing_extracted` ("No lineup found in the description")
- Nothing is stored.

**`LineupEditor`:**
- New prop `description: string`.
- Button "Read from description" next to "Paste list". It is disabled while the description is blank or a request is running.
- The result is converted with `toLineupRows`:
  - an empty editor is replaced by it,
  - otherwise it is appended below, like "Paste list".
- A loading label shows while it runs, and a short error line under the button when it fails.
- Saving the form stores the lineup as today. The description field is never touched.

## 4. Eval

**`pnpm --filter @open-event-db/api eval:lineup [--models a,b]`.** It runs every case against each model and prints per model:
- **act recall:** expected acts found, matched by name after the name check, same normalisation
- **act precision:** returned acts that are expected
- **live accuracy:** among matched acts
- failures

It writes a results JSON next to the cases.

**Cases:** `packages/api/src/extract/lineup-eval/cases.json`, about 25. They are taken from the current prod descriptions of the four sources, next to the existing venue fixtures. Each case has the text and the expected lineup.

Expected lineups are drafted by Claude and checked by the user before the eval counts. The set includes:
- marked live acts with labels (Urban Spree)
- "on decks:" lists and "djs / + special guest:" (Slaughterhouse)
- resident labels that are not acts ("Factory DJs")
- texts with acts only in prose, and texts with no lineup at all

**Release bar:** precision ≥ 95% and recall ≥ 85% on the chosen model. Below that, the prompt is improved before anything is deployed. The results are shown to the user before the deploy.

## 5. Rollout (DEPLOY.md gets a section)

1. Deploy.
2. `ingest-set-config <slug> --config '{"lineup_from_text":true}'` for `urbanspree`, `slaughterhouse`, `badehaus` and `acud`.
3. An ingest run of all sources from the laptop (one lineup read per stored, unsettled item of these sources), then `ingest:score` until `scored: 0`.
4. Check: how many of the upcoming feed events without a lineup have one now, plus spot checks on the event pages.

## Testing

- Unit tests:
  - `checkAgainstText`: dropped acts, cleared notes and group names, Markdown and `▷` in the text, case and whitespace
  - the response parsing of `LineupReader`, with a stubbed provider
- Ingest tests with a stub reader:
  - reads only when switched on, without an adapter lineup and unsettled
  - the marker forces exactly one re-read on an unchanged hash
  - failure → no sync, hash null, retried next run
  - `unavailable` fails the source
  - an accepted, attached event takes the lineup
  - the description stays byte-identical
- Route tests: auth, limit shared with `/events/extract`, error mapping, empty result → 422.
- Web: `LineupEditor` replace-vs-append, plus browser verification of the button.

## Out of scope

- Flyer import with structured lineups.
- A one-off run over scout or hand-made events.
- Removing acts from the description.
- Per-act links or profiles.
