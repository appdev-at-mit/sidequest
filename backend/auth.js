const { ObjectId } = require("mongodb");

function toAuthenticatedUser(user) {
    if (!user?._id || !user.kerb) return null;
    const providerVerified = user.identityProvider === "mit-touchstone"
        && typeof user.externalIdentityId === "string" && Boolean(user.externalIdentityId)
        && typeof user.verifiedUniversityIdentityId === "string" && Boolean(user.verifiedUniversityIdentityId);
    return Object.freeze({
        id: String(user._id),
        userId: String(user._id),
        kerb: user.kerb,
        name: user.name ?? "",
        roles: Object.freeze(Array.isArray(user.roles) ? [...user.roles] : []),
        identityVerificationStatus: providerVerified && user.identityVerificationStatus === "verified" ? "verified" : "unverified",
    });
}

function isQuestParticipant(quest, user) {
    if (!quest || !user) return false;
    const id = String(user.userId ?? user.id ?? "");
    return ["requester", "helper"].some(role => {
        const idField = `${role}Id`;
        if (quest[idField]) return id && String(quest[idField]) === id;
        return Boolean(user.kerb && quest[role] === user.kerb);
    });
}

function attachAuthenticatedUser(req, _res, next) {
    req.auth = req.isAuthenticated?.() ? toAuthenticatedUser(req.user) : null;
    next();
}

function requireAuthentication(req, res, next) {
    if (!req.isAuthenticated?.() || !req.auth?.userId || !ObjectId.isValid(req.auth.userId)) {
        return res.status(401).json({ msg: "You need to log in first." });
    }
    return next();
}

function requireAuthorization(predicate, message = "You are not authorized to perform this action.") {
    return (req, res, next) => {
        if (!req.auth || !predicate(req.auth, req)) return res.status(403).json({ msg: message });
        return next();
    };
}

module.exports = { toAuthenticatedUser, attachAuthenticatedUser, requireAuthentication, requireAuthorization, isQuestParticipant };
