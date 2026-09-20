import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { supabase } from '../../lib/supabase';
import { formatMoney } from '../../lib/currency';
import { logError } from '../../lib/errorLogger';
import { useMarketplaceStore } from '../../store/marketplaceStore';

type ShopProduct = {
  id: string;
  name: string;
  base_price_cents: number;
  business_id: string;
  product_photos: { url: string; position: number }[] | null;
};

interface Props {
  productId: string;
  testID?: string;
}

/**
 * The TikTok-style "yellow basket": a post tagged with a product shows a small
 * card — thumbnail, name, price — that deep-links into the seller's item. This
 * replaces the bare "Shop item" chip.
 *
 * The feed stage is forced dark (`stageColors`), so ink is white/pink on a dark
 * translucent plate rather than theme ink; the price uses the seller's own
 * currency via `useMarketplaceStore`, same as the product page.
 */
export function ShoppableProductCard({ productId, testID = 'feed-cell-shop' }: Props) {
  const businessCurrency = useMarketplaceStore((s) => s.businessCurrency);
  const fetchBusinessCurrency = useMarketplaceStore((s) => s.fetchBusinessCurrency);
  const [product, setProduct] = useState<ShopProduct | null>(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, base_price_cents, business_id, product_photos(url, position)')
        .eq('id', productId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        logError(error, 'shoppableProductCard.load');
        return;
      }
      if (data) {
        setProduct(data as ShopProduct);
        void fetchBusinessCurrency((data as ShopProduct).business_id);
      }
    })();
    return () => { cancelled = true; };
  }, [productId, fetchBusinessCurrency]);

  if (!product) return null;

  const photo = [...(product.product_photos ?? [])].sort((a, b) => a.position - b.position)[0];
  const price = formatMoney(product.base_price_cents, businessCurrency(product.business_id));
  const open = () => {
    const href = Linking.createURL(`/product/${product.id}`);
    if (typeof Linking.openURL === 'function') void Linking.openURL(href);
  };

  const s = StyleSheet.create({
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      alignSelf: 'flex-start', marginBottom: 8, paddingRight: 12,
      borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: 'rgba(20,8,42,0.72)', overflow: 'hidden',
    },
    thumb: { width: 44, height: 44 },
    thumbPlaceholder: {
      width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.10)',
    },
    info: { flex: 1, minWidth: 0, paddingVertical: 6 },
    name: { color: '#fff', fontWeight: '700', fontSize: 13 },
    price: { color: '#FF8FC0', fontWeight: '800', fontSize: 14, marginTop: 1 },
  });

  return (
    <TouchableOpacity
      testID={testID}
      style={s.card}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Shop ${product.name} — ${price}`}
      activeOpacity={0.85}
    >
      {photo?.url ? (
        <Image source={{ uri: photo.url }} style={s.thumb} contentFit="cover" accessibilityLabel={product.name} />
      ) : (
        <View style={s.thumbPlaceholder}>
          <Ionicons name="bag-handle" size={18} color="#FFF8FB" />
        </View>
      )}
      <View style={s.info}>
        <Text style={s.name} numberOfLines={1}>{product.name}</Text>
        <Text style={s.price}>{price}</Text>
      </View>
      <Ionicons name="bag-handle" size={16} color="#FFF8FB" />
    </TouchableOpacity>
  );
}
