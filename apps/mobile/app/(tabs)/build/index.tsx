import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  RefreshControl, Linking, Share, Modal, ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useBuildStore } from '../../../store/buildStore';
import { COLORS, REGISTER_BUSINESS_URL } from '../../../lib/constants';
import { Business, BusinessPhoto, ImpactProject } from '../../../types';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { useCommunityStore } from '../../../store/communityStore';
import { ChipSearchBar } from '../../../components/build/ChipSearchBar';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';

const categoryEmoji: Record<string, string> = {
  mutual_aid: '🤝', visibility: '🏳️‍🌈', education: '📚', safety: '🛡️',
};

function BusinessCard({ biz, onPress }: { biz: Business; onPress: () => void }) {
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
}: {
  project: ImpactProject;
  alreadySupported: boolean;
  onSupport: () => void;
  onOpenDetail: () => void;
}) {
  const progress = project.goal_amount
    ? Math.min(project.raised_amount / project.goal_amount, 1)
    : null;

  return (
    <TouchableOpacity style={styles.impactCard} onPress={onOpenDetail} activeOpacity={0.85}>
      <View style={styles.impactHeader}>
        <Text style={styles.impactEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
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
}: {
  project: ImpactProject | null;
  alreadySupported: boolean;
  onSupport: () => void;
  onClose: () => void;
}) {
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
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {project && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity
              testID="modal-close-btn"
              style={styles.modalCloseBtn}
              onPress={onClose}
            >
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
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
          </View>
        </View>
      )}
    </Modal>
  );
}

export default function BuildScreen() {
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

  const [segment, setSegment] = useState<'businesses' | 'impact'>('businesses');
  const [bizView, setBizView] = useState<'all' | 'saved'>('all');
  const [wlwOnly, setWlwOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ImpactProject | null>(null);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [bizPhotos, setBizPhotos] = useState<BusinessPhoto[]>([]);

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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Build</Text>
        <CommunityContextSwitcher communities={joinedCommunities} />
      </View>

      <View style={styles.segmentRow}>
        {(['businesses', 'impact'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            testID={`segment-${s}`}
            style={[styles.segmentBtn, segment === s && styles.segmentBtnActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'businesses' ? 'Businesses' : 'Impact'}
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
              <BusinessCard biz={item} onPress={() => handleOpenBiz(item)} />
            )}
            contentContainerStyle={styles.gridContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />
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
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />
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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  segmentRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    paddingHorizontal: 16, gap: 4,
  },
  segmentBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: { borderBottomColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: COLORS.textPrimary },
  bizViewToggle: {
    flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, gap: 8,
  },
  bizViewBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, backgroundColor: COLORS.surface,
  },
  bizViewBtnActive: { backgroundColor: COLORS.primary + '25', borderWidth: 1, borderColor: COLORS.primary },
  bizViewText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  bizViewTextActive: { color: COLORS.primary },
  filterWrapper: { paddingBottom: 8 },
  wlwToggle: {
    marginHorizontal: 12, marginTop: 6,
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent', alignSelf: 'flex-start',
  },
  wlwToggleActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '20' },
  wlwToggleText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  gridContent: { padding: 8 },
  listContent: { padding: 16 },
  bizCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    margin: 4, gap: 4,
  },
  bizLogo: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary + '30', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  bizLogoText: { color: COLORS.primary, fontWeight: '700', fontSize: 18 },
  bizName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  wlwBadge: { color: COLORS.secondary, fontSize: 11, fontWeight: '600' },
  bizCity: { color: COLORS.textMuted, fontSize: 11 },
  bizDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  impactCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10, gap: 8,
  },
  impactHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  impactEmoji: { fontSize: 22 },
  impactTitle: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  impactMeta: { color: COLORS.textMuted, fontSize: 12 },
  impactDesc: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  supportBtn: {
    backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  supportBtnDone: { backgroundColor: COLORS.success },
  supportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  completedBadge: {
    backgroundColor: COLORS.success + '20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  completedText: { color: COLORS.success, fontWeight: '700', fontSize: 12 },
  progressTrack: { height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: COLORS.primary, borderRadius: 3 },
  progressLabel: { color: COLORS.textMuted, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  emptySubtitle: { color: COLORS.textMuted, fontSize: 14 },
  registerFooter: {
    alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 4,
  },
  registerFooterText: { color: COLORS.textMuted, fontSize: 13 },
  registerFooterLink: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalCloseBtn: { alignSelf: 'flex-end', padding: 8, marginBottom: 8 },
  modalCloseBtnText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  modalEmoji: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  modalTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 22, textAlign: 'center', marginBottom: 4 },
  modalMeta: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  modalDesc: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  modalWebsiteBtn: { marginBottom: 12 },
  modalWebsiteBtnText: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
  modalShareBtn: {
    backgroundColor: COLORS.surface, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', marginBottom: 12,
  },
  modalShareBtnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  modalCtaBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  modalCtaBtnDone: { backgroundColor: COLORS.success },
  modalCtaBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
