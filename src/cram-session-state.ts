import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { Card } from "src/card";
import { SRSettings } from "src/settings";

export interface CramStageStats {
    counts: number[];
    currentStage: number;
}

interface CramCardState {
    card: Card;
    stage: number;
    demotions: number;
}

export class CramSessionState {
    private readonly memorizedStage: number;
    private readonly perCard: Map<string, CramCardState> = new Map();

    constructor(private readonly settings: SRSettings) {
        this.memorizedStage = Math.min(
            settings.cramStages - 1,
            Math.max(0, settings.cramMemorizedStageIndex),
        );
    }

    private keyFor(card: Card): string {
        const notePath = card.question?.note?.filePath ?? card.question?.note?.file?.path ?? "";
        const questionLine =
            card.question?.parsedQuestionInfo?.firstLineNum ??
            card.question?.questionText?.textHash ??
            "";
        return `${notePath}::${questionLine}::${card.cardIdx}`;
    }

    private getOrCreateState(card: Card): CramCardState {
        const key = this.keyFor(card);
        let state = this.perCard.get(key);
        if (!state) {
            state = { card, stage: 0, demotions: 0 };
            this.perCard.set(key, state);
        } else if (!state.card) {
            state.card = card;
        }
        return state;
    }

    recordResponse(card: Card, response: ReviewResponse, targetStage: number): void {
        const state = this.getOrCreateState(card);
        const previousStage = state.stage;
        const newStage = Math.min(this.memorizedStage, Math.max(0, targetStage));
        state.stage = newStage;
        if (newStage < previousStage) {
            state.demotions += 1;
        }
    }

    getStageStats(currentCard: Card | null = null): CramStageStats {
        const counts: number[] = Array.from({ length: this.settings.cramStages }, () => 0);
        for (const state of this.perCard.values()) {
            const idx = Math.max(0, Math.min(counts.length - 1, state.stage));
            counts[idx] += 1;
        }

        const currentStage = currentCard ? this.getStage(currentCard) : 0;
        return { counts, currentStage };
    }

    getStage(card: Card): number {
        const state = this.perCard.get(this.keyFor(card));
        return state ? state.stage : 0;
    }

    getCardsWithSyntheticResponses(): Array<{ card: Card; response: ReviewResponse }> {
        const result: Array<{ card: Card; response: ReviewResponse }> = [];
        for (const state of this.perCard.values()) {
            if (!state.card || state.stage < this.memorizedStage) continue;
            const threshold = Math.max(0, this.settings.cramDemotionThreshold);
            const useTroublesome = state.demotions >= threshold;
            const choice = useTroublesome
                ? this.settings.cramSyntheticTroublesomeResponse
                : this.settings.cramSyntheticDefaultResponse;
            let response: ReviewResponse;
            switch (choice) {
                case "easy":
                    response = ReviewResponse.Easy;
                    break;
                case "hard":
                    response = ReviewResponse.Hard;
                    break;
                default:
                    response = ReviewResponse.Good;
                    break;
            }
            result.push({ card: state.card, response });
        }
        return result;
    }

    seedCards(cards: Card[]): void {
        for (const card of cards) {
            const key = this.keyFor(card);
            if (!this.perCard.has(key)) {
                this.perCard.set(key, { card, stage: 0, demotions: 0 });
            } else {
                const existing = this.perCard.get(key);
                if (existing && !existing.card) {
                    existing.card = card;
                }
            }
        }
    }
}
