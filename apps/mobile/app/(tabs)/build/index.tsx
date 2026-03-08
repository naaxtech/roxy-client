import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, RefreshControl, Linking,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useBuildStore } from '../../../store/buildStore';
import { COLORS } from '../../../lib/constants';
import { Business, ImpactProject } from '../../../types';

function BusinessCard({ biz }: { biz: Business }) {
  const handleVisit = () => {
    if (biz.website_url) Linking.openURL(biz.website_url).catch(() => {});
  };
  return (
    <View style={styles.bizCard}>
      <View style={styles.bizLogo}>
        <Text style={styles.bizLogoText}>{biz.name[0]}</Text>
      </View>
      <Text style={styles.bizName} numberOfLines={1}>{biz.name}</Text>
      {biz.is_wlw_owned && <Text style={styles.wlwBadge}>💜 WLW</Text>}
      {biz.location_city && <Text style={styles.bizCity}>{biz.location_city}</Text>}
      {biz.description && <Text style={styles.bizDesc} numberOfLines={2}>{biz.description}</Text>}
      {biz.website_url && (
        <TouchableOpacity style={styles.visitBtn} onPress={handleVisit}>
          <Text style={styles.visitBtnText}>Visit →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ImpactCard({ project, onSupport, alreadySupported = false }: { project: ImpactProject; onSupport: () => void; alreadySupported?: boolean }) {
  const progress = project.goal_amount
    ? Math.min(project.raised_amount / project.goal_amount, 1)
    : null;

  const categoryEmoji: Record<string, string> = {
    mutual_aid: '🤝', visibility: '🏳️‍🌈', education: '📚', safety: '🛡️',
  };

  return (
    <View style={styles.impactCard}>
      <View style={styles.impactHeader}>
        <Text style={styles.impactEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.impactTitle} numberOfLines={2}>{project.title}</Text>
          <Text style={styles.impactMeta}>{project.supporter_count} supporters</Text>
        </View>
        {project.status === 'active' && (
          <TouchableOpacity
            style={[styles.supportBtn, alreadySupported && styles.supportBtnDone]}
            onPress={onSupport}
            disabled={alreadySupported}
          >
            <Text style={styles.supportBtnText}>{alreadySupported ? '✓ Supported' : 'Support'}</Text>
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
    </View>
  );
}

export default function BuildScreen() {
  const { user } = useAuthStore();
  const { businesses, impactProjects, loading, setBusinesses, setImpactProjects, setLoading, incrementSupporter } = useBuildStore();

  const [segment, setSegment] = useState<'businesses' | 'impact'>('businesses');
  const [search, setSearch] = useState('');
  const [wlwOnly, setWlwOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [supportedIds, setSupportedIds] = useState<Set<string>>(new Set());

  const loadBusinesses = useCallback(async () => {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .order('is_verified', { ascending: false })
      .order('name')
      .limit(50);
    setBusinesses((data as Business[]) ?? []);
  }, [setBusinesses]);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from('impact_projects')
      .select('*')
      .order('status')
      .order('created_at', { ascending: false })
      .limit(30);
    setImpactProjects((data as ImpactProject[]) ?? []);
  }, [setImpactProjects]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadBusinesses(), loadProjects()]).finally(() => setLoading(false));
  }, [loadBusinesses, loadProjects, setLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setSearch('');
    await Promise.all([loadBusinesses(), loadProjects()]);
    setRefreshing(false);
  };

  const handleSupport = async (project: ImpactProject) => {
    if (!user || supportedIds.has(project.id)) return;
    setSupportedIds((prev) => new Set([...prev, project.id]));
    incrementSupporter(project.id);
    await supabase
      .from('impact_projects')
      .update({ supporter_count: project.supporter_count + 1 })
      .eq('id', project.id)
      .catch(() => {});
  };

  const filteredBiz = businesses.filter((b) => {
    if (wlwOnly && !b.is_wlw_owned) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.segmentRow}>
        {(['businesses', 'impact'] as const).map((s) => (
          <TouchableOpacity
            key={s}
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
          <View style={styles.filterRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search businesses…"
              placeholderTextColor={COLORS.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            <TouchableOpacity
              style={[styles.wlwToggle, wlwOnly && styles.wlwToggleActive]}
              onPress={() => setWlwOnly((v) => !v)}
            >
              <Text style={styles.wlwToggleText}>💜 WLW only</Text>
            </TouchableOpacity>
          </View>
          <FlashList
            data={filteredBiz}
            keyExtractor={(item) => item.id}
            numColumns={2}
            estimatedItemSize={180}
            renderItem={({ item }) => <BusinessCard biz={item} />}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No businesses yet</Text>
                  <Text style={styles.emptySub}>Be the first to list your business.</Text>
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
              onSupport={() => handleSupport(item)}
              alreadySupported={supportedIds.has(item.id)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No projects yet</Text>
                <Text style={styles.emptySub}>Start an impact project for the community.</Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  segmentRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    paddingHorizontal: 16, gap: 4,
  },
  segmentBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: { borderBottomColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: COLORS.textPrimary },
  filterRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    color: COLORS.textPrimary, fontSize: 14,
  },
  wlwToggle: {
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent',
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
  visitBtn: { marginTop: 4 },
  visitBtnText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  impactCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, gap: 8,
  },
  impactHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  impactEmoji: { fontSize: 22 },
  impactTitle: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  impactMeta: { color: COLORS.textMuted, fontSize: 12 },
  impactDesc: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  supportBtn: {
    backgroundColor: COLORS.primary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  supportBtnDone: { backgroundColor: COLORS.success },
  supportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  completedBadge: {
    backgroundColor: COLORS.success + '20', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  completedText: { color: COLORS.success, fontWeight: '700', fontSize: 12 },
  progressTrack: {
    height: 6, backgroundColor: COLORS.surfaceLight,
    borderRadius: 3, overflow: 'hidden',
  },
  progressFill: { height: 6, backgroundColor: COLORS.primary, borderRadius: 3 },
  progressLabel: { color: COLORS.textMuted, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  emptySub: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },
});
