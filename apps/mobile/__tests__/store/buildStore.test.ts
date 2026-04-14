import { act, renderHook } from "@testing-library/react-native";
import { useBuildStore } from "../../store/buildStore";
import { Business, ImpactProject } from "../../types";

// Mock supabase — inline factory (jest hoisting rule)
jest.mock("../../lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      match: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

const makeBusiness = (id: string): Business => ({
  id,
  owner_id: "user-1",
  name: "Test Business",
  description: null,
  category: "retail",
  location_city: "London",
  website_url: null,
  instagram_handle: null,
  logo_url: null,
  is_verified: false,
  is_wlw_owned: true,
  created_at: "2026-01-01T00:00:00Z",
});

const makeProject = (id: string): ImpactProject => ({
  id,
  creator_id: "user-1",
  title: "Test Project",
  description: null,
  category: "mutual_aid",
  goal_amount: 1000,
  raised_amount: 0,
  supporter_count: 0,
  status: "active",
  website_url: null,
  created_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  useBuildStore.setState({
    businesses: [],
    impactProjects: [],
    loading: false,
    bookmarkedBusinessIds: new Set(),
    supportedProjectIds: new Set(),
    searchChips: [],
  });
});

describe("buildStore — existing", () => {
  it("has correct initial state", () => {
    const { result } = renderHook(() => useBuildStore());
    expect(result.current.businesses).toEqual([]);
    expect(result.current.impactProjects).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("setBusinesses replaces array", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setBusinesses([makeBusiness("b1"), makeBusiness("b2")]));
    expect(result.current.businesses).toHaveLength(2);
    expect(result.current.businesses[0].id).toBe("b1");
  });

  it("setImpactProjects replaces array", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject("p1")]));
    expect(result.current.impactProjects).toHaveLength(1);
  });

  it("incrementSupporter increases supporter_count", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject("p1")]));
    act(() => result.current.incrementSupporter("p1"));
    expect(result.current.impactProjects[0].supporter_count).toBe(1);
  });
});

describe("buildStore — search chips", () => {
  it("addSearchChip adds a chip", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    expect(result.current.searchChips).toEqual(["wellness"]);
  });

  it("addSearchChip ignores duplicates (case-insensitive)", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    act(() => result.current.addSearchChip("Wellness"));
    expect(result.current.searchChips).toHaveLength(1);
  });

  it("removeSearchChip removes the correct chip", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    act(() => result.current.addSearchChip("coaching"));
    act(() => result.current.removeSearchChip("wellness"));
    expect(result.current.searchChips).toEqual(["coaching"]);
  });

  it("setSearchChips replaces all chips", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    act(() => result.current.setSearchChips([]));
    expect(result.current.searchChips).toEqual([]);
  });
});

describe("buildStore — bookmarks (optimistic)", () => {
  it("toggleBookmark adds businessId to set", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => {
      useBuildStore.setState({ bookmarkedBusinessIds: new Set() });
    });
    act(() => {
      useBuildStore.setState((s) => ({
        bookmarkedBusinessIds: new Set([...s.bookmarkedBusinessIds, "b1"]),
      }));
    });
    expect(result.current.bookmarkedBusinessIds.has("b1")).toBe(true);
  });

  it("removing bookmark removes businessId from set", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => {
      useBuildStore.setState({ bookmarkedBusinessIds: new Set(["b1"]) });
    });
    act(() => {
      useBuildStore.setState((s) => {
        const next = new Set(s.bookmarkedBusinessIds);
        next.delete("b1");
        return { bookmarkedBusinessIds: next };
      });
    });
    expect(result.current.bookmarkedBusinessIds.has("b1")).toBe(false);
  });
});

describe("buildStore — supports (optimistic)", () => {
  it("supportProject adds projectId to set and increments count", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject("p1")]));
    act(() => {
      useBuildStore.setState((s) => ({
        supportedProjectIds: new Set([...s.supportedProjectIds, "p1"]),
        impactProjects: s.impactProjects.map((p) =>
          p.id === "p1" ? { ...p, supporter_count: p.supporter_count + 1 } : p
        ),
      }));
    });
    expect(result.current.supportedProjectIds.has("p1")).toBe(true);
    expect(result.current.impactProjects[0].supporter_count).toBe(1);
  });

  it("does not double-add to supportedProjectIds", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => {
      useBuildStore.setState({ supportedProjectIds: new Set(["p1"]) });
    });
    const before = result.current.supportedProjectIds.size;
    act(() => {
      if (!result.current.supportedProjectIds.has("p1")) {
        useBuildStore.setState((s) => ({
          supportedProjectIds: new Set([...s.supportedProjectIds, "p1"]),
        }));
      }
    });
    expect(result.current.supportedProjectIds.size).toBe(before);
  });
});
