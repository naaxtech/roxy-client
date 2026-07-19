import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  RefreshControl, Linking, Share, Modal, ScrollView,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Animated,
} from 'react-native';
import { usePopIn } from '../../../components/ui/popIn';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import { callEdgeFunction } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useBuildStore } from '../../../store/buildStore';
import { REGISTER_BUSINESS_URL } from '../../../lib/constants';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../../hooks/useAppWidth';
import { Business, BusinessPhoto, ImpactProject } from '../../../types';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { useCommunityStore } from '../../../store/communityStore';
import { ChipSearchBar } from '../../../components/build/ChipSearchBar';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';
import { FeatureVoteCard, FeatureRequest } from '../../../components/build/FeatureVoteCard';
import { DonateModal } from '../../../components/donations/DonateModal';

// Vector icons in chrome — never emoji (brand rule).
const categoryIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
  mutual_aid: 'people', visibility: 'flag', education: 'book', safety: 'shield-checkmark',
};

type BuildStyles = ReturnType<typeof buildStyles>;

function BusinessCard({ biz, onPress, styles }: { biz: Business; onPress: () => void; styles: BuildStyles }) {
  return (
    <TouchableOpacity style={styles.bizCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.bizLogo}>
        <Text style={styles.bizLogoText}>{biz.name[0]}</Text>
      </View>
      <Text style={styles.bizName} numberOfLines={1}>{biz.name}</Text>
      {biz.is_wlw_owned && <Text style={styles.wlwBadge}>💜 WLW</Text>}
      {biz.location_city && <Text style={styles.bizCity}>{biz.location_city}</Text>}
      {biz.description && (
        <Text style={styles.bizDesc} numberOfLines={2}>{biz.description}</Text>
      )}
    </TouchableOpacity>
  );
}

