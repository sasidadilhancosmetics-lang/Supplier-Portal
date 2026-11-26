export function catalogueImageUrl(value: string | null) {
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "cdn.shopify.com" &&
        !url.username && !url.password && !url.port && !url.hash) return url.href;
  } catch {
    return null;
  }
  return null;
}
