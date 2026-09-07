import { readdirSync } from "fs";
import { join } from "path";

export const description = "List all available BB skills";
export const inputSchema = { type: "object", properties: {}, additionalProperties: false };

export default async function () {
  const skillsRoot = join(process.cwd(), ".bb", "skills");
  try {
    const entries = readdirSync(skillsRoot, { withFileTypes: true });
    const skillNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return skillNames;
  } catch (e) {
    return [];
  }
}
