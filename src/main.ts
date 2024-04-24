import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { getDocumentProxy, extractText } from "unpdf";
import index from "./index.html";

type Bindings = {
  BUCKET: R2Bucket;
  USER: string;
  PASS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Apply basic authentication to all routes
app.use("*", basicAuth({ username: "USER", password: "PASS" }));

// Serve an HTML form for PDF uploads
app.get("/", (c) => {
  return c.html(index);
});

// Handle PDF uploads
app.post("/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("pdf");

  // Validate the file
  if (
    !file ||
    typeof file !== "object" ||
    !(file as any).arrayBuffer ||
    typeof (file as any).arrayBuffer !== "function"
  ) {
    return c.text("Please upload a PDF file.", 400);
  }

  const buffer = await (file as any).arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: true });

  // Ensure textContent is a string
  const textContent = Array.isArray(result.text)
    ? result.text.join(" ")
    : result.text;

  // Store the extracted text in R2 bucket
  const key = crypto.randomUUID() + ".txt";
  await c.env.BUCKET.put(key, new TextEncoder().encode(textContent), {
    httpMetadata: { contentType: "text/plain" },
  });

  // Return HTML with a link to the uploaded file
  const filePath = `/file/${key}`;
  return c.html(`
    <p>Access your file <a href="${filePath}">here</a>.</p>
  `);
});

// Route to retrieve the uploaded file content by key
app.get("/file/:key", async (c) => {
  const key = c.req.param("key");
  const object = await c.env.BUCKET.get(key);
  if (!object) {
    return c.text("File not found.", 404);
  }

  const data = await object.text();
  return c.text(data, 200, {
    "Content-Type": "text/plain",
    "Cache-Control": "public, max-age=86400", // 1 day caching
  });
});

export default app;
