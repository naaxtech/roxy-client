import { act, renderHook } from '@testing-library/react-native';
import { useRoxyChatStore } from '../../store/roxyChatStore';

describe('roxyChatStore', () => {
  beforeEach(() => {
    useRoxyChatStore.setState({ messages: [], isOpen: false, isTyping: false });
  });

  it('starts empty', () => {
    const { result } = renderHook(() => useRoxyChatStore());
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isOpen).toBe(false);
  });

  it('addMessage appends a message with id and timestamp', () => {
    const { result } = renderHook(() => useRoxyChatStore());
    act(() => result.current.addMessage({ role: 'user', content: 'Hello Roxy' }));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('Hello Roxy');
    expect(result.current.messages[0].id).toBeDefined();
    expect(result.current.messages[0].timestamp).toBeDefined();
  });

  it('clear removes all messages', () => {
    const { result } = renderHook(() => useRoxyChatStore());
    act(() => result.current.addMessage({ role: 'roxy', content: 'Hi!' }));
    act(() => result.current.clear());
    expect(result.current.messages).toHaveLength(0);
  });

  it('setOpen toggles isOpen', () => {
    const { result } = renderHook(() => useRoxyChatStore());
    act(() => result.current.setOpen(true));
    expect(result.current.isOpen).toBe(true);
  });
});
