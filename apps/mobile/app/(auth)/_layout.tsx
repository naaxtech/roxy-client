import { TransitionStack } from '../../components/motion/TransitionStack';

export default function AuthLayout() {
  return <TransitionStack screenOptions={{ headerShown: false }} />;
}
