const test = require("node:test");
const assert = require("node:assert/strict");
const { QUEST_STATES, canTransition, normalizeQuestStatus } = require("./quest-lifecycle.js");

test("legacy quest states migrate conservatively", () => {
    assert.equal(normalizeQuestStatus(0), "open");
    assert.equal(normalizeQuestStatus(1), "in_progress");
    assert.equal(normalizeQuestStatus(2), "pending_review");
    assert.equal(normalizeQuestStatus(3), "cancelled");
});

test("the normal external-payment lifecycle is enforced", () => {
    const path = ["open", "in_progress", "pending_review", "awaiting_payment", "payment_sent", "completed"];
    assert.deepEqual(QUEST_STATES.length, 8);
    for (let index = 0; index < path.length - 1; index++) assert.equal(canTransition(path[index], path[index + 1]), true);
    assert.equal(canTransition("open", "completed"), false);
    assert.equal(canTransition("completed", "disputed"), false);
    assert.equal(canTransition("payment_sent", "completed"), true);
});
