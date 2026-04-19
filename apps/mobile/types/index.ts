export interface Profile {
  id: string;
  username: string;
  display_name: string;
  onboarding_completed: boolean;
  bio: string | null;
  avatar_url: string | null;
  pronouns: string[];
  identity_labels: string[];
  is_dating_mode: boolean;
  interests: string[];
  dating_looking_for: string[];
  age_min_pref: number;
  age_max_pref: number;
  location_city: string | null;
  location_country: string | null;
  is_verified: boolean;
  is_active: boolean;
  last_seen_at: string;
  gamification_points: number;
  badge_ids: string[];
  push_token: string | null;
  notification_preferences: Record<string, boolean>;
  is_ghost: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoxyGreeting {
  id: string;
  user_id: string;
  greeting_text: string;
  context_data: Record<string, unknown> | null;
  generated_date: string;
  was_opened: boolean;
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  category: 'identity' | 'interest' | 'location' | 'support';
  is_private: boolean;
  member_count: number;
  created_by: string;
  created_at: string;
}

export interface CommunityMember {
  community_id: string;
  user_id: string;
  role: 'member' | 'moderator' | 'admin';
  joined_at: string;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
}

export interface Conversation {
  id: string;
  participant_ids: string[];
  conversation_type: 'direct' | 'speed_date' | 'sister';
  last_message_at: string | null;
  roxy_nudge_count: number;
  roxy_wingwoman_count_today: number;
  last_roxy_call_date: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string | null;
  media_url: string | null;
  message_type: 'text' | 'image' | 'voice' | 'roxy_suggestion';
  is_read: boolean;
  created_at: string;
  reactions?: MessageReaction[];
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface SpeedDateSession {
  id: string;
  community_id: string | null;
  scheduled_at: string;
  duration_seconds: number;
  participant_ids: string[];
  status: 'scheduled' | 'active' | 'completed';
  daily_room_url: string | null;
  prompts: string[];
  created_at: string;
}

export interface Match {
  id: string;
  user_a_id: string;
  user_b_id: string;
  matched_at: string;
  source: 'speed_date' | 'discover' | 'community';
  conversation_id: string | null;
}

export interface Post {
  id: string;
  author_id: string;
  community_id: string;
  content: string;
  media_urls: string[];
  post_type: 'standard' | 'event' | 'poll' | 'resource';
  is_pinned: boolean;
  is_flagged: boolean;
  reaction_counts: Record<string, number>;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

export interface Event {
  id: string;
  community_id: string | null;
  host_id: string;
  title: string;
  description: string | null;
  event_type: 'online' | 'in_person' | 'hybrid';
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  location_url: string | null;
  max_attendees: number | null;
  attendee_count: number;
  cover_image_url: string | null;
  is_paid: boolean;
  is_private: boolean;
  price_cents: number | null;
  currency: string;
  status: 'active' | 'cancelled' | 'completed';
  payout_delay_days: number | null;
  created_at: string;
}

export interface EventAttendee {
  event_id: string;
  user_id: string;
  status: 'going' | 'interested' | 'maybe';
  ticket_code: string;
  rsvp_at: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
}

export interface Badge {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  category: 'community' | 'connection' | 'milestone' | 'ally';
  points_value: number;
  requirement_type: string;
  requirement_threshold: number;
  created_at: string;
}

export interface CommunityRoom {
  id: string;
  community_id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'live' | 'scheduled' | 'closed';
  scheduled_at: string | null;
  daily_room_url: string | null;
  daily_room_name: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface UserBadgeProgress {
  user_id: string;
  badge_id: string;
  current_value: number;
  earned_at: string | null;
}

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  category: string | null;
  location_city: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  logo_url: string | null;
  is_verified: boolean;
  is_wlw_owned: boolean;
  can_sell?: boolean;
  stripe_account_id?: string | null;
  created_at: string;
}

export interface BusinessPhoto {
  id: string;
  business_id: string;
  url: string;
  sort_order: number;
  created_at: string;
}

export interface ImpactProject {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  category: 'mutual_aid' | 'visibility' | 'education' | 'safety';
  goal_amount: number | null;
  raised_amount: number;
  supporter_count: number;
  status: 'active' | 'completed' | 'paused';
  website_url: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  content_type: string | null;
  content_id: string | null;
  reason: string;
  detail: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  reviewed_by: string | null;
  created_at: string;
}

export interface EdgeFnResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: string | null;
}
