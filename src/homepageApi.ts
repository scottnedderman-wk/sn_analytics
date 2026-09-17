import {
  refreshHomepageData,
  type HomepageRefreshDeps,
} from "./homepageRefresh";

export function homepageRoutes(deps?: HomepageRefreshDeps) {
  return {
    "/api/homepage/refresh": {
      async POST() {
        try {
          const data = await refreshHomepageData(deps);
          return Response.json({ data });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  };
}
