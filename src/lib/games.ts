import { getCollection, type CollectionEntry } from "astro:content";

/** All games in their display order. */
export async function getGames(): Promise<CollectionEntry<"games">[]> {
  return (await getCollection("games")).sort(
    (a, b) => a.data.order - b.data.order,
  );
}
