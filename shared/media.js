// Image URLs as the browser should load them. ipfs.io rate-limits hotlinked images (429s the
// browser then blocks as cross-origin), so IPFS content is shown through Pinata's gateway; the
// on-chain metadata keeps its original URL.
export function displayUrl(url) {
  if (!url) return url;
  return String(url).replace(/^https?:\/\/(?:ipfs\.io|dweb\.link|cloudflare-ipfs\.com)\/ipfs\//, "https://gateway.pinata.cloud/ipfs/");
}
