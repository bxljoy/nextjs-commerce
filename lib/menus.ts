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

export type MenuGroup = {
  title: string;
  items: MenuItem[];
};

/**
 * The footer is the site index, so it carries every destination grouped by
 * kind — including the three the header also shows. That repetition is
 * deliberate here: the header is the shortest path to what someone came for,
 * the footer is the full map.
 */
export const footerMenuGroups: MenuGroup[] = [
  {
    title: "Shop",
    items: [
      { title: "All Products", path: "/search" },
      { title: "Blog", path: "/blog" },
    ],
  },
  {
    title: "Company",
    items: [
      { title: "About", path: "/about" },
      { title: "Contact", path: "/contact" },
    ],
  },
  {
    title: "Legal",
    items: [
      { title: "Privacy", path: "/privacy" },
      { title: "Terms", path: "/terms" },
    ],
  },
];
