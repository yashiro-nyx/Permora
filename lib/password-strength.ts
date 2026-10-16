export type PasswordStrengthLevel = "weak" | "fair" | "good" | "strong";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  /** 0–100 presentation score; not a security guarantee. */
  score: number;
  /** Which of the four meter segments are filled (1–4). */
  filledSegments: 1 | 2 | 3 | 4;
  label: string;
  /** Short, actionable suggestions to improve strength. */
  suggestions: string[];
}

export interface PasswordRequirement {
  id: "length-min" | "length-max" | "different" | "match";
  label: string;
  met: boolean;
}

export interface PasswordChecklistInput {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}

const LEVEL_LABEL: Record<PasswordStrengthLevel, string> = {
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};

const LEVEL_SEGMENTS: Record<PasswordStrengthLevel, 1 | 2 | 3 | 4> = {
  weak: 1,
  fair: 2,
  good: 3,
  strong: 4,
};

// A small, deliberately conservative sample of widely-breached / predictable
// passwords. This is illustrative guidance for the meter only; it is not a
// substitute for a server-side breach check (documented as deferred).
const COMMON_PASSWORDS = new Set([
  "password",
  "passw0rd",
  "password1",
  "123456789012",
  "qwertyuiop",
  "qwerty123456",
  "letmein12345",
  "iloveyou1234",
  "administrator",
  "permora123456",
  "changeme1234",
  "welcome12345",
]);

function hasSequentialRun(value: string): boolean {
  const lower = value.toLowerCase();
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < lower.length; i += 1) {
    const prev = lower.charCodeAt(i - 1);
    const curr = lower.charCodeAt(i);
    ascending = curr === prev + 1 ? ascending + 1 : 1;
    descending = curr === prev - 1 ? descending + 1 : 1;
    if (ascending >= 4 || descending >= 4) return true;
  }
  return false;
}

function hasLongRepeat(value: string): boolean {
  return /(.)\1\1\1/.test(value);
}

function characterVariety(value: string): number {
  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/\d/.test(value)) classes += 1;
  if (/[^A-Za-z0-9]/.test(value)) classes += 1;
  return classes;
}

/**
 * Estimate password strength with a documented, length-dominant heuristic.
 *
 * Rationale: for human-chosen secrets, length and unpredictability matter far
 * more than mandated character classes, so length drives the score, variety
 * gives a modest bonus, and predictable patterns (common passwords, long
 * sequences, repeats, very few distinct characters) apply penalties. The score
 * is for presentation only and never guarantees security.
 */
export function estimatePasswordStrength(password: string): PasswordStrengthResult {
  const suggestions: string[] = [];
  if (!password) {
    return {
      level: "weak",
      score: 0,
      filledSegments: 1,
      label: LEVEL_LABEL.weak,
      suggestions: ["Enter a password of at least 12 characters."],
    };
  }

  const length = password.length;
  // Length contributes up to 60 points (saturates around 20 characters).
  let score = Math.min(60, Math.round((length / 20) * 60));

  const variety = characterVariety(password);
  // Variety contributes up to 24 points (6 per class beyond the first).
  score += Math.min(24, Math.max(0, variety - 1) * 8);

  const distinct = new Set(password).size;
  if (distinct >= 10) score += 8;
  else if (distinct <= 4) {
    score -= 15;
    suggestions.push("Use a wider mix of characters, not just a few repeated ones.");
  }

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) {
    score -= 40;
    suggestions.push("Avoid common or easily guessed passwords.");
  }
  if (hasSequentialRun(password)) {
    score -= 15;
    suggestions.push("Avoid predictable sequences like “abcd” or “1234”.");
  }
  if (hasLongRepeat(password)) {
    score -= 12;
    suggestions.push("Avoid repeating the same character many times.");
  }

  if (length < MIN_PASSWORD_LENGTH)
    suggestions.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  else if (length < 16)
    suggestions.push("A longer passphrase of several words is stronger.");

  score = Math.max(0, Math.min(100, score));

  // A password below the required minimum length can never rate above Weak.
  let level: PasswordStrengthLevel;
  if (length < MIN_PASSWORD_LENGTH || score < 35) level = "weak";
  else if (score < 60) level = "fair";
  else if (score < 80) level = "good";
  else level = "strong";

  if (level === "strong" && suggestions.length === 0)
    suggestions.push("Strong. Keep this password unique to Permora.");

  return {
    level,
    score,
    filledSegments: LEVEL_SEGMENTS[level],
    label: LEVEL_LABEL[level],
    suggestions: suggestions.slice(0, 3),
  };
}

/**
 * Evaluate the mandatory, server-enforced password requirements for the change
 * form. These mirror the server contract (length 12–128, must differ from the
 * current password, confirmation must match) so the client checklist and the
 * backend stay consistent.
 */
export function evaluatePasswordRequirements(
  input: PasswordChecklistInput,
): PasswordRequirement[] {
  const { currentPassword, newPassword, confirmation } = input;
  return [
    {
      id: "length-min",
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      met: newPassword.length >= MIN_PASSWORD_LENGTH,
    },
    {
      id: "length-max",
      label: `No more than ${MAX_PASSWORD_LENGTH} characters`,
      met: newPassword.length > 0 && newPassword.length <= MAX_PASSWORD_LENGTH,
    },
    {
      id: "different",
      label: "Different from your current password",
      met: newPassword.length > 0 && newPassword !== currentPassword,
    },
    {
      id: "match",
      label: "Confirmation matches the new password",
      met: newPassword.length > 0 && newPassword === confirmation,
    },
  ];
}

export function allRequirementsMet(requirements: PasswordRequirement[]): boolean {
  return requirements.every((requirement) => requirement.met);
}
