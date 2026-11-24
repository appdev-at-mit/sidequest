const QUEST_STATES = Object.freeze([
    "open", "in_progress", "pending_review", "awaiting_payment",
    "payment_sent", "completed", "disputed", "cancelled",
]);

// Legacy status 2 meant the helper claimed completion but had no requester/payment receipt.
// Keep that record in the review lane; never silently count it as paid or complete.
const LEGACY_STATES = Object.freeze({ 0: "open", 1: "in_progress", 2: "pending_review", 3: "cancelled" });

const TRANSITIONS = Object.freeze({
    open: ["in_progress", "cancelled"],
    in_progress: ["pending_review", "disputed", "cancelled"],
    pending_review: ["awaiting_payment", "disputed", "cancelled"],
    awaiting_payment: ["payment_sent", "disputed", "cancelled"],
    payment_sent: ["completed", "disputed"],
    completed: [],
    disputed: [],
    cancelled: [],
});

function normalizeQuestStatus(status) {
    return typeof status === "number" ? LEGACY_STATES[status] ?? "open"
        : QUEST_STATES.includes(status) ? status : "open";
}

function canTransition(from, to) {
    const current = normalizeQuestStatus(from);
    return TRANSITIONS[current]?.includes(to) ?? false;
}

module.exports = { QUEST_STATES, LEGACY_STATES, TRANSITIONS, normalizeQuestStatus, canTransition };
