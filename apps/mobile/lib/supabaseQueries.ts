/** PostgREST select fragments — explicit FKs avoid ambiguous embed errors. */

export const POST_WITH_AUTHOR =
  '*, profiles!posts_author_id_fkey(display_name, avatar_url)';

export const POST_WITH_AUTHOR_AND_COMMUNITY =
  `${POST_WITH_AUTHOR}, communities!posts_community_id_fkey(name)`;

export const COMMENT_WITH_AUTHOR =
  '*, profiles!comments_author_id_fkey(display_name, avatar_url)';
