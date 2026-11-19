// Unit tests run in Node: they cover modules without the DOM or WebGL, such
// as the commands, the keymap and the script language. The game in the
// browser is checked by hand (CONTRIBUTING.md).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
