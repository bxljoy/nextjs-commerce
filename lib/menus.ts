export type MenuItem = {
  title: string;
  path: string;
};

/**
 * Site navigation, defined in code rather than a CMS.
 *
 * Nav maps to routes, and routes are code — adding /blog meant adding both a
 * route file and a link, in the same change. Splitting them across two systems
 * is what let Shopify's menu point at /policies/privacy-policy, a path this app
 * has never served. A hardcoded array cannot drift from the routes it names.
 */

/** Primary paths through the site: what someone is here to do. */
export const headerMenu: MenuItem[] = [
  { title: "All Products", path: "/search" },
  { title: "Blog", path: "/blog" },
  { title: "Contact", path: "/contact" },
];

/**
 * Secondary and legal pages — the things that do not earn header space.
 * These were a duplicate of the header until the pages behind them existed.
 */
export const footerMenu: MenuItem[] = [
  { title: "About", path: "/about" },
  { title: "Privacy", path: "/privacy" },
  { title: "Terms", path: "/terms" },
];
