import { useState } from 'react';
import {
  View, ScrollView, Image, TouchableOpacity,
  Modal, StyleSheet, TouchableWithoutFeedback, useWindowDimensions,
} from 'react-native';
import { BusinessPhoto } from '../../types';
import { useThemeColors } from '../../hooks/useThemeColors';

const THUMB_SIZE = 80;

interface BusinessPhotoGalleryProps {
  photos: BusinessPhoto[];
}

export function BusinessPhotoGallery({ photos }: BusinessPhotoGalleryProps) {
  const colors = useThemeColors();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  const styles = StyleSheet.create({
    row: { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
    thumb: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.92)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    fullImage: {
      height: '70%' as any,
    },
  });

  if (photos.length === 0) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {photos.map((photo) => (
          <TouchableOpacity
            key={photo.id}
            onPress={() => setLightboxUrl(photo.url)}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: photo.url }}
              style={styles.thumb}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal
        visible={lightboxUrl !== null}
        transparent
        animationType="none"
        onRequestClose={() => setLightboxUrl(null)}
      >
        <TouchableWithoutFeedback onPress={() => setLightboxUrl(null)}>
          <View style={styles.overlay}>
            {lightboxUrl && (
              <Image
                source={{ uri: lightboxUrl }}
                style={[styles.fullImage, { width }]}
                resizeMode="contain"
              />
            )}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}

