import { describe, expect, it } from "vitest";
import { shareClipboard, type Clip, type VimApi } from "./vimClipboard";

class Reg {
  text = "";
  linewise = false;
  setText(text = "", linewise = false) {
    this.text = text;
    this.linewise = linewise;
  }
  toString() {
    return this.text;
  }
}

/** Vim's register controller and paste action, as far as they are used. */
function fakeVim() {
  const unnamed = new Reg();
  const registers: Record<string, Reg> = { '"': unnamed, "+": new Reg() };
  const controller = {
    registers,
    unnamedRegister: unnamed,
    getRegister(name?: string) {
      if (!name || name === '"') return unnamed;
      return (registers[name] ??= new Reg());
    },
    pushText(name: string | undefined, _op: string, text: string, lw = false) {
      if (name === "_") return;
      if (name) this.getRegister(name).setText(text, lw);
      unnamed.setText(text, lw);
    },
  };
  const pasted: { text: string; linewise: boolean }[] = [];
  const actions: Record<string, (...a: unknown[]) => void> = {
    continuePaste(_cm, _args, _vim, text, register) {
      pasted.push({
        text: text as string,
        linewise: (register as Reg).linewise,
      });
    },
  };
  const vim: VimApi = {
    getRegisterController: () => controller,
    defineAction: (name: string, fn: never) => {
      actions[name] = fn;
    },
  };
  const paste = (registerName?: string) =>
    actions.paste.call(actions, {}, { registerName }, {});
  return { vim, controller, pasted, paste };
}

function fakeClip(text = "") {
  const clip = {
    text,
    refuse: false,
    readText: () =>
      clip.refuse
        ? Promise.reject(new Error("no"))
        : Promise.resolve(clip.text),
    writeText: (t: string) => {
      clip.text = t;
      return Promise.resolve();
    },
  };
  return clip satisfies Clip;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("vim and the clipboard", () => {
  it("yanks to the clipboard, but not into a named register", () => {
    const { vim, controller } = fakeVim();
    const clip = fakeClip();
    shareClipboard(vim, clip);
    controller.pushText(undefined, "yank", "hallo");
    expect(clip.text).toBe("hallo");
    controller.pushText("a", "yank", "anderes");
    controller.pushText("_", "delete", "weg");
    expect(clip.text).toBe("hallo");
  });

  it("pastes what the clipboard holds, a line as a line", async () => {
    const { vim, pasted, paste } = fakeVim();
    const clip = fakeClip("up(3)\n");
    shareClipboard(vim, clip);
    paste();
    await settle();
    expect(pasted).toEqual([{ text: "up(3)\n", linewise: true }]);
    clip.text = "wort";
    paste();
    await settle();
    expect(pasted[1]).toEqual({ text: "wort", linewise: false });
  });

  it("keeps a named register apart and falls back when refused", async () => {
    const { vim, controller, pasted, paste } = fakeVim();
    const clip = fakeClip("vom Brett");
    shareClipboard(vim, clip);
    controller.pushText("a", "yank", "im a");
    paste("a");
    expect(pasted).toEqual([{ text: "im a", linewise: false }]);
    clip.refuse = true;
    paste();
    await settle();
    expect(pasted[1].text).toBe("im a");
  });

  it("wraps vim's registers once", () => {
    const { vim, controller } = fakeVim();
    let writes = 0;
    const clip = fakeClip();
    clip.writeText = () => (writes++, Promise.resolve());
    shareClipboard(vim, clip);
    shareClipboard(vim, clip);
    controller.pushText(undefined, "yank", "x");
    expect(writes).toBe(1);
  });
});
