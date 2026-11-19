import { describe, expect, it } from "vitest";
import {
  readCall,
  readValues,
  shortcut,
  splitChain,
  writeLiteral,
} from "./commandText";

describe("how a command is written", () => {
  it("splits a command into its segments and values", () => {
    expect(readCall("repair:under(5)")).toEqual({
      head: "repair:under",
      values: [5],
      parens: true,
    });
    expect(readCall("build:hütte")).toEqual({
      head: "build:hütte",
      values: [],
      parens: false,
    });
    expect(readCall('notify:info("a, b")')).toMatchObject({
      values: ["a, b"],
    });
    expect(readCall("up 15")).toContain("in Klammern");
    expect(readCall("up(15")).toContain("«)»");
  });

  it("reads numbers and texts with their escapes", () => {
    expect(readValues('1, -2.5, "x \\"y\\" \\\\ z", ""')).toEqual([
      1,
      -2.5,
      'x "y" \\ z',
      "",
    ]);
    expect(readValues("hütte")).toContain('"hütte"');
    expect(readValues("1,,2")).toContain("fehlt");
    expect(readValues("(1)")).toContain("Klammern in Klammern");
    expect(writeLiteral('a "b"')).toBe('"a \\"b\\""');
    expect(writeLiteral(3)).toBe("3");
  });

  it("splits chains outside texts and parentheses", () => {
    expect(splitChain('up(1);notify:info("a;b");enter')).toEqual([
      "up(1)",
      'notify:info("a;b")',
      "enter",
    ]);
    expect(splitChain('notify:info("a')).toContain("nicht geschlossen");
    expect(splitChain("up(1")).toContain("Klammer");
  });

  it("reads the finder's shortcut with a space", () => {
    expect(shortcut("up 15")).toContain("up(15)");
    expect(shortcut("notify:info Hallo Welt")).toContain(
      'notify:info("Hallo Welt")',
    );
    expect(shortcut("up(15)")).toEqual([]);
    expect(shortcut("enter")).toEqual([]);
  });
});
