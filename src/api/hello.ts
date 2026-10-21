export function helloRoutes() {
  return {
    "/api/hello": {
      async GET() {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT() {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },
    "/api/hello/:name": (req: { params: { name: string } }) => {
      return Response.json({
        message: `Hello, ${req.params.name}!`,
      });
    },
  };
}
