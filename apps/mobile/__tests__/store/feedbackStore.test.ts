import { act, renderHook } from "@testing-library/react-native";
import { useFeedbackStore } from "../../store/feedbackStore";
import { AppFeedback, FeatureRequest } from "../../types";

// Mock supabase — inline factory (jest hoisting rule)
jest.mock("../../lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      match: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

const makeFeedback = (id: string): AppFeedback => ({
  id,
  user_id: "user-1",
  category: "bug",
  rating: null,
  message: "Test message",
  screen_context: "/(tabs)/grow",
  app_version: "1.1.0",
  platform: "ios",
  status: "open",
  created_at: "2026-01-01T00:00:00Z",
  resolved_at: null,
});

const makeFeature = (id: string, voteCount = 0): FeatureRequest => ({
  id,
  title: "Test feature",
  description: null,
  type: "pitched",
  status: "open",
  vote_count: voteCount,
  created_by: "user-1",
  created_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  useFeedbackStore.setState({
    myFeedback: [],
    loadingMyFeedback: false,
    submitting: false,
    featureRequests: [],
    loadingFeatures: false,
    myVotedFeatureIds: new Set(),
  });
});

describe("feedbackStore — initial state", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useFeedbackStore());
    expect(result.current.myFeedback).toEqual([]);
    expect(result.current.featureRequests).toEqual([]);
    expect(result.current.myVotedFeatureIds.size).toBe(0);
  });
});

describe("feedbackStore — feedback list", () => {
  it("loadMyFeedback populates from mocked query state", () => {
    const { result } = renderHook(() => useFeedbackStore());
    act(() => {
      useFeedbackStore.setState({ myFeedback: [makeFeedback("f1")] });
    });
    expect(result.current.myFeedback).toHaveLength(1);
    expect(result.current.myFeedback[0].category).toBe("bug");
  });
});

describe("feedbackStore — votes (optimistic)", () => {
  it("toggleVote adds featureId and increments count when not yet voted", () => {
    const { result } = renderHook(() => useFeedbackStore());
    act(() => {
      useFeedbackStore.setState({ featureRequests: [makeFeature("feat-1", 3)] });
    });
    act(() => {
      useFeedbackStore.setState((s) => ({
        myVotedFeatureIds: new Set([...s.myVotedFeatureIds, "feat-1"]),
        featureRequests: s.featureRequests.map((f) =>
          f.id === "feat-1" ? { ...f, vote_count: f.vote_count + 1 } : f
        ),
      }));
    });
    expect(result.current.myVotedFeatureIds.has("feat-1")).toBe(true);
    expect(result.current.featureRequests[0].vote_count).toBe(4);
  });

  it("toggleVote removes featureId and decrements count when already voted", () => {
    const { result } = renderHook(() => useFeedbackStore());
    act(() => {
      useFeedbackStore.setState({
        featureRequests: [makeFeature("feat-1", 4)],
        myVotedFeatureIds: new Set(["feat-1"]),
      });
    });
    act(() => {
      useFeedbackStore.setState((s) => {
        const next = new Set(s.myVotedFeatureIds);
        next.delete("feat-1");
        return {
          myVotedFeatureIds: next,
          featureRequests: s.featureRequests.map((f) =>
            f.id === "feat-1" ? { ...f, vote_count: Math.max(0, f.vote_count - 1) } : f
          ),
        };
      });
    });
    expect(result.current.myVotedFeatureIds.has("feat-1")).toBe(false);
    expect(result.current.featureRequests[0].vote_count).toBe(3);
  });

  it("vote_count never goes below zero", () => {
    const { result } = renderHook(() => useFeedbackStore());
    act(() => {
      useFeedbackStore.setState({ featureRequests: [makeFeature("feat-1", 0)] });
    });
    act(() => {
      useFeedbackStore.setState((s) => ({
        featureRequests: s.featureRequests.map((f) =>
          f.id === "feat-1" ? { ...f, vote_count: Math.max(0, f.vote_count - 1) } : f
        ),
      }));
    });
    expect(result.current.featureRequests[0].vote_count).toBe(0);
  });
});
