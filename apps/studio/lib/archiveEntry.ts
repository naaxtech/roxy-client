export const ARCHIVE_DELETE_PHRASE = 'DELETE THIS ENTRY';
export const ARCHIVE_DELETE_REASON_MIN = 24;
export const ARCHIVE_PHOTO_MAX = 8;
export const ARCHIVE_MEDIA_TYPES = ['film', 'tv', 'book', 'comic', 'music'] as const;
export const ARCHIVE_STATUSES = ['published', 'pending', 'rejected', 'hidden'] as const;

export type ArchiveMediaType = (typeof ARCHIVE_MEDIA_TYPES)[number];
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export type ArchiveDeleteInput = {
  typedTitle: string;
  liveTitle: string;
  phrase: string;
  reason: string;
  acknowledged: boolean;
};

/** Every gate the danger zone requires before the delete button may enable. */
export function canSubmitArchiveDelete(input: ArchiveDeleteInput): boolean {
  return (
    input.acknowledged &&
    input.typedTitle.trim() === input.liveTitle &&
    input.phrase === ARCHIVE_DELETE_PHRASE &&
    input.reason.trim().length >= ARCHIVE_DELETE_REASON_MIN
  );
}

export function archiveSaveErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not authorised') || m.includes('not authorized')) {
    return 'You are not authorised to edit the Archive. Sign in as Roxy staff or core.';
  }
  if (m.includes('title must be')) return 'Title must be between 1 and 200 characters.';
  if (m.includes('media type')) return 'Choose a media type.';
  if (m.includes('release year')) return 'Year must be between 1800 and 2200.';
  if (m.includes('summary must be')) return 'The summary has to stay under 400 characters.';
  if (m.includes('cover url')) return 'That cover URL is too long.';
  if (m.includes('entry not found')) return 'That entry is gone. Reload the list.';
  if (m.includes('could not find the function') || m.includes('42883') || m.includes('pgrst202')) {
    return 'Archive editing is not switched on for this project yet.';
  }
  return 'Could not save that entry. Please try again.';
}

export function archiveDeleteErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not authorised') || m.includes('not authorized')) {
    return 'You are not authorised to delete Archive entries.';
  }
  if (m.includes('type the entry title')) {
    return 'Type the entry title exactly as it appears now.';
  }
  if (m.includes('delete this entry')) {
    return `Type ${ARCHIVE_DELETE_PHRASE} in capitals, exactly.`;
  }
  if (m.includes('reason')) {
    return `Write a reason of at least ${ARCHIVE_DELETE_REASON_MIN} characters.`;
  }
  if (m.includes('entry not found')) return 'That entry is already gone.';
  if (m.includes('could not find the function') || m.includes('42883') || m.includes('pgrst202')) {
    return 'Archive deletion is not switched on for this project yet.';
  }
  return 'Could not delete that entry. Nothing was removed.';
}

export function archivePhotoErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('at most 8')) return `An entry can hold at most ${ARCHIVE_PHOTO_MAX} photos.`;
  if (m.includes('photo not found')) return 'That photo is already gone. Reload the page.';
  if (m.includes('not authorised') || m.includes('not authorized')) {
    return 'You are not authorised to change Archive photos.';
  }
  return 'Could not update that photo. Please try again.';
}
