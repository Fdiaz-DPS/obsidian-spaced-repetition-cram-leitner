
You said:
I need help figuring out what is possible and how to proceed. I have experience with this app called cram. It is a flashcard app that when studying, if a card is answered correct it moves on to the next stage or bucket, if a card is answered incorrectly it moves all the way down to stage 0. there are 5 stages. I am trying to get this same behavior from either obsidian, through plugins like spaced repetition or from the anki app. Is it possible to get this cram functionality from these other apps? Be sure to search for the most up to date information to understand the apps and what I am trying to achieve.
ChatGPT said:

Thought for 1m 30s


First, what you’re trying to reproduce
Cram is basically using a 5-stage Leitner system:

All cards start in stage 0.

Correct → move up one stage (0→1→2→3→4→5).

Incorrect → drop straight back to stage 0.

Each stage gets reviewed less often than the one before.


You said:

I like this plugin in Obsidian even though it doesn't have that functionality. Can you look over this repo, understand the codebase, and come up with a plan that would allow me to fork the repo, edit it into my own version, and through UI enhancements and new features, introduce the ability to have this "Cram" functionality?
ChatGPT said:

Thought for 3m 25s


stages = 5 (0–4 + Memorized)


Per-card state:

stage (0–4 + Memorized)

Review logic:

On correct: stage = min(stage + 1, maxStage)

On incorrect: stage = 0


Optional:

Only two buttons: Again and Good (no “Easy”), matching how Cram works for you.

Everything below is about wiring that into this plugin.

2. How the current plugin is structured (relevant bits)
From the docs and code you can see, the important pieces are: 
Stephen Mwangi
+2
GitHub
+2

Algorithms are pluggable

There is an ISrsAlgorithm interface and at least one concrete implementation, SrsAlgorithmOsr, which implements SM-2-OSR. 
GitHub

Methods like cardGetNewSchedule, cardCalcUpdatedSchedule, noteCalcNewSchedule etc. take a ReviewResponse (hard/good/easy) and return a RepItemScheduleInfo (interval, ease, due date, etc.).

Scheduling metadata

For cards: stored in HTML comments like
<!--SR:!2024-08-16,51,230--> → dueDate, interval, ease. 
Stephen Mwangi

For notes: stored in YAML frontmatter (sr-due, sr-interval, sr-ease). 
Stephen Mwangi

Commands & modes

Docs list flashcard commands including reviewing & cramming; i.e. there’s already a “cram” mode command, but it currently just affects selection of cards, not the actual scheduling algorithm. 
Stephen Mwangi
+1

Settings

There’s a “Repetition Algorithms” section in the docs: SM-2-OSR is implemented; FSRS and “User defined intervals” are planned, which confirms the code expects multiple algorithms. 
Stephen Mwangi

This is enough to hook in a new algorithm without touching most of the plugin.


You said:
reference image (./referenceImages/stagesIdealUI.png)
Great, I would also like to add this to the modal that is up while I am reviewing flashcards, the idea is that it shows each bucket or stage and the number of cards in it, and which stage you are currently studying is highlighted in some way. This (./referenceImages/currentLegacyUI.png) screenshot is of the current obsidian plugin modal and what the current UI looks like where I would like this to be
ChatGPT said:

Thought for 2m 2s
Nice, that bar fits perfectly with a Leitner/Cram workflow.

I’ll assume you’re going ahead with a “Cram / Leitner” algorithm in the plugin (as we discussed before), and now you want a visual stage bar inside the flashcard modal that:

Shows each bucket (1–4 + Memorized)

Shows the card count per bucket

Highlights the bucket of the current card (the one you’re reviewing now)

Below is a concrete plan plus example code you can adapt.

0. Quick recap: how we’ll represent stages
To make the stage bar work, the algorithm has to expose a “stage” for each card.

Recommended representation (cleaner than overloading ease):

Add a stage: number to RepItemScheduleInfo or a subclass used by your Cram algorithm.

Store stage in the scheduling comment/frontmatter as an extra field, e.g.:

<!-- Existing: SR:!2025-03-20,7,250 -->
<!-- New in your fork: SR:!2025-03-20,7,250,3 -->
That means (due date, interval, ease, stage = 3). You’ll have to widen the parsing/writing logic in the data-store (DataStoreAlgorithm + note schedule helpers) to support an optional 4th field; older cards can default to stage 0. 
GitHub

In your CramLeitnerAlgorithm you then:

Read schedule.stage (with default 0)

After a review:

Wrong → stage = 0

Right → stage = Math.min(stage + 1, maxStage)

That gives us exactly the “Level 1, 2, 3, 4, Memorized” stage concept you’re used to.

1. Compute stage stats for the current session
We want to know, for the deck(s) currently being reviewed:

How many cards are in each stage (0–4).

What stage the current card is in.

1.1. Where to calculate this?
Best place: core / sequencer layer, not inside the React component.

You already have:

OsrCore which owns the deck tree, histograms, etc. 
GitHub

FlashcardReviewSequencer which manages the current queue of cards for this review session. 
GitHub

