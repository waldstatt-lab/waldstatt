/**
 * The site's texts, which Astro renders at build time into inert `<template>`
 * elements (Game.astro): the Ortstafel, the Chronik and each game's Markdown.
 * A text is split into sections at its `<h2>` headings. Nodes are cloned from the templates, never built from strings.
 */
import { controlsHeading, type KindInfo } from "./config";

export interface Section {
  heading: string;
  /** Characters of text, which set the scroll's length. */
  chars: number;
  /** Cloned nodes of the section, heading included. */
  nodes: () => Node[];
}

export interface GameInfo {
  id: string;
  title: string;
  tagline: string;
  playUrl: string;
  sourceUrl: string;
  preview: boolean;
}

function template(key: string): HTMLTemplateElement | null {
  for (const element of document.querySelectorAll<HTMLTemplateElement>(
    "template[data-text]",
  )) {
    if (element.dataset.text === key) return element;
  }
  return null;
}

function split(key: string): Section[] {
  const source = template(key);
  if (!source) return [];
  const groups: { heading: string; nodes: Node[] }[] = [];
  for (const node of source.content.childNodes) {
    if (node instanceof HTMLHeadingElement && node.tagName === "H2") {
      groups.push({ heading: node.textContent?.trim() ?? "", nodes: [node] });
    } else if (groups.length) {
      groups[groups.length - 1].nodes.push(node);
    } else if (node.textContent?.trim()) {
      groups.push({ heading: "", nodes: [node] });
    }
  }
  return groups.map((group) => ({
    heading: group.heading,
    chars: group.nodes.reduce(
      (sum, node) => sum + (node.textContent?.replace(/\s+/g, " ").length ?? 0),
      0,
    ),
    nodes: () => group.nodes.map((node) => node.cloneNode(true)),
  }));
}

const cache = new Map<string, Section[]>();

/** The sections a building shows, for its kind and game. */
export function sectionsFor(info: KindInfo, game?: string): Section[] {
  const key = `${info.text}:${game ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let sections: Section[] = [];
  if (info.text === "ortstafel" || info.text === "chronik") {
    sections = split(info.text);
  } else if (game && (info.text === "idea" || info.text === "controls")) {
    const all = split(`game:${game}`);
    sections = all.filter(
      (section) =>
        (section.heading === controlsHeading) === (info.text === "controls"),
    );
  }
  cache.set(key, sections);
  return sections;
}

export function readGames(): GameInfo[] {
  const element = document.getElementById("wg-games");
  if (!element?.textContent) return [];
  try {
    const data: unknown = JSON.parse(element.textContent);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (game): game is GameInfo =>
        typeof game?.id === "string" &&
        typeof game.title === "string" &&
        typeof game.playUrl === "string" &&
        typeof game.sourceUrl === "string",
    );
  } catch {
    return [];
  }
}
