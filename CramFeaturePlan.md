# Cram / Leitner Feature Plan

This note distills the long-running discussion in `DevelopmentGoals.md` into concrete features, implementation steps, and high-signal code sketches pulled directly from that conversation.

## Features To Add

1. **Stage-based Cram algorithm** – Introduce a five-stage Leitner workflow where correct answers advance the stage, incorrect answers drop the card back to stage 0, and cards that reach the memorized stage trigger synthetic SR updates at the end of the cram session. (DevelopmentGoals.md:920-1110)
2. **Configurable cram settings** – Extend the settings UI with controls for memorized stage index, demotion threshold, and dropdowns for the “default vs troublesome” synthetic review responses so power users can tune how cram outcomes map back to the main SRS. (DevelopmentGoals.md:900-919)
3. **Cram session state manager** – Add `CramSessionState` to track per-card stages, demotions, and determine the end-of-session synthetic response. The review sequencer should delegate all cram-mode bookkeeping to this helper. (DevelopmentGoals.md:920-1015)
4. **Sequencer integration & synthetic persistence** – Enhance `FlashcardReviewSequencer` with `startCramSession`, `processReview` overrides for cram mode, and `endCramSessionAndApplySyntheticReview` that replays synthetic ReviewResponses back through the existing scheduling pipeline. (DevelopmentGoals.md:1035-1109)
5. **CramStageBar modal UI** – Add the dedicated `CramStageBar` component (React) plus the CSS from the exploration so the flashcard modal displays each bucket, the card counts, and a highlight for the active stage. Hide it unless the cram/Leitner algorithm is active. (DevelopmentGoals.md:223-333, 1110-1128)
6. **Automated coverage** – Create Jest specs for the new cram session module plus integration-style tests that assert the sequencer persists different synthetic ReviewResponses for troublesome vs non-troublesome cards. (DevelopmentGoals.md:1129-1179)

## Development Steps

1. **Fork & scaffold settings**
   - Clone the upstream plugin, create your feature branch, and add new settings fields (stages, memorized stage index, demotion threshold, synthetic response dropdowns) alongside migrations/defaults.
   - Wire the new controls into the settings tab UI so they save and reload correctly (`plugin.saveSettings()`).
2. **Implement `CramSessionState`**
   - Create `src/gui/cram-session.ts` with the `CramCardState` map, `recordResponse`, and `getSyntheticResponse` logic.
   - Ensure you key cards by a stable identifier (`notePath + cardIdx`) so multiple cram sessions don’t collide.
3. **Augment the sequencer**
   - Inject the cram session helper into `FlashcardReviewSequencer`, tracking `cardsSeenInCram`.
   - In cram mode, bypass normal scheduling and only mutate the cram session + queue; on exit, loop through seen cards, derive synthetic responses, and persist schedules through the existing datastore path.
4. **Update the flashcard modal**
   - Add UI toggles/buttons for entering/exiting cram mode and render the `CramStageBar` (counts + highlight) above the question content. (DevelopmentGoals.md:223-333)
   - After every review button press, recompute the cram stage stats from the sequencer so the bar animates as cards move buckets. (DevelopmentGoals.md:334-397)
5. **Extend data storage if needed**
   - If stages must be serialized, expand the `<!--SR:...-->` parser/writer and frontmatter logic to store and recover the extra field without breaking legacy cards.
6. **Add automated tests**
   - Unit test `CramSessionState` (stage transitions, demotion counting, synthetic response selection).
   - Integration tests for the sequencer to confirm `endCramSessionAndApplySyntheticReview` calls the algorithm/datastore with the correct synthetic responses.
7. **Polish & ship**
   - Run `pnpm test` and `pnpm run build`, manually verify the modal UI, then copy `build/main.js`, `manifest.json`, and `styles.css` into a test vault to validate the full workflow.

## Useful Code Blocks From `DevelopmentGoals.md`

### Settings control example (DevelopmentGoals.md:906-918)

```ts
new Setting(containerEl)
  .setName("Cram demotion threshold")
  .setDesc("If a card is demoted at least this many times in a cram session, it is treated as troublesome.")
  .addText(text => text
    .setValue(this.plugin.settings.cramDemotionThreshold.toString())
    .onChange(async (value) => {
      const num = Number(value) || 0;
      this.plugin.settings.cramDemotionThreshold = Math.max(0, num);
      await this.plugin.saveSettings();
    }));
// Store dropdown values as "easy" | "good" | "hard" and convert them to ReviewResponse later.
```

### `CramSessionState` sketch (DevelopmentGoals.md:926-1015)