Add a small helper in FlashcardReviewSequencer (or in OsrCore and expose it) to compute a “stage histogram” for the cards in the current session.

Example shape:

export interface CramStageStats {
  counts: number[];     // length = numStages, e.g. [4, 3, 0, 0, 0]
  currentStage: number; // stage index for the card currently shown
}
Pseudocode (inside FlashcardReviewSequencer):

import { CramStageStats } from "./cram-stage-stats";

getCramStageStats(numStages: number): CramStageStats {
  const counts = Array(numStages).fill(0);

  // 1. Count all cards in the session
  this.reviewQueue.forEach(card => {
    const stage = this.getCardStage(card);
    if (stage >= 0 && stage < numStages) {
      counts[stage]++;
    }
  });

  // 2. Determine current card stage
  const currentCard = this.getCurrentCard();
  const currentStage = currentCard ? this.getCardStage(currentCard) : 0;

  return { counts, currentStage };
}

private getCardStage(card: Card): number {
  const schedule = card.scheduleInfo;
  // in your Cram algorithm, make sure a stage is always present
  return schedule.stage ?? 0;
}
You’ll need to hook schedule.stage into the card object where schedule info is stored (the plugin’s Card class). 
GitHub

1.2. Only compute stats in Cram mode
Guard the logic with your algorithm setting:

if (this.settings.algorithm === AlgorithmType.CramLeitner) {
  return this.reviewSequencer.getCramStageStats(this.settings.cramStages);
}
In other modes, just return null and skip rendering the bar.

2. Thread stats into the Flashcard modal
The flashcard UI is rendered by FlashcardModal in src/gui/FlashcardModal.tsx (your fork still has this component, even though I can’t fetch the raw file here). 
GitHub

2.1. Extend modal props
Wherever FlashcardModal is constructed (often in main.ts or another GUI controller), extend its props:

interface FlashcardModalProps {
  // existing props...
  reviewSequencer: FlashcardReviewSequencer;
  settings: SRSettings;

  // new:
  cramStageStats?: CramStageStats;
}
When creating the modal:

const cramStageStats = this.settings.algorithm === AlgorithmType.CramLeitner
  ? this._flashcardReviewSequencer.getCramStageStats(this.settings.cramStages)
  : null;

new FlashcardModal(this.app, {
  // existing props...
  reviewSequencer: this._flashcardReviewSequencer,
  settings: this.settings,
  cramStageStats,
});
(Exact constructor signature may differ; you’ll see it in FlashcardModal.tsx.)

3. Implement the bar component
Inside FlashcardModal.tsx, create a small presentational component.

3.1. JSX
Somewhere near the top of the modal’s body (just under the deck header where your screenshot shows), render this:

import React from "react";
// import types
import { CramStageStats } from "src/cram-stage-stats";

