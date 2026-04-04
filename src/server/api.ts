import { Hono } from "hono";

const app = new Hono().basePath("/api");

app.get("/hello", (c) => {
  return c.json({ message: "Hello from Intentional Society API" });
});

export default app;
