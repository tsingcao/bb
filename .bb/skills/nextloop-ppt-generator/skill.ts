export const description = "Generate PPT slide deck";

export const inputSchema = {
  type: "object",
  properties: {
    type: { type: "string" },
    layout: { type: "string" },
    title: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "array",
        items: [{ type: "string" }, { type: "string" }],
        minItems: 2,
        maxItems: 2,
      },
    },
  },
  required: ["type", "layout", "title", "items"],
};

export default async function (args: {
  type: string;
  layout: string;
  title: string;
  items: [string, string][];
}) {
  // Placeholder implementation – in real code, call the NextLoop harness or a rendering service.
  return { url: "https://example.com/fake-ppt.png" };
}
