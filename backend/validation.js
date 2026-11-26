require("dotenv").config();

const DEFAULT_MAX_REWARD_CENTS = 100000;
const configuredRewardLimit = Number.parseInt(process.env.MAX_QUEST_REWARD_CENTS ?? "", 10);
const MAX_REWARD_CENTS = Number.isSafeInteger(configuredRewardLimit) && configuredRewardLimit >= 300
    ? configuredRewardLimit : DEFAULT_MAX_REWARD_CENTS;

const schemas = Object.freeze({
    kerb: value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,8}$/.test(value),
    password: value => typeof value === "string" && value.length >= 12 && value.length <= 256,
    roomNumber: value => value == null || value === "" || (typeof value === "string" && value.length <= 30 && /^[\p{L}\p{N}][\p{L}\p{N} .#/-]*$/u.test(value.trim())),
    objectId: value => typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value),
    latitude: value => typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90,
    longitude: value => typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180,
    rewardCents: value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_REWARD_CENTS,
    category: value => ["Delivery", "Moving", "Home Help", "Tech", "Academic"].includes(value),
    paymentMethod: value => ["Cash", "PayPal", "Venmo", "Cash App", "Zelle", "Other"].includes(value),
    boundedText: (value, maxLength, minLength = 1) => typeof value === "string" && value.trim().length >= minLength && value.trim().length <= maxLength,
    isoDateTime: value => {
        if (typeof value !== "string") return false;
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
        if (!match) return false;
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(Date.parse(value));
    },
});

function parseReward(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100)) || Math.round(value * 100) / 100 !== value) return null;
    const cents = Math.round(value * 100);
    return schemas.rewardCents(cents) ? cents : null;
}

function isValidCoordinates(lat, lng) {
    return schemas.latitude(lat) && schemas.longitude(lng);
}

module.exports = { schemas, parseReward, isValidCoordinates, MAX_REWARD_CENTS };
