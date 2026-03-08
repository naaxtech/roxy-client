import { act, renderHook } from "@testing-library/react-native";
import { useBuildStore } from "../../store/buildStore";
import { Business, ImpactProject } from "../../types";

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
  created_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  useBuildStore.setState({
    businesses: [],
    impactProjects: [],
    loading: false,
  });
});

describe("buildStore", () => {
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
    expect(result.current.impactProjects[0].id).toBe("p1");
  });

  it("incrementSupporter increases supporter_count", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject("p1")]));
    act(() => result.current.incrementSupporter("p1"));
    expect(result.current.impactProjects[0].supporter_count).toBe(1);
  });
});
