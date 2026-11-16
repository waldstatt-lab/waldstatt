/** Prefixes a site path such as "/egg-settlers/" with the configured base path. */
export function href(path: string): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") + path;
}
