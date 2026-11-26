// Keep the default in sync with backend/validation.js. Backend validation is authoritative.
export const MAX_REWARD_CENTS = 100000;

export const inputSchemas = {
  kerb: (value: string) => /^[a-zA-Z0-9_-]{1,8}$/.test(value),
  roomNumber: (value: string) => !value || (value.length <= 30 && /^[\p{L}\p{N}][\p{L}\p{N} .#/-]*$/u.test(value.trim())),
  objectId: (value: string) => /^[0-9a-fA-F]{24}$/.test(value),
  coordinates: (lat: number, lng: number) => Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180,
  rewardCents: (cents: number) => Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_REWARD_CENTS,
  boundedText: (value: string, maxLength: number, minLength = 1) => value.trim().length >= minLength && value.trim().length <= maxLength,
  isoDateTime: (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return false;
    const [, year, month, day, hour, minute, second] = match.map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(Date.parse(value));
  },
} as const;
