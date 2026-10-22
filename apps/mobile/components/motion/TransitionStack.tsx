import { useEffect, useMemo, type ComponentProps } from 'react';
import { Platform } from 'react-native';
import {
  StackActions,
  StackRouter,
  useNavigationBuilder,
  type ParamListBase,
  type RouteProp,
  type StackActionHelpers,
  type StackNavigationState,
  type StackRouterOptions,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationEventMap,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { withLayoutContext } from 'expo-router';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { REDUCED } from '../../lib/motion';
import { WebTransitionStackView } from './WebTransitionStackView';

const NativeStack = createNativeStackNavigator();

type StackOptions = NativeStackNavigationOptions;
type StackOptionsProp =
  | StackOptions
  | ((props: { route: RouteProp<ParamListBase>; navigation: unknown }) => StackOptions)
  | undefined;
type NavigatorProps = ComponentProps<typeof NativeStack.Navigator>;

/**
 * The motion every Roxy stack runs with (motion spec §3.1 row 5, F3, F12),
 * under the layout's own options:
 * - the platform's default push (`animation: 'default'`: iOS slide + parallax
 *   with swipe-back, Android's system transition), gestures on, no header;
 * - Reduce Motion: a 120 ms fade instead of any slide — unless a screen asked
 *   for no animation at all.
 */
export function withStackDefaults(screenOptions: StackOptionsProp, reducedMotion: boolean): StackOptionsProp {
  const merge = (own: StackOptions | undefined): StackOptions => {
    const options: StackOptions = { headerShown: false, animation: 'default', gestureEnabled: true, ...own };
    if (reducedMotion && options.animation !== 'none') {
      options.animation = 'fade';
      options.animationDuration = REDUCED.fadeMs;
    }
    return options;
  };
  if (typeof screenOptions === 'function') return (props) => merge(screenOptions(props));
  return merge(screenOptions);
}

/**
 * The web navigator: React Navigation's native-stack navigator (same router,
 * same `tabPress` → pop to top), rendered by WebTransitionStackView so pushes
 * and pops move on roxy.expo.app the way they do in the app.
 */
function WebTransitionNavigator({
  id, initialRouteName, children, screenListeners, screenOptions,
}: NavigatorProps) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    StackNavigationState<ParamListBase>,
    StackRouterOptions,
    StackActionHelpers<ParamListBase>,
    NativeStackNavigationOptions,
    NativeStackNavigationEventMap
  >(StackRouter, { id, initialRouteName, children, screenListeners, screenOptions });

  // Same as native-stack: tapping the focused tab pops its stack to the top.
  useEffect(() => {
    const nav = navigation as unknown as {
      addListener?: (type: 'tabPress', cb: (e: { defaultPrevented?: boolean }) => void) => () => void;
      isFocused: () => boolean;
    };
    return nav.addListener?.('tabPress', (e) => {
      const isFocused = nav.isFocused();
      requestAnimationFrame(() => {
        if (state.index > 0 && isFocused && !e.defaultPrevented) {
          navigation.dispatch({ ...StackActions.popToTop(), target: state.key });
        }
      });
    });
  }, [navigation, state.index, state.key]);

  return (
    <NavigationContent>
      <WebTransitionStackView state={state} navigation={navigation} descriptors={descriptors} />
    </NavigationContent>
  );
}

/**
 * The stack navigator behind every Roxy layout: native-stack with explicit
 * motion on iOS/Android, the transition view on the web.
 */
export function TransitionStackNavigator(props: NavigatorProps) {
  const reducedMotion = useReducedMotion();
  const { screenOptions } = props;
  const options = useMemo(
    () => withStackDefaults(screenOptions as StackOptionsProp, reducedMotion),
    [screenOptions, reducedMotion],
  ) as NavigatorProps['screenOptions'];
  if (Platform.OS === 'web') return <WebTransitionNavigator {...props} screenOptions={options} />;
  return <NativeStack.Navigator {...props} screenOptions={options} />;
}

/** Drop-in for expo-router's `Stack` (same `.Screen`, same props). */
export const TransitionStack = withLayoutContext<
  NativeStackNavigationOptions,
  typeof TransitionStackNavigator,
  StackNavigationState<ParamListBase>,
  NativeStackNavigationEventMap
>(TransitionStackNavigator);