interface CramStageBarProps {
  stats: CramStageStats;
  labels: string[];          // e.g. ["Level 1", "2", "3", "4", "Memorized"]
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
And in your main modal component’s render method:

if (this.props.cramStageStats) {
  const labels = ["Level 1", "2", "3", "4", "Memorized"];
  content.push(
    <CramStageBar
      key="cram-bar"
      stats={this.props.cramStageStats}
      labels={labels}
    />
  );
}
Place that above the question text so it matches your Cram screenshot.

3.2. CSS (in styles.css)
Adapt this to your theme; this is just a starting point:

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

/* chevron effect between segments */
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

/* Current stage highlight (blue-ish to mimic your Cram screenshot) */
.sr-cram-bar__segment.is-current {
  background: var(--interactive-accent);
  color: var(--text-on-accent, #fff);
  font-weight: 600;
}

/* Optional: subtle hover */
.sr-cram-bar__segment:not(.is-current):hover {
  background: rgba(255, 255, 255, 0.06);
}
The ::after chevron trick gets you close to that arrow chain you showed. You can tweak spacing and colors to better match your theme.

4. Keeping the bar in sync as you review
Every time you rate a card (Again / Good / Easy), you:

The algorithm computes a new schedule with updated stage.

The card is moved in the queue.

The modal asks the sequencer for the next card.

You just need to recompute cramStageStats on each review. Where you already handle a review result (in the modal’s button handlers):

onReview(response: ReviewResponse) {
  this.props.reviewSequencer.handleResponse(response);

  if (this.props.settings.algorithm === AlgorithmType.CramLeitner) {
    const stats = this.props.reviewSequencer.getCramStageStats(
      this.props.settings.cramStages
    );
    this.setState({ cramStageStats: stats });
  }

  this.loadNextCard();
}
Or, if you’re not using React state but class fields, just update the prop-like field and re-render.

5. UX notes / behaviour details
A few choices you get to make:

What is “Memorized”?

You can treat the highest stage (e.g. 4) as “Memorized”.

When a card reaches max stage, it still gets scheduled in the future (interval maybe very large), but we keep counting it in that bucket.

Cards not in the current session

For the bar you showed, it’s normal to count only cards in this deck/session, not all cards in the vault. That keeps numbers meaningful.

What if some stages are empty?

The bar will show 0 – that’s useful feedback (“no cards have reached stage 3 yet”).

Other algorithms

If algorithm !== CramLeitner, hide the bar completely to avoid confusion.

6. Summary of steps you can follow
Fork & set up the repo (if you haven’t already).

Implement CramLeitnerAlgorithm:

Add stage to schedule info.

Store stage in the schedule comments/frontmatter.

On review, update stage + dueDate based on your 5 buckets.

In FlashcardReviewSequencer, add a method to compute CramStageStats (counts + current stage).

Pass cramStageStats into FlashcardModal when using Cram algorithm.

Implement CramStageBar React component + CSS; render it at top of the review modal.

After each button press, recompute stats and re-render so the bar animates as cards move buckets.


You said:
Is there a way that after a cram session the cards are put back into the regular spaced repetition cadence of any of the other cards? For example let's say my standard algorithm for spaced rep is Sm2Osr and for a particular deck I want to cram, or in the middle of a review session I want to select the deck that a card is from and cram that deck, is it possible to do this, then at the end of that session put the cards back into the rotation?
ChatGPT said:

Thought for 2m 9s
What we will do from now on isCram as an overlay on top of SM2-OSR (what you’re asking for)
This is what you described: “Use Cram behaviour for a while, then let cards continue their normal spaced-rep flow.”

You can do this by separating session state from long-term schedule:

Leave the deck’s main algorithm as SM2-OSR.

When you start a “Cram” session:

Build a session queue that includes all cards in that deck (like the plugin’s cram does today).
Stephen Mwangi

For this session only, track a stage for each card in memory (0–4).

During the cram session:

Your stage bar UI and re-ordering of cards is driven by the in-memory stages:

Correct → stage++

Incorrect → stage = 0

Separately, for long-term scheduling you can choose:

Update SM2-OSR schedule as normal (call the existing SM2 algorithm when the user presses Hard/Good/Easy), or

Don’t touch the stored schedule at all (treat cram as pure extra practice that doesn’t move due dates).

At the end of the cram session:

The in-memory stage map is thrown away.

The cards’ scheduling comments remain whatever SM2-OSR left them as (or unchanged if you chose not to update them).

Next day, they’re just part of the normal “Review due cards” like any others.

From your description (“put the cards back into the regular spaced repetition cadence”), Option B is exactly what you want:

SM2-OSR stays the “source of truth” for when cards are due.

The Cram/Leitner stages and that nice progress bar are session-only tools for intense short-term practice.

After you close the modal, everything is back to normal – no weird migrations.

Adding “Cram the deck of this card”
You can also add a quality-of-life command:

Spaced Repetition: Cram deck of current card

Implementation sketch:

When a card is shown, you already know its “deck path” (from its tag or folder). Use that to compute a TopicPath/deck name.
GitHub

Add a new command in the plugin’s command registration that:

Grabs the deck path from the currently shown card in FlashcardReviewSequencer.

Starts a new Cram session with that deck as the root (reusing the existing cram logic you already have).

If you’re in a cram session already, you could either:

restart the cram queue using that deck, or

open a second modal dedicated to that deck.


You said:
I would like to outline in more detail, where after a cram session all cards that made it to memorize act as they they were correct once in the standard algorithm. The right wrong hard easy answers directly should not adjust the spaced repetition, but the conclusion of the cram session in it's entirety should serve as a single advance / easy button push for each card that made it to the memorized stage. Please pull from the github to get a step by step approach to add this functionality and test/deploy my own obsidian addin from this fork
ChatGPT said:

Thought for 3m 26s
Short version: yes, you can do exactly what you described with a fork:

During a Cram session, answers only move cards between your 5 stages.

SM-2-OSR schedules stay frozen during the session.

When you end the session, every card that reached “Memorized” gets a single synthetic “Easy” review applied to its normal schedule; other cards are left untouched.

After that, everything continues as normal SM-2-OSR reviews.

Below is a step-by-step plan tied to the actual structure of the repo and ending with how to build/install your fork.

1. Fork + local setup
Fork st3v3nmw/obsidian-spaced-repetition on GitHub.

Clone your fork locally:

git clone https://github.com/<your-username>/obsidian-spaced-repetition.git
cd obsidian-spaced-repetition
Install deps (the project uses the Obsidian sample-plugin stack with esbuild)

# if you use pnpm
pnpm install

# or with npm/yarn if you prefer, depending on package.json
npm install
You’ll later build with something like:

pnpm build   # or: npm run build
which produces main.js + manifest.json + styles.css for Obsidian.

2. Understand the key pieces you’ll hook into
You’ve already seen some of these, but here’s how they fit together:

SrsAlgorithmOsr – implements the SM-2-OSR algorithm for cards & notes.

cardGetNewSchedule, cardCalcUpdatedSchedule do the actual “Easy/Good/Hard” math.

OsrCore – central “brain” that maintains deck trees, due-date histograms, and review queues.

FlashcardReviewSequencer – manages which card you’re on, modes like review vs cram, etc.

flashcard-modal.tsx in src – the React UI for the review modal (recent UI work/skip button touches this file).

DataStoreAlgorithm – reads/writes the <!--SR:!...--> schedule comments in your markdown.

You’re going to:

Add a CramOverlaySession that tracks stages and memorized status in memory only.

Change cram mode so button presses don’t call SM-2-OSR immediately.

On session end, replay one synthetic Easy for each memorized card via the same algorithm the plugin already uses.

3. Add an in-memory “Cram overlay” model
Create a new file, e.g. src/cram-overlay-session.ts:

import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { Card } from "src/card";

export interface CramOverlayConfig {
  stages: number;              // e.g. 5 (0..4, with 4 = Memorized)
  memorizedStageIndex: number; // usually stages - 1
}

export interface CramOverlayStateForCard {
  stage: number;
  // you can add more later (e.g. wrongCount, lastSeenAt, etc.)
}

export class CramOverlaySession {
  private readonly config: CramOverlayConfig;
  private readonly perCard: Map<string, CramOverlayStateForCard> = new Map();

  constructor(config: CramOverlayConfig) {
    this.config = config;
  }

  /** Determine a stable key for a card (note path + question index + card type). */
  getCardKey(card: Card): string {
    return `${card.notePath}::${card.questionId}::${card.cardType}`;
  }

  getStage(card: Card): number {
    const key = this.getCardKey(card);
    const state = this.perCard.get(key);
    return state?.stage ?? 0;
  }

  handleResponse(card: Card, response: ReviewResponse): void {
    const key = this.getCardKey(card);
    const current = this.perCard.get(key) ?? { stage: 0 };

    if (response === ReviewResponse.Again || response === ReviewResponse.Hard) {
      current.stage = 0;
    } else {
      current.stage = Math.min(
        current.stage + 1,
        this.config.memorizedStageIndex
      );
    }

    this.perCard.set(key, current);
  }

  /** All cards that ended the session in Memorized. */
  getMemorizedCardKeys(): string[] {
    const keys: string[] = [];
    for (const [key, state] of this.perCard.entries()) {
      if (state.stage >= this.config.memorizedStageIndex) {
        keys.push(key);
      }
    }
    return keys;
  }
}
You can expand this later to support your stage-bar UI (we already sketched that earlier).

4. Wire the overlay into FlashcardReviewSequencer
In src/flashcard-review-sequencer.ts (or FlashcardReviewSequencer.ts depending on the current casing), there’s a FlashcardReviewMode enum and the sequencer class that handles review/cram flows.

4.1. Add overlay fields
Inside the sequencer class:

import { CramOverlaySession, CramOverlayConfig } from "src/cram-overlay-session";
// …

export class FlashcardReviewSequencer {
  // existing fields...
  private cramOverlay: CramOverlaySession | null = null;

  startCramOverlay(config: CramOverlayConfig) {
    this.cramOverlay = new CramOverlaySession(config);
    // existing cram-queue building logic stays the same
  }

  endCramOverlay(): CramOverlaySession | null {
    const session = this.cramOverlay;
    this.cramOverlay = null;
    return session;
  }

  isCramOverlayActive(): boolean {
    return this.cramOverlay != null;
  }

  getOverlaySession(): CramOverlaySession | null {
    return this.cramOverlay;
  }
}
4.2. Intercept review responses in cram mode
Find the method the modal calls when the user presses Hard/Good/Easy; it will be something like reviewCurrentCard(response: ReviewResponse) or similar inside the sequencer.

Modify it roughly like this:

reviewCurrentCard(response: ReviewResponse) {
  const card = this.currentCard;

  if (this.mode === FlashcardReviewMode.Cram && this.cramOverlay) {
    // 1. Update in-session stage only
    this.cramOverlay.handleResponse(card, response);

    // 2. Reorder your cram queue based on stage if you want (optional)
    this.reorderQueueForCramOverlay(card);

    // 3. DO NOT call the SrsAlgorithm / data-store here
    //    i.e. skip any calls that would write schedules to notes
  } else {
    // Original behavior for Review mode (and regular cram if overlay is disabled)
    this.applyNormalScheduledReview(card, response);
  }
}
Where applyNormalScheduledReview is extracted from the existing logic that currently runs for all modes – that’s the bit that calls into OsrCore, SrsAlgorithmOsr.cardCalcUpdatedSchedule, and DataStoreAlgorithm to persist schedule info.

You can keep true cram mode available as an option if you want; here I’m assuming you convert the existing “cram this deck” command to use Cram overlay instead.

5. Trigger the overlay from the UI
In src/flashcard-modal.tsx (lower-case name in recent commits) the modal is created and wired to the sequencer; the skip-button commit shows this file is where review keyboard handling lives.

5.1. Starting a cram overlay
Where the plugin currently starts a cram session (e.g. in response to a command “Cram deck”), change the call to:

this.reviewSequencer.startCramOverlay({
  stages: 5,
  memorizedStageIndex: 4,
});
this.mode = FlashcardModalMode.Cram;   // existing
You can reuse the existing cram deck selection UI; only the behavior changes.

5.2. Ending a cram overlay (and applying synthetic “Easy”)
You need a single “session end” point:

when the user presses X to close the modal; and

when the cram queue empties.

In that place:

private async finishCramOverlayIfNeeded(): Promise<void> {
  if (!this.reviewSequencer.isCramOverlayActive()) return;

  const session = this.reviewSequencer.endCramOverlay();
  if (!session) return;

  const memorizedKeys = session.getMemorizedCardKeys();
  await this.applyPostCramEasyToMemorizedCards(memorizedKeys);
}
Call finishCramOverlayIfNeeded() from:

onClose() handler of the modal, and

when the sequencer reports “no more cards”.

6. Implement “post-cram Easy” using the existing algorithm
Now the important part: for each memorized card, pretend the user did one Easy review in the normal SM-2-OSR flow.

You want to reuse the exact same math and storage the plugin already uses for a real Easy click. That path is:

FlashcardReviewSequencer → OsrCore → SrsAlgorithmOsr → DataStoreAlgorithm

Because your tools have limited direct visibility into the exact function names, it’s safest to:

Find the method in flashcard-review-sequencer.ts that handles a normal Easy button press.

Extract the “business logic” into a helper that you can call both from the modal and from your “post-cram” loop.

Conceptually:

// in FlashcardReviewSequencer
applyNormalScheduledReview(card: Card, response: ReviewResponse) {
  // This is mostly your existing code for Review mode:
  //
  // - get existing scheduleInfo from card
  // - call algorithm.cardGetNewSchedule or cardCalcUpdatedSchedule
  // - update card.scheduleInfo
  // - call DataStoreAlgorithm.getInstance().cardUpdateSchedule(...)
  // - update histograms in OsrCore
  // - remove card from current queue / move to buried list, etc.
}
Then in the modal:

private async applyPostCramEasyToMemorizedCards(cardKeys: string[]): Promise<void> {
  // 1. Map keys back to Card instances
  const allCards = this.reviewSequencer.getAllCardsInCurrentDeck(); // you may need to add this helper
  const keyToCard = new Map(
    allCards.map(c => [this.reviewSequencer.getOverlaySession().getCardKey(c), c])
  );

  for (const key of cardKeys) {
    const card = keyToCard.get(key);
    if (!card) continue;

    // 2. Call the same path that a real Easy click would use
    this.reviewSequencer.applyNormalScheduledReview(card, ReviewResponse.Easy);
  }

  // 3. Trigger any UI refresh you need (deck stats, etc.)
  this.refreshDeckStats();
}
Resulting behavior:

During cram:

Button presses only manipulate CramOverlaySession (stages, queue order).

No schedule comments in your notes are touched.

At end:

Every card that finished in the Memorized stage gets one SM-2-OSR Easy applied, as if you had answered it Easy once in a normal session.

Cards that didn’t reach Memorized are completely untouched in the long-term schedule.

This matches your spec: “the conclusion of the cram session in its entirety should serve as a single advance / easy button push for each card that made it to the memorized stage.”

7. Optional: stage bar UI inside the modal
Since you also want the Cram stage bar, plug it into this overlay:

In flashcard-modal.tsx, compute stage stats on render:

const overlay = this.reviewSequencer.getOverlaySession();
let cramStats = null;

if (overlay && this.currentCard) {
  const allCards = this.reviewSequencer.getAllCardsInCurrentDeck();
  const counts = new Array(5).fill(0);
  for (const card of allCards) {
    const s = overlay.getStage(card);
    if (s >= 0 && s < counts.length) counts[s]++;
  }
  cramStats = {
    counts,
    currentStage: overlay.getStage(this.currentCard),
  };
}
Pass cramStats into a CramStageBar React component like we outlined earlier (Levels 1–4 + Memorized, highlight currentStage).

That gives you the Cram-style header in your second screenshot, driven entirely by the overlay.

8. Build, install, and test your fork
8.1. Build the plugin
From your fork’s root:

pnpm build          # or npm run build
You should get:

main.js

manifest.json

styles.css

in the repo root or a build/ folder, depending on the config; the official docs say these three files are what Obsidian needs.

8.2. Install into Obsidian
In your vault, create a folder:

<vault>/.obsidian/plugins/obsidian-spaced-repetition-cram
Copy main.js, manifest.json, styles.css from your build output into that folder.

In Obsidian:

Settings → Community plugins → Reload plugins list (if needed).

Enable your obsidian-spaced-repetition-cram plugin.

(Optional) disable the original Spaced Repetition plugin to avoid confusion.

8.3. Test scenarios
Try these in a throwaway test vault first:

Baseline: normal review

With overlay code in place but disabled, confirm regular Review mode still schedules cards and writes <!--SR:...--> comments as before.

Cram overlay session

Start Cram on a small deck.

Answer some cards correctly until they hit Memorized in your bar; answer others wrong so they stay low stages.

End the session (queue empty or closing the modal).

Check schedules

Inspect the notes:

Memorized cards should have new SR comments (due dates pushed further based on an Easy).

Non-memorized cards should have unchanged SR comments.

Next-day review

Use the normal Review command and confirm memorized cards are scheduled consistent with a single extra Easy review; non-memorized cards behave as if you never touched them.



You said:
Let's sketch tests, but first can you also make it so that each card, if it is faced with a threshold of demotions (wrong/sent back), then in the synthetic review applied to those cards is not easy but some other configurable value. So for example if I have 10 cards, and cards 2,4,7 are tripping me up in the cram session, and I do eventually get them all to memorized, 2,4,7 if they were demoted or sent to the beginning lets say 3 or more times then they are given a hard review applied to the normal schedule (or whatever value you want applied at the time of cram session end)
ChatGPT said:

Thought for 3m 55s
Got it — we’ll extend the design we already sketched so:

A cram session still uses stages/buckets.

At the end of the session you apply one synthetic SR review per card.

Cards that reached Memorized:

If they weren’t troublesome → treated as Easy (or whatever you configure).

If they were troublesome (lots of demotions) → treated as Hard (or another configured rating).

I’ll walk through:

What to change in the codebase (with file names from the repo).

How to track demotions + compute the synthetic response.

How to apply the synthetic SR review at the end of cram.

How to sketch Jest tests.

How to build and run your fork.

1. Add settings for cram + demotion thresholds
Open src/settings.ts (this is where SRSettings and the settings tab live).

1.1. Extend SRSettings
Add fields that control cram behaviour:

// in SRSettings interface
export interface SRSettings {
  // existing...
  cramEnabled: boolean;                 // if you add a master toggle
  cramStages: number;                   // e.g. 5
  cramMemorizedStageIndex: number;      // e.g. 4 (0-based index)
  cramDemotionThreshold: number;        // e.g. 3

  // how to translate cram session result into SR response
  cramSyntheticDefaultResponse: "easy" | "good" | "hard";   // non-troublesome
  cramSyntheticTroublesomeResponse: "easy" | "good" | "hard"; // troublesome
}
In the DEFAULT_SETTINGS constant, set reasonable defaults:

export const DEFAULT_SETTINGS: SRSettings = {
  // existing defaults...
  cramEnabled: true,
  cramStages: 5,
  cramMemorizedStageIndex: 4,
  cramDemotionThreshold: 3,
  cramSyntheticDefaultResponse: "easy",
  cramSyntheticTroublesomeResponse: "hard",
};
1.2. Add UI controls
In the plugin setting tab (same file, look for class SRSettingTab extends PluginSettingTab), add a new section “Cram mode” with inputs:

Toggle: “Enable cram mode”.

Slider/number: “Stages”.

Number: “Memorized stage index”.

Number: “Demotion threshold”.

Dropdown for default synthetic response.

Dropdown for troublesome synthetic response.

Example for the threshold:

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
For the response dropdowns, store the string "easy" | "good" | "hard" and convert later to the ReviewResponse enum from src/algorithms/base/repetition-item.

2. Add Cram session state with demotion tracking
You’ll need a Cram session module that lives alongside the review sequencer. A natural place is a new file, e.g. src/gui/cram-session.ts, because flashcard-review-sequencer.ts already encapsulates queue logic and knows about ISrsAlgorithm, DataStore, etc.

2.1. Card-level state
Add a structure to track per-card stage and demotions:

import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { Card } from "src/card";
import { SRSettings } from "src/settings";

interface CramCardState {
  stage: number;
  demotions: number;       // times we dropped back to stage 0 (or lower)
  // you can keep other stats here if needed
}

export class CramSessionState {
  private readonly settings: SRSettings;
  private readonly memorizedStage: number;
  private readonly demotionThreshold: number;

  private readonly perCard: Map<string, CramCardState> = new Map();

  constructor(settings: SRSettings) {
    this.settings = settings;
    this.memorizedStage = settings.cramMemorizedStageIndex;
    this.demotionThreshold = settings.cramDemotionThreshold;
  }

  private keyFor(card: Card): string {
    // use whatever is stable: note path + card index is a good choice
    return `${card.question.notePath}::${card.cardIdx}`;
  }

  getOrInit(card: Card): CramCardState {
    const key = this.keyFor(card);
    let state = this.perCard.get(key);
    if (!state) {
      state = { stage: 0, demotions: 0 };
      this.perCard.set(key, state);
    }
    return state;
  }

  /**
   * Update cram stage & demotion count after a response.
   * DOES NOT touch the real SR schedule.
   */
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
        state.stage = Math.min(this.memorizedStage, prevStage + 1);
        break;
    }

    // demotion = going all the way back to 0 from a higher stage
    if (prevStage > 0 && state.stage === 0) {
      state.demotions += 1;
    }
  }

