const QUEST_STATES = Object.freeze([
    "open", "in_progress", "pending_review", "awaiting_payment",
    "payment_sent", "completed", "disputed", "cancelled", "expired",
]);
const QUEST_GRACE_MS = 24 * 60 * 60 * 1000;

// Legacy status 2 meant the helper claimed completion but had no requester/payment receipt.
// Keep that record in the review lane; never silently count it as paid or complete.
const LEGACY_STATES = Object.freeze({ 0: "open", 1: "in_progress", 2: "pending_review", 3: "cancelled" });

const TRANSITIONS = Object.freeze({
    open: ["in_progress", "cancelled", "expired"],
    in_progress: ["pending_review", "awaiting_payment", "disputed", "cancelled", "open", "expired"],
    pending_review: ["awaiting_payment", "disputed", "cancelled"],
    awaiting_payment: ["payment_sent", "disputed", "cancelled"],
    payment_sent: ["completed", "disputed"],
    completed: [],
    disputed: [],
    cancelled: [],
    expired: ["open"],
});

function normalizeQuestStatus(status) {
    return typeof status === "number" ? LEGACY_STATES[status] ?? "open"
        : QUEST_STATES.includes(status) ? status : "open";
}

function canTransition(from, to) {
    const current = normalizeQuestStatus(from);
    return TRANSITIONS[current]?.includes(to) ?? false;
}

function canAccept(status, deadline, now = Date.now()) {
    return normalizeQuestStatus(status) === "open" && Number.isFinite(deadline) && deadline > now;
}

function cancellationStatus({ isAcceptor, status, deadline, now = Date.now(), hasWork = false, hasObligation = false, hasDispute = false }) {
    if (!isAcceptor || normalizeQuestStatus(status) !== "in_progress" || hasWork || hasObligation || hasDispute) return "cancelled";
    return deadline > now ? "open" : "expired";
}

function expirationGraceDeadline(deadline) {
    return Number.isFinite(deadline) ? deadline + QUEST_GRACE_MS : null;
}

function canExtendExpiredQuest(status, deadline, graceUntil, newDeadline, now = Date.now()) {
    const current = normalizeQuestStatus(status);
    return (current === "expired" || (current === "open" && Number.isFinite(deadline) && deadline <= now))
        && Number.isFinite(graceUntil) && graceUntil > now
        && Number.isFinite(newDeadline) && newDeadline > now;
}

function shouldArchiveExpiredQuest(status, graceUntil, now = Date.now(), { hasObligation = false, hasDispute = false, completed = false } = {}) {
    return normalizeQuestStatus(status) === "expired" && Number.isFinite(graceUntil) && graceUntil <= now
        && !hasObligation && !hasDispute && !completed;
}

module.exports = { QUEST_STATES, LEGACY_STATES, TRANSITIONS, normalizeQuestStatus, canTransition, canAccept, cancellationStatus, expirationGraceDeadline, canExtendExpiredQuest, shouldArchiveExpiredQuest, QUEST_GRACE_MS };
