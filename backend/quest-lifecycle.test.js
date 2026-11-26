const test = require("node:test");
const assert = require("node:assert/strict");
const { QUEST_STATES, canTransition, normalizeQuestStatus, canAccept, cancellationStatus, expirationGraceDeadline, canExtendExpiredQuest, shouldArchiveExpiredQuest, QUEST_GRACE_MS } = require("./quest-lifecycle.js");

test("legacy quest states migrate conservatively", () => {
    assert.equal(normalizeQuestStatus(0), "open");
    assert.equal(normalizeQuestStatus(1), "in_progress");
    assert.equal(normalizeQuestStatus(2), "pending_review");
    assert.equal(normalizeQuestStatus(3), "cancelled");
});

test("the normal external-payment lifecycle is enforced", () => {
    const path = ["open", "in_progress", "pending_review", "awaiting_payment", "payment_sent", "completed"];
    assert.deepEqual(QUEST_STATES.length, 9);
    for (let index = 0; index < path.length - 1; index++) assert.equal(canTransition(path[index], path[index + 1]), true);
    assert.equal(canTransition("open", "completed"), false);
    assert.equal(canTransition("completed", "disputed"), false);
    assert.equal(canTransition("payment_sent", "completed"), true);
});

test("an acceptor cancellation before the original deadline reopens an untouched quest", () => {
    const deadline = 10_000;
    assert.equal(cancellationStatus({ isAcceptor: true, status: "in_progress", deadline, now: 9_999 }), "open");
    assert.equal(canAccept("open", deadline, 9_999), true);
});

test("an acceptor cancellation at or after the original deadline expires the quest", () => {
    const deadline = 10_000;
    assert.equal(cancellationStatus({ isAcceptor: true, status: "in_progress", deadline, now: deadline }), "expired");
    assert.equal(cancellationStatus({ isAcceptor: true, status: "in_progress", deadline, now: deadline + 1 }), "expired");
    assert.equal(canAccept("open", deadline, deadline), false);
    assert.equal(canAccept("expired", deadline + QUEST_GRACE_MS, deadline + 1), false);
});

test("work, payment obligations, disputes, and requester cancellation prevent automatic reopening", () => {
    const base = { isAcceptor: true, status: "in_progress", deadline: 20_000, now: 10_000 };
    assert.equal(cancellationStatus({ ...base, hasWork: true }), "cancelled");
    assert.equal(cancellationStatus({ ...base, hasObligation: true }), "cancelled");
    assert.equal(cancellationStatus({ ...base, hasDispute: true }), "cancelled");
    assert.equal(cancellationStatus({ ...base, isAcceptor: false }), "cancelled");
});

test("reopened quests can be accepted by another user and stale cancellations cannot reopen twice", () => {
    const deadline = 20_000;
    const reopened = cancellationStatus({ isAcceptor: true, status: "in_progress", deadline, now: 10_000 });
    assert.equal(canAccept(reopened, deadline, 10_001), true);
    assert.equal(canTransition("open", "cancelled"), true);
    assert.equal(canTransition("cancelled", "open"), false);
});

test("expiration grace always ends 24 hours after the original deadline", () => {
    const deadline = Date.UTC(2026, 10, 26, 12, 0, 0);
    assert.equal(expirationGraceDeadline(deadline), deadline + 24 * 60 * 60 * 1000);
    assert.equal(expirationGraceDeadline(deadline), deadline + QUEST_GRACE_MS);
});

test("a requester can extend only before the persisted grace deadline", () => {
    const deadline = 10_000;
    const graceUntil = expirationGraceDeadline(deadline);
    assert.equal(canExtendExpiredQuest("expired", deadline, graceUntil, graceUntil + 1, graceUntil - 1), true);
    assert.equal(canExtendExpiredQuest("expired", deadline, graceUntil, graceUntil + 1, graceUntil), false);
    assert.equal(canExtendExpiredQuest("in_progress", deadline, graceUntil, graceUntil + 1, graceUntil - 1), false);
    assert.equal(canExtendExpiredQuest("open", deadline, graceUntil, graceUntil + 1, deadline - 1), false);
});

test("automatic archive starts at the grace threshold and preserves protected quests", () => {
    const graceUntil = 50_000;
    assert.equal(shouldArchiveExpiredQuest("expired", graceUntil, graceUntil), true);
    assert.equal(shouldArchiveExpiredQuest("open", graceUntil, graceUntil), false);
    assert.equal(shouldArchiveExpiredQuest("expired", graceUntil, graceUntil, { hasObligation: true }), false);
    assert.equal(shouldArchiveExpiredQuest("expired", graceUntil, graceUntil, { hasDispute: true }), false);
    assert.equal(shouldArchiveExpiredQuest("completed", graceUntil, graceUntil), false);
});