function ImpactCard({
  project,
  alreadySupported,
  onSupport,
  onOpenDetail,
  styles,
}: {
  project: ImpactProject;
  alreadySupported: boolean;
  onSupport: () => void;
  onOpenDetail: () => void;
  styles: BuildStyles;
}) {
  const progress = project.goal_amount
    ? Math.min(project.raised_amount / project.goal_amount, 1)
    : null;

  return (
    <TouchableOpacity style={styles.impactCard} onPress={onOpenDetail} activeOpacity={0.85}>
      <View style={styles.impactHeader}>
        <View style={styles.impactIconWrap}>
          <Ionicons name={categoryIcon[project.category] ?? 'sparkles'} size={18} color="#E81C8E" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.impactTitle} numberOfLines={2}>{project.title}</Text>
          <Text style={styles.impactMeta}>{project.supporter_count} supporters</Text>
        </View>
        {project.status === 'active' && (
          <TouchableOpacity
            style={[styles.supportBtn, alreadySupported && styles.supportBtnDone]}
            onPress={(e) => { e?.stopPropagation?.(); onSupport(); }}
            disabled={alreadySupported}
          >
            <Text style={styles.supportBtnText}>
              {alreadySupported ? '✓ Supported' : 'Support'}
            </Text>
          </TouchableOpacity>
        )}
        {project.status === 'completed' && (
          <View style={styles.completedBadge}>
            <Text style={styles.completedText}>✓ Done</Text>
          </View>
        )}
      </View>
      {project.description && (
        <Text style={styles.impactDesc} numberOfLines={2}>{project.description}</Text>
      )}
      {progress !== null && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>
      )}
      {project.goal_amount ? (
        <Text style={styles.progressLabel}>
          £{project.raised_amount.toLocaleString()} of £{project.goal_amount.toLocaleString()} raised
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

function ImpactDetailSheet({
  project,
  alreadySupported,
  onSupport,
  onClose,
  styles,
}: {
  project: ImpactProject | null;
  alreadySupported: boolean;
  onSupport: () => void;
  onClose: () => void;
  styles: BuildStyles;
}) {
  const pop = usePopIn(project !== null);
  const handleWebsite = () => {
    if (project?.website_url) Linking.openURL(project.website_url).catch(() => {});
  };
  const handleShare = () => {
    Share.share({ message: `Check out ${project?.title} on Roxy!` }).catch(() => {});
  };

  return (
    <Modal
      testID="impact-detail-modal"
      visible={project !== null}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      {project && (
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalCard, pop]}>
            <TouchableOpacity
              testID="modal-close-btn"
              style={styles.modalCloseBtn}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} style={styles.modalCloseBtnText} />
            </TouchableOpacity>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.impactIconWrap, { alignSelf: 'center', width: 52, height: 52, borderRadius: 26 }]}>
                <Ionicons name={categoryIcon[project.category] ?? 'sparkles'} size={26} color="#E81C8E" />
              </View>
              <Text style={styles.modalTitle}>{project.title}</Text>
              <Text style={styles.modalMeta}>{project.supporter_count} supporters</Text>
              {project.description ? (
                <Text style={styles.modalDesc}>{project.description}</Text>
              ) : null}
              {project.website_url ? (
                <TouchableOpacity style={styles.modalWebsiteBtn} onPress={handleWebsite}>
                  <Text style={styles.modalWebsiteBtnText}>Visit website →</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                testID="modal-share-btn"
                style={styles.modalShareBtn}
                onPress={handleShare}
              >
                <Text style={styles.modalShareBtnText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="modal-support-cta"
                style={[styles.modalCtaBtn, alreadySupported && styles.modalCtaBtnDone]}
                onPress={onSupport}
                disabled={alreadySupported}
              >
                <Text style={styles.modalCtaBtnText}>
                  {alreadySupported ? '✓ Supported' : "I'll support this project 💜"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}

function buildStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    segmentRow: {
      flexDirection: 'row', gap: 6,
      marginHorizontal: 16, marginBottom: 10, padding: 4,
      backgroundColor: colors.surface, borderRadius: 14,
    },
    segmentBtn: {
      flex: 1, minHeight: 38, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
    },
    segmentBtnActive: { backgroundColor: colors.roxy },
    segmentText: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
    segmentTextActive: { color: '#fff' },
    bizViewToggle: {
      flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, gap: 8,
    },
    bizViewBtn: {
      paddingHorizontal: 14, paddingVertical: 6,
      borderRadius: 20, backgroundColor: colors.surface,
    },
    bizViewBtnActive: { backgroundColor: colors.primary + '25', borderWidth: 1, borderColor: colors.primary },
    bizViewText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    bizViewTextActive: { color: colors.primary },
    filterWrapper: { paddingBottom: 8 },
    wlwToggle: {
      marginHorizontal: 12, marginTop: 6,
      backgroundColor: colors.surface, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1, borderColor: 'transparent', alignSelf: 'flex-start',
    },
    wlwToggleActive: { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
    wlwToggleText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    gridContent: { padding: 8 },
    listContent: { padding: 16 },
    bizCard: {
      flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14,
      margin: 4, gap: 4,
    },
    bizLogo: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: colors.primary + '30', alignItems: 'center', justifyContent: 'center',
      marginBottom: 4,
    },
    bizLogoText: { color: colors.primary, fontWeight: '700', fontSize: 18 },
    bizName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    wlwBadge: { color: colors.secondary, fontSize: 11, fontWeight: '600' },
    bizCity: { color: colors.textMuted, fontSize: 11 },
    bizDesc: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
    impactCard: {
      backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, gap: 8,
    },
    impactHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    impactIconWrap: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: '#E81C8E' + '14',
      alignItems: 'center', justifyContent: 'center',
    },
    impactTitle: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    impactMeta: { color: colors.textMuted, fontSize: 12 },
    impactDesc: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    supportBtn: {
      backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    },
    supportBtnDone: { backgroundColor: colors.success },
    supportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    completedBadge: {
      backgroundColor: colors.success + '20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    },
    completedText: { color: colors.success, fontWeight: '700', fontSize: 12 },
    progressTrack: { height: 6, backgroundColor: colors.surfaceLight, borderRadius: 3, overflow: 'hidden' },
    progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
    progressLabel: { color: colors.textMuted, fontSize: 11 },
    empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
    emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    emptySubtitle: { color: colors.textMuted, fontSize: 14 },
    registerFooter: {
      alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 4,
    },
    registerFooterText: { color: colors.textMuted, fontSize: 13 },
    registerFooterLink: { color: colors.primary, fontSize: 14, fontWeight: '700' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 40, maxHeight: '85%',
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
    },
    modalCloseBtn: { alignSelf: 'flex-end', padding: 8, marginBottom: 8 },
    modalCloseBtnText: { color: colors.textMuted, fontSize: 18, fontWeight: '700' },
    modalEmoji: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
    modalTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 22, textAlign: 'center', marginBottom: 4 },
    modalMeta: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 16 },
    modalDesc: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 20 },
    modalWebsiteBtn: { marginBottom: 12 },
    modalWebsiteBtnText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
    modalShareBtn: {
      backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12,
      alignItems: 'center', marginBottom: 12,
    },
    modalShareBtnText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    modalCtaBtn: {
      backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
      alignItems: 'center', marginBottom: 12,
    },
    modalCtaBtnDone: { backgroundColor: colors.success },
    modalCtaBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

    // Support Roxy
    supportContainer: { flex: 1 },
    donateBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      marginHorizontal: 12, marginTop: 12, padding: 12,
      backgroundColor: colors.surface, borderRadius: 14,
    },
    donateBannerEmoji: { fontSize: 24 },
    donateBannerTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    donateBannerSub: { color: colors.textMuted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
    supportTabRow: {
      flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    supportTabBtn: {
      paddingHorizontal: 14, paddingVertical: 7,
      borderRadius: 20, backgroundColor: colors.surface,
    },
    supportTabBtnActive: {
      backgroundColor: `${colors.primary}25`,
      borderWidth: 1, borderColor: colors.primary,
    },
    supportTabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    supportTabTextActive: { color: colors.primary },
    supportListContent: { paddingTop: 12, paddingBottom: 100 },
    supportLoadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
    pitchFab: {
      position: 'absolute', bottom: 24, right: 20,
      backgroundColor: colors.primary, borderRadius: 28,
      paddingHorizontal: 20, paddingVertical: 14,
      shadowColor: colors.primary, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    pitchFabText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    pitchModalCard: {
      backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 40,
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
    },
    pitchModalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
    pitchModalSubtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 20, lineHeight: 20 },
    pitchLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
    pitchInput: {
      backgroundColor: colors.surface, borderRadius: 12,
      padding: 14, color: colors.textPrimary, fontSize: 15,
      marginBottom: 16, borderWidth: 1, borderColor: 'transparent',
    },
    pitchInputMulti: { height: 100, textAlignVertical: 'top' },
    pitchError: { color: colors.error, fontSize: 13, marginBottom: 12, fontWeight: '600' },
    pitchSubmitBtn: {
      backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15,
      alignItems: 'center', marginTop: 4,
    },
    pitchSubmitBtnDisabled: { opacity: 0.6 },
    pitchSubmitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });
}

