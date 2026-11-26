const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const REVIEW_TAGS = Object.freeze({
    requester: Object.freeze(["On time", "Good communication", "Followed instructions", "Reliable", "Quality work"]),
    acceptor: Object.freeze(["Clear instructions", "Responsive", "Respectful", "Fair reward", "Prompt payment"]),
});

function completionTime(quest) {
    const value = quest?.completedAt ?? quest?.paymentConfirmedAt;
    const time = value instanceof Date ? value.getTime() : Date.parse(value ?? "");
    return Number.isFinite(time) ? time : null;
}

function reviewWindowEnd(quest) {
    const time = completionTime(quest);
    return time == null ? null : time + REVIEW_WINDOW_MS;
}

function reviewStarValue(review) {
    if (Number.isInteger(review?.rating) && review.rating >= 1 && review.rating <= 5) return review.rating;
    const oldRatings = Object.values(review?.ratings ?? {}).filter(value => Number.isInteger(value) && value >= 1 && value <= 5);
    return oldRatings.length ? Math.round(oldRatings.reduce((sum, value) => sum + value, 0) / oldRatings.length) : null;
}

function isPublishedReview(review) {
    return (review?.publicationStatus === "published" || review?.publicationStatus == null)
        && !["hidden", "removed"].includes(review?.moderationStatus);
}

function normalizeTags(role, tags) {
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string" || !REVIEW_TAGS[role]?.includes(tag))) return null;
    return [...new Set(tags)];
}

module.exports = { REVIEW_WINDOW_MS, REVIEW_TAGS, completionTime, reviewWindowEnd, reviewStarValue, isPublishedReview, normalizeTags };