  /**
   * Decide what synthetic SR response to apply to this card at end of cram.
   * Returns null if the card never reached Memorized.
   */
  getSyntheticResponse(card: Card): ReviewResponse | null {
    const state = this.perCard.get(this.keyFor(card));
    if (!state) return null;
    if (state.stage < this.memorizedStage) return null;

    const base = this.settings.cramSyntheticDefaultResponse;
    const troublesome = this.settings.cramSyntheticTroublesomeResponse;

    const choice = state.demotions >= this.demotionThreshold
      ? troublesome
      : base;

    switch (choice) {
      case "easy": return ReviewResponse.Easy;
      case "good": return ReviewResponse.Good;
      case "hard": return ReviewResponse.Hard;
      default:     return ReviewResponse.Good;
    }
  }
}
You’ll use this class from the cram review modal: every time the user presses Again/Hard/Good/Easy, you call cramSessionState.recordResponse(card, response) instead of immediately calling the SRS algorithm.

3. Integrate cram into the review flow
3.1. Where real scheduling normally happens
src/flashcard-review-sequencer.ts is the central orchestrator. It imports ISrsAlgorithm, ReviewResponse, Card, DataStore, etc. and exposes:

determineCardSchedule(response: ReviewResponse, card: Card): RepItemScheduleInfo