export default function BuildScreen() {
  const colors = useThemeColors();
  const styles = buildStyles(colors);
  const { user } = useAuthStore();
  const {
    businesses, impactProjects, loading,
    setImpactProjects, setLoading,
    bookmarkedBusinessIds, supportedProjectIds,
    searchChips, addSearchChip, removeSearchChip,
    loadBookmarks, loadSupports, toggleBookmark, supportProject, loadBusinesses,
  } = useBuildStore();
  const { selectedCommunityId } = useCommunityFilterStore();
  const { joinedCommunities } = useCommunityStore();

  const [segment, setSegment] = useState<'businesses' | 'impact' | 'support'>('businesses');
  const [bizView, setBizView] = useState<'all' | 'saved'>('all');
  const [wlwOnly, setWlwOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ImpactProject | null>(null);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [bizPhotos, setBizPhotos] = useState<BusinessPhoto[]>([]);

  // Support Roxy — feature voting
  const [supportTab, setSupportTab] = useState<'planned' | 'pitched'>('planned');
  const [features, setFeatures] = useState<FeatureRequest[]>([]);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [supportLoading, setSupportLoading] = useState(false);
  const [pitchModal, setPitchModal] = useState(false);
  const pitchPop = usePopIn(pitchModal);
  const [pitchTitle, setPitchTitle] = useState('');
  const [pitchDesc, setPitchDesc] = useState('');
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [pitchSubmitting, setPitchSubmitting] = useState(false);
  const [pitchError, setPitchError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getCommunityMemberIds = useCallback(async (): Promise<string[] | undefined> => {
    if (!selectedCommunityId) return undefined;
    try {
      const { data: members, error } = await supabase
        .from('community_members')
        .select('user_id')
        .eq('community_id', selectedCommunityId);
      if (error) return undefined;
      return (members ?? []).map((m: any) => m.user_id);
    } catch {
      return undefined;
    }
  }, [selectedCommunityId]);

  const fetchBusinesses = useCallback(async (chips: string[], wlw: boolean) => {
    const memberIds = await getCommunityMemberIds();
    await loadBusinesses(chips, wlw, memberIds);
  }, [getCommunityMemberIds, loadBusinesses]);

  const triggerBizLoad = useCallback((chips: string[], wlw: boolean) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchBusinesses(chips, wlw), 300);
  }, [fetchBusinesses]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const loadProjects = useCallback(async () => {
    const memberIds = await getCommunityMemberIds();
    let query = supabase.from('impact_projects').select('*');
    if (memberIds && memberIds.length > 0) query = query.in('creator_id', memberIds);
    const { data } = await query.order('status').order('created_at', { ascending: false }).limit(30);
    setImpactProjects((data as ImpactProject[]) ?? []);
  }, [getCommunityMemberIds, setImpactProjects]);

  const loadFeatures = useCallback(async () => {
    setSupportLoading(true);
    try {
      const res = await callEdgeFunction<{ features: FeatureRequest[]; voted_ids: string[] }>(
        'feature-vote', { action: 'list' }
      );
      if (res?.data?.features) {
        setFeatures(res.data.features);
        setVotedIds(new Set(res.data.voted_ids));
      }
    } catch {
      // non-fatal
    } finally {
      setSupportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    Promise.all([
      fetchBusinesses(searchChips, wlwOnly),
      loadProjects(),
      loadBookmarks(user.id),
      loadSupports(user.id),
    ]).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCommunityId]);

  useEffect(() => {
    triggerBizLoad(searchChips, wlwOnly);
  }, [searchChips, wlwOnly, triggerBizLoad]);

  useEffect(() => {
    if (segment === 'support' && features.length === 0) {
      loadFeatures();
    }
  }, [segment, features.length, loadFeatures]);

  const handleFeatureVote = async (featureId: string) => {
    const res = await callEdgeFunction<{ voted: boolean; vote_count: number }>(
      'feature-vote', { action: 'vote', feature_id: featureId }
    );
    if (res?.data) {
      const { voted, vote_count } = res.data;
      setVotedIds((prev) => {
        const next = new Set(prev);
        if (voted) next.add(featureId); else next.delete(featureId);
        return next;
      });
      setFeatures((prev) =>
        prev.map((f) => f.id === featureId ? { ...f, vote_count } : f)
      );
    }
  };

  const handlePitchSubmit = async () => {
    const trimTitle = pitchTitle.trim();
    if (trimTitle.length < 3) { setPitchError('Title must be at least 3 characters'); return; }
    setPitchError(null);
    setPitchSubmitting(true);
    try {
      const res = await callEdgeFunction<{ id: string; title: string }>(
        'feature-vote', {
          action: 'pitch',
          title: trimTitle,
          description: pitchDesc.trim() || undefined,
        }
      );
      if (res?.data?.id) {
        setPitchModal(false);
        setPitchTitle('');
        setPitchDesc('');
        await loadFeatures();
      } else {
        setPitchError('Failed to submit. Please try again.');
      }
    } catch {
      setPitchError('Failed to submit. Please try again.');
    } finally {
      setPitchSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    if (!user?.id) return;
    setRefreshing(true);
    await Promise.all([
      fetchBusinesses(searchChips, wlwOnly),
      loadProjects(),
      loadBookmarks(user.id),
      loadSupports(user.id),
    ]);
    setRefreshing(false);
  };

  const handleSupport = async (projectId: string) => {
    if (!user?.id) return;
    await supportProject(projectId, user.id);
  };

  const handleOpenBiz = async (biz: Business) => {
    setSelectedBiz(biz);
    const { data } = await supabase
      .from('business_photos')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order');
    setBizPhotos((data as BusinessPhoto[]) ?? []);
  };

  const displayedBiz = bizView === 'saved'
    ? businesses.filter((b) => bookmarkedBusinessIds.has(b.id))
    : businesses;

  const RegisterFooter = () => (
    <TouchableOpacity
      style={styles.registerFooter}
      onPress={() => Linking.openURL(REGISTER_BUSINESS_URL).catch(() => {})}
    >
      <Text style={styles.registerFooterText}>Want your business listed here?</Text>
      <Text style={styles.registerFooterLink}>→ Register your business</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Build"
        eyebrow="The WLW economy"
        actions={<CommunityContextSwitcher communities={joinedCommunities} />}
      />

      <View style={styles.segmentRow}>
        {(['businesses', 'impact', 'support'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            testID={`segment-${s}`}
            style={[styles.segmentBtn, segment === s && styles.segmentBtnActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'businesses' ? 'Businesses' : s === 'impact' ? 'Impact' : '✦ Support'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {segment === 'businesses' && (
        <>
          <View style={styles.bizViewToggle}>
            {(['all', 'saved'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.bizViewBtn, bizView === v && styles.bizViewBtnActive]}
                onPress={() => setBizView(v)}
              >
                <Text style={[styles.bizViewText, bizView === v && styles.bizViewTextActive]}>
                  {v === 'all' ? 'All' : '💜 Saved'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.filterWrapper}>
            <ChipSearchBar
              chips={searchChips}
              onAddChip={addSearchChip}
              onRemoveChip={removeSearchChip}
            />
            <TouchableOpacity
              style={[styles.wlwToggle, wlwOnly && styles.wlwToggleActive]}
              onPress={() => setWlwOnly((v) => !v)}
            >
              <Text style={styles.wlwToggleText}>💜 WLW only</Text>
            </TouchableOpacity>
          </View>

          <FlashList
            data={displayedBiz}
            keyExtractor={(item) => item.id}
            numColumns={2}
            estimatedItemSize={180}
            renderItem={({ item }) => (
              <BusinessCard biz={item} onPress={() => handleOpenBiz(item)} styles={styles} />
            )}
            contentContainerStyle={styles.gridContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.roxy} />
            }
            ListFooterComponent={<RegisterFooter />}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No businesses found</Text>
                  <Text style={styles.emptySubtitle}>Try different search terms</Text>
                </View>
              )
            }
          />
        </>
      )}

      {segment === 'impact' && (
        <FlashList
          data={impactProjects}
          keyExtractor={(item) => item.id}
          estimatedItemSize={130}
          renderItem={({ item }) => (
            <ImpactCard
              project={item}
              alreadySupported={supportedProjectIds.has(item.id)}
              onSupport={() => handleSupport(item.id)}
              onOpenDetail={() => setSelectedProject(item)}
              styles={styles}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.roxy} />
          }
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No projects yet</Text>
              </View>
            )
          }
        />
      )}

      {segment === 'support' && (
        <View style={styles.supportContainer}>
          {/* Keep Roxy alive — donation banner */}
          <TouchableOpacity
            style={styles.donateBanner}
            onPress={() => setShowDonateModal(true)}
            activeOpacity={0.85}
            testID="keep-roxy-alive-banner"
            accessibilityLabel="Keep Roxy alive"
          >
            <Text style={styles.donateBannerEmoji}>💜</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.donateBannerTitle}>Keep Roxy alive 💜</Text>
              <Text style={styles.donateBannerSub}>Roxy is built and owned by WLW — a donation helps keep it that way.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Sub-tab: Planned / Pitched */}
          <View style={styles.supportTabRow}>
            {(['planned', 'pitched'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.supportTabBtn, supportTab === t && styles.supportTabBtnActive]}
                onPress={() => setSupportTab(t)}
              >
                <Text style={[styles.supportTabText, supportTab === t && styles.supportTabTextActive]}>
                  {t === 'planned' ? '💜 Roxy Picks' : '💡 Community Pitches'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Feature list */}
          {supportLoading ? (
            <View style={styles.supportLoadingWrap}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <FlashList
              data={features.filter((f) => f.type === supportTab)}
              keyExtractor={(item) => item.id}
              estimatedItemSize={90}
              renderItem={({ item }) => (
                <FeatureVoteCard
                  feature={item}
                  voted={votedIds.has(item.id)}
                  onVote={handleFeatureVote}
                />
              )}
              contentContainerStyle={styles.supportListContent}
              refreshControl={
                <RefreshControl refreshing={false} onRefresh={loadFeatures} tintColor={colors.roxy} />
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>
                    {supportTab === 'planned' ? 'No picks yet' : 'No pitches yet'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {supportTab === 'pitched' ? 'Be the first to pitch an idea!' : ''}
                  </Text>
                </View>
              }
            />
          )}

          {/* FAB — pitch new idea */}
          {supportTab === 'pitched' && (
            <TouchableOpacity
              style={styles.pitchFab}
              onPress={() => setPitchModal(true)}
              accessibilityLabel="Pitch a new feature idea"
            >
              <Text style={styles.pitchFabText}>+ Pitch an idea</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Pitch submission modal */}
      <Modal
        visible={pitchModal}
        animationType="none"
        transparent
        onRequestClose={() => setPitchModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <Animated.View style={[styles.pitchModalCard, pitchPop]}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setPitchModal(false)}>
              <Ionicons name="close" size={20} style={styles.modalCloseBtnText} />
            </TouchableOpacity>
            <Text style={styles.pitchModalTitle}>💡 Pitch a Feature</Text>
            <Text style={styles.pitchModalSubtitle}>
              Got an idea for Roxy? Let the community vote on it.
            </Text>
            <Text style={styles.pitchLabel}>Title *</Text>
            <TextInput
              style={styles.pitchInput}
              placeholder="Short and clear (e.g. 'Group video calls')"
              placeholderTextColor={colors.textMuted}
              value={pitchTitle}
              onChangeText={setPitchTitle}
              maxLength={200}
            />
            <Text style={styles.pitchLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.pitchInput, styles.pitchInputMulti]}
              placeholder="Why would this make Roxy better?"
              placeholderTextColor={colors.textMuted}
              value={pitchDesc}
              onChangeText={setPitchDesc}
              maxLength={1000}
              multiline
              numberOfLines={4}
            />
            {pitchError && <Text style={styles.pitchError}>{pitchError}</Text>}
            <TouchableOpacity
              style={[styles.pitchSubmitBtn, pitchSubmitting && styles.pitchSubmitBtnDisabled]}
              onPress={handlePitchSubmit}
              disabled={pitchSubmitting}
            >
              {pitchSubmitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.pitchSubmitBtnText}>Submit Pitch 💜</Text>
              }
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <BusinessDetailSheet
        business={selectedBiz}
        photos={bizPhotos}
        isBookmarked={selectedBiz ? bookmarkedBusinessIds.has(selectedBiz.id) : false}
        onBookmarkToggle={() => selectedBiz && user?.id && toggleBookmark(selectedBiz.id, user.id)}
        onClose={() => { setSelectedBiz(null); setBizPhotos([]); }}
      />

      <ImpactDetailSheet
        project={selectedProject}
        alreadySupported={selectedProject ? supportedProjectIds.has(selectedProject.id) : false}
        onSupport={() => selectedProject && handleSupport(selectedProject.id)}
        onClose={() => setSelectedProject(null)}
        styles={styles}
      />

      <DonateModal visible={showDonateModal} onClose={() => setShowDonateModal(false)} />
    </SafeAreaView>
  );
}
