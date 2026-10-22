import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProviderCompat, Screen } from '@react-navigation/elements';
import type {
  Descriptor, NavigationProp, ParamListBase, Route, RouteProp, StackNavigationState,
} from '@react-navigation/native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { ScreenTransition, type TransitionKind, type TransitionPhase } from './ScreenTransition';

type NativeStackDescriptor = Descriptor<
  NativeStackNavigationOptions,
  NavigationProp<ParamListBase>,
  RouteProp<ParamListBase>
>;
export type NativeStackDescriptorMap = Record<string, NativeStackDescriptor>;

/**
 * How long a covered screen stays visible under a pushed one: past the enter's
 * settle (`calm` over 32 dp ≈ 200 ms, `effects` ≈ 170 ms) with room for slow
 * frames. Only visibility waits on this; input never does.
 */
export const ENTER_HOLD_MS = 400;
/** How long a popped screen is kept for its exit (`calm` back + `fastEffects` out). */
export const EXIT_HOLD_MS = 350;

type Props = {
  state: StackNavigationState<ParamListBase>;
  /** The stack's navigation helpers (kept for parity with NativeStackView; unused). */
  navigation?: unknown;
  descriptors: NativeStackDescriptorMap;
};

type Closing = { route: Route<string>; descriptor: NativeStackDescriptor };

type Model = {
  /** The navigation state this model was derived from. */
  source: StackNavigationState<ParamListBase>;
  keys: string[];
  /** Whether a route mounted with an entrance (fixed for its life). */
  animated: Record<string, boolean>;
  /** Pushed routes still inside their enter window. */
  entering: string[];
  /** Popped routes kept for their exit, with the last descriptor they had. */
  closing: Closing[];
  /** Descriptors as of `source`, so a popped route can still render. */
  descriptors: NativeStackDescriptorMap;
};

function kindOf(descriptor: NativeStackDescriptor | undefined): TransitionKind {
  const presentation = descriptor?.options.presentation;
  return presentation === 'modal' || presentation === 'fullScreenModal' ? 'modal' : 'push';
}

function firstModel(state: StackNavigationState<ParamListBase>, descriptors: NativeStackDescriptorMap): Model {
  const keys = state.routes.map((r) => r.key);
  return {
    source: state,
    keys,
    animated: Object.fromEntries(keys.map((k) => [k, false])),
    entering: [],
    closing: [],
    descriptors,
  };
}

/**
 * The next model for a new navigation state: a push is exactly one new route
 * on top of the old stack; a pop removes the old top. Anything else (replace,
 * reset, a redirect) is simply there.
 */
function nextModel(
  prev: Model,
  state: StackNavigationState<ParamListBase>,
  descriptors: NativeStackDescriptorMap,
): Model {
  const keys = state.routes.map((r) => r.key);
  const added = keys.filter((k) => !prev.keys.includes(k));
  const removed = prev.keys.filter((k) => !keys.includes(k));
  const prevTop = prev.keys[prev.keys.length - 1];
  const top = keys[keys.length - 1];
  const isPush = added.length === 1 && added[0] === top && removed.length === 0;
  const isPop = added.length === 0 && removed.includes(prevTop);

  const animated = { ...prev.animated };
  for (const k of added) {
    animated[k] = isPush && descriptors[k]?.options.animation !== 'none';
  }

  // A route back in the stack is no longer leaving.
  let closing = prev.closing.filter((c) => !keys.includes(c.route.key));
  if (isPop && prevTop) {
    const route = prev.source.routes.find((r) => r.key === prevTop);
    const descriptor = prev.descriptors[prevTop];
    if (route && descriptor && descriptor.options.animation !== 'none') {
      closing = [...closing, { route, descriptor }];
    }
  }

  let entering = prev.entering.filter((k) => keys.includes(k));
  if (isPush && animated[top]) entering = [...entering, top];

  return { source: state, keys, animated, entering, closing, descriptors };
}

/**
 * React Navigation's web native-stack (`NativeStackView.tsx`, web), with
 * motion: every screen of the stack stays mounted as before, but a push enters
 * over the screen it covers, a pop exits above the screen it reveals, and a
 * back press mid-push turns the screen around (motion spec §3.1 row 5, F3).
 *
 * Every layer is a keyed child of one parent, so a screen that switches from
 * entering to leaving keeps its instance and its springs carry on from where
 * they are. Headers are not drawn: no Roxy screen shows a navigator header.
 */
export function WebTransitionStackView({ state, descriptors }: Props) {
  const [model, setModel] = useState<Model>(() => firstModel(state, descriptors));
  let current = model;
  if (model.source !== state) {
    current = nextModel(model, state, descriptors);
    setModel(current);
  }

  // Close each enter / exit window once; a later render must not restart it.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const key of current.entering) {
      const id = `enter:${key}`;
      if (timers.current.has(id)) continue;
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id);
        setModel((m) => ({ ...m, entering: m.entering.filter((k) => k !== key) }));
      }, ENTER_HOLD_MS));
    }
    for (const { route } of current.closing) {
      const id = `exit:${route.key}`;
      if (timers.current.has(id)) continue;
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id);
        setModel((m) => ({ ...m, closing: m.closing.filter((c) => c.route.key !== route.key) }));
      }, EXIT_HOLD_MS));
    }
  }, [current.entering, current.closing]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  const topKey = state.routes[state.index]?.key;
  const coveredKey = topKey && current.entering.includes(topKey) ? state.routes[state.index - 1]?.key : undefined;

  const layer = (
    route: Route<string>,
    descriptor: NativeStackDescriptor,
    phase: TransitionPhase,
    visible: boolean,
  ) => {
    const focused = route.key === topKey;
    return (
      <ScreenTransition
        key={route.key}
        testID="screen-transition"
        nativeID={`screen-${route.key}`}
        phase={phase}
        kind={kindOf(descriptor)}
        animate={current.animated[route.key] ?? false}
        style={{ display: visible ? 'flex' : 'none' }}
      >
        <Screen
          focused={focused}
          route={route}
          navigation={descriptor.navigation}
          headerShown={false}
          header={null}
          style={StyleSheet.absoluteFill}
        >
          <View style={[s.content, descriptor.options.contentStyle]}>{descriptor.render()}</View>
        </Screen>
      </ScreenTransition>
    );
  };

  return (
    <SafeAreaProviderCompat>
      <View style={s.container}>
        {state.routes.map((route) => {
          const descriptor = descriptors[route.key];
          const phase: TransitionPhase = current.entering.includes(route.key) ? 'enter' : 'idle';
          return layer(route, descriptor, phase, route.key === topKey || route.key === coveredKey);
        })}
        {current.closing.map(({ route, descriptor }) => layer(route, descriptor, 'exit', true))}
      </View>
    </SafeAreaProviderCompat>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
});