processReview(response: ReviewResponse): Promise<void>

among other methods.

Normally, processReview does roughly:

Call determineCardSchedule with the button response.

Update the card’s schedule in the DataStore.

Re-queue / pop the card from the current deck queue.

3.2. Cram flow
For cram mode, you want to:

During cram:

Update only CramSessionState stages & demotions.

Keep the in-memory queue cycling through cards based on those stages.

Do not call determineCardSchedule or update the DataStore.

At end of cram:

Iterate all cards seen in the cram session.

For each card:

Ask cramSessionState.getSyntheticResponse(card).

If it returns null, skip (card never truly memorized).

Else:

Call determineCardSchedule(syntheticResponse, card) to compute the new schedule.

Persist via the same DataStore call used in processReview.

So inside flashcard-review-sequencer.ts (or a nearby helper), add something like:

import { CramSessionState } from "src/gui/cram-session";

export class FlashcardReviewSequencer implements IFlashcardReviewSequencer {
  // existing fields...
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
      // use the same DataStore method that processReview uses
      this.dataStore.updateCardSchedule(card, schedule);
    }

    this.cramSession = null;
    this.cardsSeenInCram.clear();
  }

  async processReview(response: ReviewResponse): Promise<void> {
    const card = this.currentCard;
    if (!card) return;

    if (this.cramSession) {
      // cram mode: only track cram state, no real scheduling
      this.cardsSeenInCram.add(card);
      this.cramSession.recordResponse(card, response);
      // then move to next card according to cram queue rules you already designed
      this.moveToNextCardInCramQueue(response);
      return;
    }

    // normal SR processing (existing behaviour)...
  }
}
updateCardSchedule here is a placeholder name: check how processReview actually updates the schedule in the real code and reuse that exact call.

