const MODERATION_POLICY_VERSION = "2026-11-26.1";

const PROHIBITED_CATEGORIES = Object.freeze({
    academic_dishonesty: "Completing graded work, exams, or assessments on another student's behalf",
    illegal_activities: "Requests to buy, sell, or carry out illegal activity",
    sexual_services: "Sexual services, exploitation, or explicit sexual content",
    harassment_discrimination: "Harassment, discriminatory targeting, or intimidation",
    threats_violence: "Threats, assault, or violent activity",
    dangerous_activities: "Unsafe activity with a foreseeable risk of injury",
    fraud_scams: "Fraud, phishing, theft, or deceptive transactions",
    unauthorized_access: "Entering restricted, locked, or otherwise unauthorized campus spaces",
});

const PERMITTED_ACTIVITY_GUIDANCE = Object.freeze([
    "Lawful deliveries, errands, and campus pickups",
    "Moving and other ordinary household assistance",
    "Non-graded tutoring and study support",
    "Routine technology help",
    "Other consensual, lawful tasks that do not create a safety risk",
]);

const rules = [
    { id: "academic-work-for-hire", category: "academic_dishonesty", action: "reject", confidence: "high", pattern: /\b(?:do|complete|write|take|submit|solve)\s+(?:my|the)\s+(?:exam|test|quiz|problem\s*set|homework|assignment|essay|paper)\s+(?:for\s+me|on\s+my\s+behalf)\b|\b(?:take|sit|write)\s+my\s+(?:exam|test|quiz)\b/i },
    { id: "explicit-sexual-service", category: "sexual_services", action: "reject", confidence: "high", pattern: /\b(?:sexual\s+services?|sex\s+for\s+(?:money|pay)|sexual\s+favors?\s+for\s+(?:money|pay)|hire\s+an?\s+escort)\b/i },
    { id: "explicit-fraud", category: "fraud_scams", action: "reject", confidence: "high", pattern: /\b(?:phish(?:ing)?\s+(?:for|someone'?s?)|steal\s+(?:a\s+)?(?:credit\s+card|password|identity)|make\s+(?:a\s+)?fake\s+(?:id|receipt)|scam\s+(?:someone|people))\b/i },
    { id: "illegal-transaction", category: "illegal_activities", action: "review", confidence: "medium", pattern: /\b(?:buy|sell|deliver|carry)\s+(?:illegal\s+)?(?:drugs?|controlled\s+substances?|stolen\s+goods?)\b|\b(?:steal|break\s+into|make\s+a\s+fake\s+id)\b/i },
    { id: "harassment-or-discrimination", category: "harassment_discrimination", action: "review", confidence: "medium", pattern: /\b(?:help\s+me\s+)?(?:harass|bully|intimidate|threaten|humiliate)\s+(?:my\s+)?(?:classmate|roommate|coworker|professor|student|neighbor|someone|them|him|her)\b|\b(?:target|exclude)\s+(?:someone|people)\s+because\s+of\s+(?:their\s+)?(?:race|religion|gender|disability|nationality)\b/i },
    { id: "threat-or-violence", category: "threats_violence", action: "review", confidence: "medium", pattern: /\b(?:hurt|kill|attack|shoot|stab|beat\s+up)\s+(?:someone|my\s+classmate|my\s+roommate|my\s+professor|them|him|her)\b|\b(?:shoot\s+up|bomb)\s+(?:the\s+)?(?:school|campus|building|classroom)\b/i },
    { id: "dangerous-activity", category: "dangerous_activities", action: "review", confidence: "medium", pattern: /\b(?:make|build|assemble)\s+(?:a\s+)?(?:bomb|explosive|weapon)\b|\b(?:climb|get\s+onto|enter)\s+(?:a\s+)?(?:roof|rooftop|steam\s+tunnel|construction\s+site|restricted\s+lab)\b|\bhandle\s+(?:explosives?|toxic\s+chemicals?)\b/i },
    { id: "unauthorized-access", category: "unauthorized_access", action: "review", confidence: "medium", pattern: /\b(?:sneak|break|get)\s+(?:into|inside)\s+(?:a\s+)?(?:locked|restricted|private)\s+(?:lab|laboratory|office|building|room|area)\b|\b(?:bypass|pick)\s+(?:a\s+)?(?:lock|keycard|access\s+control)\b|\b(?:steam\s+tunnels?|rooftops?|construction\s+sites?)\b/i },
];

function normalizeForScreening(value) {
    return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function screenQuest({ title = "", description = "", category = "", pickup = "", dropoff = "", hasImage = false } = {}) {
    const content = normalizeForScreening([title, description, category, pickup, dropoff].join(" "));
    const matches = rules.filter(rule => rule.pattern.test(content)).map(rule => ({
        id: rule.id,
        category: rule.category,
        confidence: rule.confidence,
        action: rule.action,
    }));
    if (hasImage) matches.push({ id: "image-needs-human-review", category: "image_content", confidence: "manual", action: "review" });
    const action = matches.some(match => match.action === "reject") ? "reject" : matches.length ? "review" : "allow";
    return {
        action,
        policyVersion: MODERATION_POLICY_VERSION,
        categories: [...new Set(matches.map(match => match.category))],
        signals: matches,
    };
}

function moderationMessage(status) {
    if (status === "pending_review") return "Your quest is awaiting a SideQuest moderator review and will appear after approval.";
    if (status === "rejected") return "This quest was not approved. Edit it to address the moderator's feedback, then resubmit.";
    return "Your quest is approved and visible to other users.";
}

module.exports = { MODERATION_POLICY_VERSION, PROHIBITED_CATEGORIES, PERMITTED_ACTIVITY_GUIDANCE, screenQuest, moderationMessage, normalizeForScreening };
