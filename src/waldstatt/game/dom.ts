/**
 * Small helpers for building the interface with the DOM API (never from
 * HTML strings), and the fuzzy matching of the finders.
 */

/** An element with properties and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.assign(element, props);
  element.append(...children);
  return element;
}

/** The element a selector finds, or an error naming the selector. */
export function need<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

export /** Lower case, without accents: «Säge» matches «sage». */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export /**
 * How well a query matches a label, as in a fuzzy finder: its letters in
 * order, anywhere; more for letters in a row and at word starts, less for
 * gaps. −1 if it does not match.
 */
function fuzzy(query: string, label: string): number {
  const q = plain(query.trim());
  const t = plain(label);
  if (!q) return 0;
  let score = 0;
  let at = 0;
  let run = 0;
  for (const c of q) {
    const i = t.indexOf(c, at);
    if (i < 0) return -1;
    run = i === at ? run + 1 : 0;
    const start = i === 0 || /[:\s-]/.test(t[i - 1]);
    score += 1 + run * 2 + (start ? 3 : 0) - Math.min(3, i - at) * 0.3;
    at = i + 1;
  }
  return score - t.length * 0.01;
}
