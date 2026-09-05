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
 *
 * The header and footer share this deliberately. The navbar is not sticky and
 * /search is long, so repeating the links in the footer is about reachability,
 * not information. Split them once there is footer-only content to carry —
 * About, Privacy, Terms.
 */
export const mainMenu: MenuItem[] = [
  { title: "All Products", path: "/search" },
  { title: "Blog", path: "/blog" },
  { title: "Contact", path: "/contact" },
];
