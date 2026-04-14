import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Linking } from 'react-native';
import { COLORS } from '../../lib/constants';
import { Business, BusinessPhoto } from '../../types';
import { BusinessPhotoGallery } from './BusinessPhotoGallery';

interface BusinessDetailSheetProps {
  business: Business | null;
  photos: BusinessPhoto[];
  isBookmarked: boolean;
  onBookmarkToggle: () => void;
  onClose: () => void;
}

export function BusinessDetailSheet({
  business,
  photos,
  isBookmarked,
  onBookmarkToggle,
  onClose,
}: BusinessDetailSheetProps) {
  const hasLinks = !!(business?.website_url || business?.instagram_handle);

  return (
    <Modal
      visible={business !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {business && (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.handle} />

            {/* Header row */}
            <View style={styles.headerRow}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoText}>{business.name[0].toUpperCase()}</Text>
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.name} numberOfLines={2}>{business.name}</Text>
                {business.is_verified && (
                  <Text style={styles.verifiedBadge}>★ Verified WLW Business</Text>
                )}
                {business.location_city && (
                  <Text style={styles.city}>📍 {business.location_city}</Text>
                )}
              </View>
              <TouchableOpacity
                testID="bookmark-btn"
                onPress={onBookmarkToggle}
                accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                hitSlop={12}
              >
                <Text style={styles.bookmarkIcon}>{isBookmarked ? '💜' : '🤍'}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Photo gallery */}
              {photos.length > 0 && (
                <View testID="photo-gallery">
                  <View style={styles.divider} />
                  <BusinessPhotoGallery photos={photos} />
                  <View style={styles.divider} />
                </View>
              )}

              {/* Description */}
              {business.description && (
                <Text style={styles.description}>{business.description}</Text>
              )}

              {/* Links */}
              {hasLinks && (
                <View style={styles.linksSection}>
                  <Text style={styles.linksHeader}>🔗 Links</Text>
                  {business.website_url && (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(business.website_url!).catch(() => {})}
                      style={styles.linkRow}
                    >
                      <Text style={styles.linkText}>🌐 Website →</Text>
                    </TouchableOpacity>
                  )}
                  {business.instagram_handle && (
                    <TouchableOpacity
                      onPress={() =>
                        Linking.openURL(
                          `https://instagram.com/${business.instagram_handle}`
                        ).catch(() => {})
                      }
                      style={styles.linkRow}
                    >
                      <Text style={styles.linkText}>
                        📸 @{business.instagram_handle} →
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>

            {/* Close button */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.textMuted,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logoText: { color: COLORS.primary, fontWeight: '700', fontSize: 20 },
  headerInfo: { flex: 1, gap: 2 },
  name: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 17 },
  verifiedBadge: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
  city: { color: COLORS.textMuted, fontSize: 12 },
  bookmarkIcon: { fontSize: 22 },
  divider: { height: 1, backgroundColor: COLORS.surface, marginVertical: 4 },
  description: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  linksSection: { paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  linksHeader: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  linkRow: {},
  linkText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
  },
  closeBtnText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
});
