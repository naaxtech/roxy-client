/**
 * What a profile shows under the bio: orientation, interests, then her
 * own labels. The strip collapses the way Instagram does — a few chips,
 * then a tap that opens the rest — so a long list never buries the tabs.
 */

export const RETIRED_PROFILE_CHIPS = new Set(['any/all', 'other', 'Prefer not to say']);

export const MAX_CUSTOM_TAGS = 5;
export const PROFILE_TAG_COLLAPSE_AT = 6;

export type ProfileTagKind = 'identity' | 'interest' | 'custom';

export type ProfileTag = {
  kind: ProfileTagKind;
  label: string;
};

function clean(labels: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels ?? []) {
    const label = raw.trim();
    if (!label || RETIRED_PROFILE_CHIPS.has(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function clampCustomTags(labels: readonly string[] | null | undefined): string[] {
  return clean(labels).slice(0, MAX_CUSTOM_TAGS);
}

export function profileDisplayTags(input: {
  identityLabels?: readonly string[] | null;
  interests?: readonly string[] | null;
  customTags?: readonly string[] | null;
}): ProfileTag[] {
  return [
    ...clean(input.identityLabels).map((label) => ({ kind: 'identity' as const, label })),
    ...clean(input.interests).map((label) => ({ kind: 'interest' as const, label })),
    ...clampCustomTags(input.customTags).map((label) => ({ kind: 'custom' as const, label })),
  ];
}

export function collapseProfileTags(
  tags: readonly ProfileTag[],
  expanded: boolean,
  limit = PROFILE_TAG_COLLAPSE_AT,
): { visible: ProfileTag[]; hidden: number } {
  if (expanded || tags.length <= limit) {
    return { visible: [...tags], hidden: 0 };
  }
  return { visible: tags.slice(0, limit), hidden: tags.length - limit };
}
