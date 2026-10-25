// www.<apex> → https://<apex> with the same path and query; null when no redirect is needed
export const canonicalRedirect = (url, apex = 'sumova.org') => {
  const u = new URL(url);
  if (u.hostname === `www.${apex}`) { u.hostname = apex; u.protocol = 'https:'; u.port = ''; return u.toString(); }
  return null;
};
