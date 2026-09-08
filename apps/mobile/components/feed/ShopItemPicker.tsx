import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, StyleSheet, Animated,
} from 'react-native';
import { usePopIn } from '../ui/popIn';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { logError } from '../../lib/errorLogger';

export type ShopItemSelection = {
  productId: string;
  label: string;
};

type ProductRow = { id: string; name: string; base_price_cents: number };

interface Props {
  visible: boolean;
  userId: string;
  onSelect: (selection: ShopItemSelection) => void;
  onClose: () => void;
}

function priceLabel(cents: number): string {
  return `£${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Community / seller shop tag. Claude Design hangs `shop: { pid, lbl }` on a
 * regular video or photo — this is that picker.
 */
export function ShopItemPicker({ visible, userId, onSelect, onClose }: Props) {
  const colors = useThemeColors();
  const pop = usePopIn(visible);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ProductRow[]>([]);

  useEffect(() => {
    if (!visible || !userId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data: shops, error: shopErr } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_id', userId);
      if (shopErr) {
        logError(shopErr, 'ShopItemPicker.businesses');
        if (!cancelled) { setItems([]); setLoading(false); }
        return;
      }
      const ids = (shops ?? []).map((row) => row.id);
      if (ids.length === 0) {
        if (!cancelled) { setItems([]); setLoading(false); }
        return;
      }
      const { data, error } = await supabase
        .from('products')
        .select('id, name, base_price_cents')
        .in('business_id', ids)
        .eq('is_active', true)
        .eq('status', 'approved')
        .order('name');
      if (error) logError(error, 'ShopItemPicker.products');
      if (!cancelled) {
        setItems((data ?? []) as ProductRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, userId]);

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      maxHeight: '75%', paddingBottom: 40,
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
    },
    handle: {
      width: 40, height: 4, backgroundColor: colors.textMuted,
      borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8,
    },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    title: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    name: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    price: { color: colors.textMuted, fontSize: 13, marginRight: 8 },
    empty: { color: colors.textMuted, textAlign: 'center', padding: 40, fontSize: 14 },
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.sheet, pop]} testID="shop-item-picker">
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Tag a shop item</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ padding: 40 }} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>
            No live products yet. Add one to your shop first.
          </Text>
        ) : (
          <ScrollView>
            {items.map((item) => {
              const label = `${item.name} · ${priceLabel(item.base_price_cents)}`;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.row}
                  testID={`shop-item-${item.id}`}
                  onPress={() => onSelect({ productId: item.id, label })}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                >
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.price}>{priceLabel(item.base_price_cents)}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}