3.3. Hooking cram to the modal UI
In src/gui there’s a component that renders the flashcard review modal (buttons, question/answer, etc.). You want:

A way to start cram for:

The currently selected deck; or

A sub-deck picked from the sidebar.

A way to end cram: a “Finish cram” button that calls sequencer.endCramSessionAndApplySyntheticReview().

Since you already want the bucket bar UI at the top of the modal:

That UI can use the CramSessionState map to compute counts per stage:

For each card seen in cardsSeenInCram, read state.stage and increment a counter for that stage.

Highlight the stage of the current card by comparing its CramCardState.stage to the stage being rendered.

4. Sketching Jest tests for the new behaviour
The repo uses Jest (see jest.config.js and existing tests under tests/unit).

Add a new test file, e.g. tests/unit/cram-session.test.ts.

4.1. Unit tests for CramSessionState
These tests don’t need Obsidian; just pure TypeScript.

import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { CramSessionState } from "src/gui/cram-session";
import { Card } from "src/card";
import { SRSettings, DEFAULT_SETTINGS } from "src/settings";

function fakeSettings(overrides: Partial<SRSettings> = {}): SRSettings {
  return {
    ...DEFAULT_SETTINGS,
    cramStages: 5,
    cramMemorizedStageIndex: 4,
    cramDemotionThreshold: 3,
    cramSyntheticDefaultResponse: "easy",
    cramSyntheticTroublesomeResponse: "hard",
    ...overrides,
  };
}