```ts
import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { Card } from "src/card";
import { SRSettings } from "src/settings";

interface CramCardState {
  stage: number;
  demotions: number;
}

export class CramSessionState {
  private readonly perCard: Map<string, CramCardState> = new Map();

  constructor(private readonly settings: SRSettings) {}

  private keyFor(card: Card): string {
    return `${card.question.notePath}::${card.cardIdx}`;
  }

  recordResponse(card: Card, response: ReviewResponse): void {
    const state = this.getOrInit(card);
    const prevStage = state.stage;

    switch (response) {
      case ReviewResponse.Again:
        state.stage = 0;
        break;
      case ReviewResponse.Hard:
        state.stage = Math.max(0, prevStage - 1);
        break;
      case ReviewResponse.Good:
      case ReviewResponse.Easy:
        state.stage = Math.min(this.settings.cramMemorizedStageIndex, prevStage + 1);
        break;
    }

    if (prevStage > 0 && state.stage === 0) {
      state.demotions += 1;
    }
  }

  getSyntheticResponse(card: Card): ReviewResponse | null {
    const state = this.perCard.get(this.keyFor(card));
    if (!state || state.stage < this.settings.cramMemorizedStageIndex) return null;

    const choice =
      state.demotions >= this.settings.cramDemotionThreshold
        ? this.settings.cramSyntheticTroublesomeResponse
        : this.settings.cramSyntheticDefaultResponse;

    switch (choice) {
      case "easy":
        return ReviewResponse.Easy;
      case "good":
        return ReviewResponse.Good;
      case "hard":
        return ReviewResponse.Hard;
      default:
        return ReviewResponse.Good;
    }
  }

  private getOrInit(card: Card): CramCardState {
    const key = this.keyFor(card);
    let state = this.perCard.get(key);
    if (!state) {
      state = { stage: 0, demotions: 0 };
      this.perCard.set(key, state);
    }
    return state;
  }
}
```

### Sequencer hook-up outline (DevelopmentGoals.md:1064-1107)

```ts
import { CramSessionState } from "src/gui/cram-session";

export class FlashcardReviewSequencer implements IFlashcardReviewSequencer {
  private cramSession: CramSessionState | null = null;
  private cardsSeenInCram: Set<Card> = new Set();

  startCramSession(settings: SRSettings): void {
    this.cramSession = new CramSessionState(settings);
    this.cardsSeenInCram.clear();
  }

  endCramSessionAndApplySyntheticReview(): void {
    if (!this.cramSession) return;

    for (const card of this.cardsSeenInCram) {
      const synthetic = this.cramSession.getSyntheticResponse(card);
      if (synthetic == null) continue;

      const schedule = this.determineCardSchedule(synthetic, card);
      this.dataStore.updateCardSchedule(card, schedule);
    }

    this.cramSession = null;
    this.cardsSeenInCram.clear();
  }

  async processReview(response: ReviewResponse): Promise<void> {
    const card = this.currentCard;
    if (!card) return;

    if (this.cramSession) {
      this.cardsSeenInCram.add(card);
      this.cramSession.recordResponse(card, response);
      this.moveToNextCardInCramQueue(response);
      return;
    }

    // Existing review-mode scheduling …
  }
}
```

### `CramStageBar` component & CSS (DevelopmentGoals.md:233-333)

```tsx
import React from "react";
import { CramStageStats } from "src/cram-stage-stats";

interface CramStageBarProps {
  stats: CramStageStats;
  labels: string[];
}

export const CramStageBar: React.FC<CramStageBarProps> = ({ stats, labels }) => {
  const { counts, currentStage } = stats;

  return (
    <div className="sr-cram-bar">
      {counts.map((count, idx) => {
        const isCurrent = idx === currentStage;
        const label = labels[idx] ?? `Level ${idx + 1}`;

        return (
          <div
            key={idx}
            className={`sr-cram-bar__segment ${isCurrent ? "is-current" : ""}`}
          >
            <div className="sr-cram-bar__label">{label}</div>
            <div className="sr-cram-bar__count">{count}</div>
          </div>
        );
      })}
    </div>
  );
};
```

```css
.sr-cram-bar {
  display: flex;
  margin-bottom: 0.75rem;
  border-radius: 6px;
  overflow: hidden;
  font-size: 0.85rem;
}

.sr-cram-bar__segment {
  flex: 1 1 0;
  padding: 0.35rem 0.5rem;
  text-align: center;
  background: var(--background-secondary);
  color: var(--text-muted);
  position: relative;
}

.sr-cram-bar__segment::after {
  content: "";
  position: absolute;
  top: 0;
  right: -12px;
  width: 24px;
  height: 100%;
  transform: skewX(-25deg);
  background: inherit;
  z-index: 1;
}

.sr-cram-bar__segment:last-child::after {
  display: none;
}

.sr-cram-bar__label {
  font-weight: 500;
}

.sr-cram-bar__count {
  margin-top: 0.15rem;
  font-size: 0.95em;
}

.sr-cram-bar__segment.is-current {
  background: var(--interactive-accent);
  color: var(--text-on-accent, #fff);
  font-weight: 600;
}

.sr-cram-bar__segment:not(.is-current):hover {
  background: rgba(255, 255, 255, 0.06);
}
```

These snippets capture the intended behavior from the design conversation and can be copied into the codebase (with project-specific tweaks) to accelerate implementation.
