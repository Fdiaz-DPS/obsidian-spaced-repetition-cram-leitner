# Cram Mode Development Log

This log captures the work performed since commit `bac2b67` while building a Leitner-style “Cram” workflow on top of the Spaced Repetition plugin.

## High-level goals

1. Recreate a five-stage Leitner (“Cram”) algorithm inside Obsidian so cards advance upward on success and drop downward on mistakes.
2. Provide UI affordances (stage bar, cram buttons) that match the behavior in the reference “Cram” app.
3. Ensure cram sessions can feed their results back into the standard SM2/OSR scheduling pipeline via synthetic responses.

## Completed milestones

### 1. Cram settings & plan
- Documented the original design ideas in `DevelopmentGoals.md`, including UI mockups and algorithm expectations.
- Created `CramFeaturePlan.md` summarizing required features, implementation steps, and useful code snippets.
- Extended `SRSettings` and defaults with cram-specific knobs: number of stages, memorized stage index, demotion threshold, and synthetic response choices.
- Added a “Cram / Leitner” section to the settings modal so these options can be configured without editing JSON.

### 2. Session state + logic
- Added `src/cram-session-state.ts` to track per-card stage/demotion data and compute synthetic responses (default vs troublesome) for persistence back to SM2/OSR.
- Reworked `FlashcardReviewSequencer` to support two review modes. In cram mode we now:
  - Clone/filter the deck tree per deck selection and build stage queues.
  - Skip the destructive deck iterator and instead pull cards from the lowest non-empty stage.
  - Update per-card stages according to the Leitner rules (easy/good promote by one, hard/again demote by one).
  - Track which cards were seen (`cramCardsSeen`) so synthetic responses are only applied once at session end.
  - Rebuild the cram stage bar stats after every review.
- Added synthetic replay via `finaliseCramSession`, writing new schedules for each card before handing control back to normal review mode.

### 3. UI & UX updates
- Added `CramStageBar` (React + CSS) to the flashcard modal so each bucket shows its card count and highlights the current stage.
- Replaced the legacy “Cram” command flow with an explicit “Cram Deck” button alongside the edit/reset/info/skip buttons. Clicking it launches a deck-specific cram session instantly (no intermediate deck picker).
- When leaving cram (back arrow), the plugin now closes the cram modal, finalizes synthetic responses, and reopens the standard deck selection modal so users land in a consistent place.
- Added Stage bar CSS to `styles.css` (chevron-style segments, highlight, hover state) to match the target mockup.

### 4. Deck filtering & seeding
- Implemented topic-path based filtering so selecting a parent deck includes its entire subtree. This involved checking whether each card’s topic path is a descendant of the chosen deck’s path.
- Seeded every unique card in the filtered deck into Stage 1 so the Stage bar reflects the full deck count before reviews begin.

## Known issues / outstanding work

### 1. First card missing in cram view
- **Symptom**: Stage 1 count appears correct, but the very first card in the deck never surfaces; the UI starts on card 2.
- **Likely cause**: `advanceCramCard` or initial seeding may be skipping the first entry (e.g., due to iterator interaction or stage queue shifting logic). Need to inspect queue initialization and the first call to `advanceCramCard`.
- **Next steps**: Debug `initialiseCramQueues` and `advanceCramCard` to ensure the first card is enqueued and returned. Write a quick unit test if possible.

### 2. Synthetic review overwriting all cards
- **Symptom**: When finalizing a cram session where only one card exceeded the demotion threshold, every card gets the same due date/ease in the note (`<!--SR:...-->`), indicating the synthetic response selection isn’t per-card.
- **Possible root causes**:
  - `CramSessionState.getSyntheticResponse` might be using shared state (e.g., a staged card’s demotion count gets overwritten before finalization).
  - `finaliseCramSession` may be reusing the last computed schedule instead of the per-card schedule.
- **Next steps**: Instrument `cramSession.getSyntheticResponse` and `determineCardSchedule` inside `finaliseCramSession` to confirm the right response/schedule is produced for each card. Ensure each card’s `scheduleInfo` is set individually before writing via `questionWriteSchedule`.

### 3. Stage progression polish
- Current logic honors “adjacent stage only” moves, but we still need to verify two UX points:
  1. Stage counts update when cards move between stages during a review (no stale data).
  2. Demoted cards re-enter the prior stage queue without interrupting the user’s current stage until all cards in that stage are completed.
- **Next steps**: Add logging or a simple UI indicator to confirm when stage queues empty. Double-check the stage bar against actual queue contents for non-trivial decks.

## Suggested next actions

1. **Fix first-card omission**:
   - Reproduce with a deck whose first card never shows up (per report). Step through `initialiseCramQueues` and `advanceCramCard` to find where the card is dropped.
   - Consider writing a temporary harness/test that asserts `cramStageQueues[0].length === totalCards` before first review and that `cramCurrentCard` is non-null immediately.

2. **Patch synthetic response persistence**:
   - Add logging/testing to `finaliseCramSession` to ensure each card’s synthetic response is independent. Confirm demotion thresholds apply per card, not globally.
   - Verify that the `!--SR:...-->` comments in the source note differ based on individual response history.

3. **QA stage bar + UI**:
   - Manually verify the Stage bar counts with decks that have multiple tags and demotions.
   - Confirm the “Cram Deck” button works for parent and leaf decks alike after the filtering changes.

Once these issues are resolved, we can revisit the plan for storing explicit stage info in schedules (if we want to persist stage between sessions) and consider adding tests for the stage queues and synthetic replay.
