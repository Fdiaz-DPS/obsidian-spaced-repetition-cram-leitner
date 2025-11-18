import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { Card } from "src/card";
import { CramSessionState } from "src/cram-session-state";
import { Question } from "src/question";
import { SRSettings, DEFAULT_SETTINGS } from "src/settings";

function createCard(lineNumber: number, cardIdx: number): Card {
    const card = new Card({ cardIdx });
    card.question = {
        note: { filePath: "TestNote.md" },
        parsedQuestionInfo: { firstLineNum: lineNumber },
        questionText: { textHash: `hash-${lineNumber}` },
    } as Question;
    return card;
}

describe("CramSessionState", () => {
    it("returns synthetic responses per card, respecting demotion threshold", () => {
        const settings: SRSettings = {
            ...DEFAULT_SETTINGS,
            cramStages: 2,
            cramMemorizedStageIndex: 1,
            cramDemotionThreshold: 1,
            cramSyntheticDefaultResponse: "good",
            cramSyntheticTroublesomeResponse: "hard",
        };
        const session = new CramSessionState(settings);
        const easyCard = createCard(5, 0);
        const troublesomeCard = createCard(25, 0);

        session.seedCards([easyCard, troublesomeCard]);

        session.recordResponse(easyCard, ReviewResponse.Easy, 1);

        // troublesome card reaches memorized stage, gets demoted once, then returns
        session.recordResponse(troublesomeCard, ReviewResponse.Good, 1);
        session.recordResponse(troublesomeCard, ReviewResponse.Hard, 0);
        session.recordResponse(troublesomeCard, ReviewResponse.Easy, 1);

        const results = session.getCardsWithSyntheticResponses();
        const responseByCard = new Map(results.map(({ card, response }) => [card, response]));

        expect(responseByCard.get(easyCard)).toEqual(ReviewResponse.Good);
        expect(responseByCard.get(troublesomeCard)).toEqual(ReviewResponse.Hard);
    });
});
