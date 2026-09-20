import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { create } from 'zustand';
import { AppFeedback, FeatureRequest } from '../types';
import { supabase } from '../lib/supabase';

type FeedbackCategory = AppFeedback['category'];

interface FeedbackState {
  myFeedback: AppFeedback[];
  loadingMyFeedback: boolean;
  submitting: boolean;

  featureRequests: FeatureRequest[];
  loadingFeatures: boolean;
  myVotedFeatureIds: Set<string>;

  submitFeedback: (params: {
    userId: string;
    category: FeedbackCategory;
    message: string;
    rating?: number | null;
    screenContext?: string | null;
  }) => Promise<{ error: string | null }>;

  loadMyFeedback: (userId: string) => Promise<void>;

  loadFeatureRequests: () => Promise<void>;
  loadMyVotes: (userId: string) => Promise<void>;
  pitchFeature: (params: { userId: string; title: string; description?: string }) => Promise<{ error: string | null }>;
  toggleVote: (featureId: string, userId: string) => Promise<void>;
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  myFeedback: [],
  loadingMyFeedback: false,
  submitting: false,

  featureRequests: [],
  loadingFeatures: false,
  myVotedFeatureIds: new Set(),

  submitFeedback: async ({ userId, category, message, rating, screenContext }) => {
    set({ submitting: true });
    const { error } = await supabase.from('app_feedback').insert({
      user_id: userId,
      category,
      message: message.trim(),
      rating: rating ?? null,
      screen_context: screenContext ?? null,
      app_version: Constants.expoConfig?.version ?? null,
      platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
    });
    set({ submitting: false });
    if (error) return { error: error.message };
    await get().loadMyFeedback(userId);
    return { error: null };
  },

  loadMyFeedback: async (userId) => {
    set({ loadingMyFeedback: true });
    const { data } = await supabase
      .from('app_feedback')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    set({ myFeedback: (data as AppFeedback[]) ?? [], loadingMyFeedback: false });
  },

  loadFeatureRequests: async () => {
    set({ loadingFeatures: true });
    const { data } = await supabase
      .from('feature_requests')
      .select('*')
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    set({ featureRequests: (data as FeatureRequest[]) ?? [], loadingFeatures: false });
  },

  loadMyVotes: async (userId) => {
    const { data } = await supabase
      .from('feature_votes')
      .select('feature_id')
      .eq('user_id', userId);
    if (data) {
      set({ myVotedFeatureIds: new Set(data.map((r: any) => r.feature_id)) });
    }
  },

  pitchFeature: async ({ userId, title, description }) => {
    const { error } = await supabase.from('feature_requests').insert({
      title: title.trim(),
      description: description?.trim() || null,
      type: 'pitched',
      created_by: userId,
    });
    if (error) return { error: error.message };
    await get().loadFeatureRequests();
    return { error: null };
  },

  toggleVote: async (featureId, userId) => {
    const hasVoted = get().myVotedFeatureIds.has(featureId);

    // Optimistic update — mirrors buildStore's toggleBookmark pattern
    set((s) => {
      const next = new Set(s.myVotedFeatureIds);
      if (hasVoted) next.delete(featureId); else next.add(featureId);
      return {
        myVotedFeatureIds: next,
        featureRequests: s.featureRequests.map((f) =>
          f.id === featureId
            ? { ...f, vote_count: Math.max(0, f.vote_count + (hasVoted ? -1 : 1)) }
            : f
        ),
      };
    });

    const { error } = hasVoted
      ? await supabase.from('feature_votes').delete().match({ user_id: userId, feature_id: featureId })
      : await supabase
          .from('feature_votes')
          .upsert({ user_id: userId, feature_id: featureId }, { onConflict: 'feature_id,user_id', ignoreDuplicates: true });

    if (error) {
      // Rollback
      set((s) => {
        const next = new Set(s.myVotedFeatureIds);
        if (hasVoted) next.add(featureId); else next.delete(featureId);
        return {
          myVotedFeatureIds: next,
          featureRequests: s.featureRequests.map((f) =>
            f.id === featureId
              ? { ...f, vote_count: Math.max(0, f.vote_count + (hasVoted ? 1 : -1)) }
              : f
          ),
        };
      });
    }
  },
}));
