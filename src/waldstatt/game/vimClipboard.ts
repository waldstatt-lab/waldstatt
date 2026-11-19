/**
 * Vim's yank and paste through the system clipboard, as vim's own
 * `clipboard=unnamedplus`: what `y`, `d`, `c` and `x` put into the unnamed
 * register goes to the clipboard too, and `p` and `P` paste what the
 * clipboard holds, so a yank survives a reload and reaches other programs.
 * A named register (`"a`) stays apart from the clipboard. Without the
 * clipboard, or when the browser refuses it, the register works as before.
 * Kept free of the DOM and of the vim module, so the tests hand in fakes.
 */

/** The browser's clipboard, as far as it is used. */
export interface Clip {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/** A register of `@replit/codemirror-vim`, as far as it is used. */
interface Register {
  linewise: boolean;
  setText(text?: string, linewise?: boolean, blockwise?: boolean): void;
  toString(): string;
}

interface Registers {
  registers: Record<string, Register | undefined>;
  unnamedRegister: Register;
  pushText(
    name: string | null | undefined,
    operator: string,
    text: string,
    linewise?: boolean,
    blockwise?: boolean,
  ): void;
  getRegister(name?: string): Register;
}

interface PasteArgs {
  registerName?: string;
}

/** What vim's actions see as `this`: the rest of a paste. */
interface Actions {
  continuePaste(
    cm: unknown,
    args: PasteArgs,
    vim: unknown,
    text: string,
    register: Register,
  ): void;
}

/** The part of vim's API used here (`Vim` of `@replit/codemirror-vim`). */
export interface VimApi {
  getRegisterController(): unknown;
  defineAction(name: string, fn: never): void;
}

const shared = new WeakSet<object>();

/** Whether a paste or yank with this register goes through the clipboard. */
function viaClipboard(name: string | null | undefined): boolean {
  return !name || name === '"' || name === "+";
}

/** Sends vim's unnamed register to the clipboard and pastes from it. */
export function shareClipboard(vim: VimApi, clipboard: Clip | undefined): void {
  if (!clipboard) return;
  const clip = clipboard;
  const registers = vim.getRegisterController() as Registers;
  // Vim's registers live once per page; so does this.
  if (shared.has(registers)) return;
  shared.add(registers);

  const push = registers.pushText.bind(registers);
  registers.pushText = (name, operator, text, linewise, blockwise) => {
    push(name, operator, text, linewise, blockwise);
    // `"+` writes the clipboard itself, `"_` writes nowhere.
    if (name && name !== '"') return;
    clip.writeText(registers.unnamedRegister.toString()).catch(() => {});
  };

  function paste(
    this: Actions,
    cm: unknown,
    args: PasteArgs,
    state: unknown,
  ): void {
    const name = args.registerName;
    const register =
      name === "+"
        ? (registers.registers["+"] ?? registers.unnamedRegister)
        : registers.getRegister(name);
    const go = () => {
      try {
        this.continuePaste(cm, args, state, register.toString(), register);
      } catch {
        // The editor closed while the clipboard was read.
      }
    };
    if (!viaClipboard(name)) return go();
    clip.readText().then((raw) => {
      const text = raw.replace(/\r\n?/g, "\n");
      // A text from elsewhere is pasted as lines if it ends with one.
      if (text && text !== register.toString())
        register.setText(text, text.endsWith("\n"));
      go();
    }, go);
  }
  vim.defineAction("paste", paste as never);
}