function fakeCard(id: string): Card {
  // minimal stub that satisfies keyFor()
  return {
    cardIdx: 0,
    question: { notePath: id } as any,
  } as Card;
}

describe("CramSessionState", () => {
  test("memorized card with no demotions uses default synthetic response", () => {
    const settings = fakeSettings();
    const cram = new CramSessionState(settings);
    const card = fakeCard("note-1");

    // four consecutive correct answers → stage 4 (memorized)
    cram.recordResponse(card, ReviewResponse.Good); // 0→1
    cram.recordResponse(card, ReviewResponse.Good); // 1→2
    cram.recordResponse(card, ReviewResponse.Good); // 2→3
    cram.recordResponse(card, ReviewResponse.Good); // 3→4

    const result = cram.getSyntheticResponse(card);
    expect(result).toBe(ReviewResponse.Easy);  // defaultSyntheticResponse
  });

  test("memorized troublesome card uses troublesome synthetic response", () => {
    const settings = fakeSettings({ cramDemotionThreshold: 2 });
    const cram = new CramSessionState(settings);
    const card = fakeCard("note-1");

    // trip up twice: reach stage>0 then fall back to 0
    cram.recordResponse(card, ReviewResponse.Good);  // 0→1
    cram.recordResponse(card, ReviewResponse.Again); // 1→0 (demotion #1)
    cram.recordResponse(card, ReviewResponse.Good);  // 0→1
    cram.recordResponse(card, ReviewResponse.Again); // 1→0 (demotion #2)

    // eventually still get it to memorized
    cram.recordResponse(card, ReviewResponse.Good); // 0→1
    cram.recordResponse(card, ReviewResponse.Good); // 1→2
    cram.recordResponse(card, ReviewResponse.Good); // 2→3
    cram.recordResponse(card, ReviewResponse.Good); // 3→4 (memorized)

    const result = cram.getSyntheticResponse(card);
    expect(result).toBe(ReviewResponse.Hard); // troublesomeSyntheticResponse
  });

  test("non-memorized card has no synthetic review", () => {
    const cram = new CramSessionState(fakeSettings());
    const card = fakeCard("note-1");

    cram.recordResponse(card, ReviewResponse.Good); // 0→1

    const result = cram.getSyntheticResponse(card);
    expect(result).toBeNull();
  });
});
You can add more tests for nuanced behaviour (e.g. how you treat Hard vs Again demotions), but this covers the main semantics.

