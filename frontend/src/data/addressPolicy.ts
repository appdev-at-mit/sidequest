/**
 * Address eligibility guidance for SideQuest request locations.
 * MIT buildings may be publicly accessible only during posted hours. Restricted,
 * locked, private, construction, rooftop/dome, steam-tunnel and HVAC areas are
 * not valid task locations. Residence hall tasks must meet at the front desk or
 * lobby; delivery workers should not be sent past the desk without authorization.
 */
const RESTRICTED_LOCATION_TERMS = [
  /\bsteam tunnels?\b/i,
  /\bhvac\b/i,
  /\brooftops?\b/i,
  /\bdomes?\b/i,
  /\bconstruction sites?\b/i,
  /\blocked (?:office|lab|laboratory|room|building|area)\b/i,
  /\bprivate (?:area|building|residence)\b/i,
];

export function addressPolicyError(address: string, instructions = ""): string | null {
  const combined = `${address} ${instructions}`;
  if (RESTRICTED_LOCATION_TERMS.some((term) => term.test(combined))) {
    return "Choose an accessible public address. Restricted or locked locations cannot be used.";
  }
  if (/\bresidence hall\b/i.test(combined) && !/\b(front desk|lobby|authorized entrance)\b/i.test(combined)) {
    return "For residence halls, meet at the lobby or front desk unless you have authorization to enter.";
  }
  return null;
}

export function resolveMITBuildingQuery(value: string): { query: string; isBuilding: boolean; error: string | null } {
  const match = value.trim().match(/^(?:MIT\s+)?building\s+#?([A-Z]{1,2}\d{1,3}|\d{1,3})(?:\s+(?:and\s+)?(?:building\s*#?)?([A-Z]{1,2}\d{1,3}|\d{1,3}))?(?:\s*,?\s*(?:room|rm\.?)\s*#?[A-Z0-9-]+)?$/i);
  if (!match) return { query: value.trim(), isBuilding: false, error: null };
  const buildingIds = [match[1], match[2]].filter((id): id is string => Boolean(id));
  const invalidNumber = buildingIds.some(id => /^\d+$/.test(id) && (Number(id) < 1 || Number(id) > 76));
  if (invalidNumber) return { query: value, isBuilding: true, error: "Enter an MIT building number from 1 to 76, or a campus building code such as W20." };
  return { query: `MIT Building ${buildingIds[0]}, Cambridge, Massachusetts`, isBuilding: true, error: null };
}

export function isWithinMITCampus(lat: number, lng: number): boolean {
  return lat >= 42.35 && lat <= 42.38 && lng >= -71.13 && lng <= -71.08;
}
