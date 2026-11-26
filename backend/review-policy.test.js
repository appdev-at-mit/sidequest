const test = require("node:test");
const assert = require("node:assert/strict");
const { REVIEW_WINDOW_MS, REVIEW_TAGS, completionTime, reviewWindowEnd, reviewStarValue, isPublishedReview, normalizeTags } = require("./review-policy.js");
const { ratingSummary } = require("./db-connect.js");

test("review window is anchored to payment-confirmed completion", () => {
    const completedAt = new Date("2026-01-01T12:00:00.000Z");
    const quest = { paymentConfirmedAt: completedAt };
    assert.equal(completionTime(quest), completedAt.getTime());
    assert.equal(reviewWindowEnd(quest), completedAt.getTime() + REVIEW_WINDOW_MS);
    assert.equal(reviewWindowEnd({}), null);
});

test("review tags are role-specific, deduplicated, and reject unknown values", () => {
    assert.deepEqual(normalizeTags("requester", [REVIEW_TAGS.requester[0], REVIEW_TAGS.requester[0]]), [REVIEW_TAGS.requester[0]]);
    assert.deepEqual(normalizeTags("acceptor", [REVIEW_TAGS.acceptor[1]]), [REVIEW_TAGS.acceptor[1]]);
    assert.equal(normalizeTags("requester", [REVIEW_TAGS.acceptor[0]]), null);
    assert.equal(normalizeTags("acceptor", "Reliable"), null);
});

test("legacy reviews remain published and legacy category ratings map to one score", () => {
    assert.equal(isPublishedReview({ role: "completer" }), true);
    assert.equal(reviewStarValue({ ratings: { quality: 5, communication: 4, reliability: 4 } }), 4);
    assert.equal(reviewStarValue({ rating: 2 }), 2);
    assert.equal(isPublishedReview({ publicationStatus: "pending" }), false);
});

test("moderation hides a review from publication without deleting its record", () => {
    assert.equal(isPublishedReview({ publicationStatus: "published", moderationStatus: "hidden" }), false);
    assert.equal(isPublishedReview({ publicationStatus: "published", moderationStatus: "visible" }), true);
});

test("public rating aggregates ignore pending and hidden reviews", () => {
    const summary = ratingSummary([
        { publicationStatus: "published", rating: 5, moderationStatus: "visible" },
        { publicationStatus: "published", rating: 4, moderationStatus: "visible" },
        { publicationStatus: "pending", rating: 1, moderationStatus: "visible" },
        { publicationStatus: "published", rating: 1, moderationStatus: "hidden" },
    ]);
    assert.equal(summary.rating, 4.5);
    assert.equal(summary.reviewCount, 2);
    assert.deepEqual(ratingSummary([]), { rating: null, reviewCount: 0 });
});