4.2. Integration-ish test for endCramSessionAndApplySyntheticReview
Create tests/unit/cram-integration.test.ts where you mock the sequencer’s interaction with the data store and algorithm.

Something like:

import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { FlashcardReviewSequencer } from "src/flashcard-review-sequencer";
import { SRSettings, DEFAULT_SETTINGS } from "src/settings";
import { Card } from "src/card";

function createSequencerWithMocks() {
  const settings: SRSettings = {
    ...DEFAULT_SETTINGS,
    cramEnabled: true,
    cramDemotionThreshold: 1,
    cramSyntheticDefaultResponse: "easy",
    cramSyntheticTroublesomeResponse: "hard",
  };

  // create dummy dataStore & algorithm with spies
  const dataStore: any = {
    updateCardSchedule: jest.fn(),
    // plus any other methods FlashcardReviewSequencer's ctor needs
  };

  const algorithm: any = {
    cardGetNewSchedule: jest.fn().mockReturnValue({ interval: 1 }),
    cardCalcUpdatedSchedule: jest.fn().mockReturnValue({ interval: 2 }),
    // etc, depending on determineCardSchedule’s inner logic
  };

  const sequencer = new FlashcardReviewSequencer(
    settings,
    dataStore,
    algorithm,
    /* other deps: queues, histograms, etc → mocked */
  ) as any;

  return { sequencer, dataStore, settings };
}

test("endCramSession applies different responses to troublesome vs non-troublesome", async () => {
  const { sequencer, dataStore, settings } = createSequencerWithMocks();

  const cardEasy = { /* minimal Card stub */ } as Card;
  const cardHard = { /* another stub */ } as Card;

  sequencer.startCramSession(settings);

  // simulate reviews in cram mode
  sequencer.currentCard = cardEasy;
  await sequencer.processReview(ReviewResponse.Good);
  // ... move to memorized without demotions (you may need to stub moveToNextCardInCramQueue)

  sequencer.currentCard = cardHard;
  await sequencer.processReview(ReviewResponse.Good);
  await sequencer.processReview(ReviewResponse.Again);
  // etc until hard card is memorized with at least 1 demotion

  sequencer.endCramSessionAndApplySyntheticReview();

  // assert dataStore.updateCardSchedule was called twice
  expect(dataStore.updateCardSchedule).toHaveBeenCalledTimes(2);

  // and that the synthetic ratings used differ
  const calls = dataStore.updateCardSchedule.mock.calls;
  const [card1, schedule1] = calls[0];
  const [card2, schedule2] = calls[1];

  // depending on how determineCardSchedule encodes response,
  // you could instead spy on that to assert Easy vs Hard
});
You’ll need to adapt this to the actual constructor signature of FlashcardReviewSequencer and its methods, but the testing idea is:

Mock out everything except the wiring between cram + synthetic response + schedule update.

Verify that troublesome/non-troublesome cards ultimately cause different calls into the algorithm or data store.

5. Build and run your fork
Once you’ve implemented:

Fork st3v3nmw/obsidian-spaced-repetition on GitHub and clone your fork locally.

Create a feature branch, e.g. feature/cram-mode.

Install deps:

pnpm install
Run tests:

pnpm test
Build:

pnpm run build
The docs mention that for manual installation you copy main.js, manifest.json, and styles.css from the release/build into .obsidian/plugins/your-plugin-folder.

In your vault, create .obsidian/plugins/obsidian-spaced-repetition-cram and copy those three files from your build output.

Reload Obsidian’s plugins and enable your version instead of (or in addition to) the original.

If you’d like, next step we can:

Tighten exactly how the bucket UI should look (CSS classes / HTML structure for the modal), or

Flesh out more precise mocks for the FlashcardReviewSequencer constructor once you’re looking at it locally.




No file chosenNo file chosen
ChatGPT can make mistakes. OpenAI doesn't use Dekker Design workspace data to train its models.
