"use client";

import clsx from "clsx";
import type { MenuGroup } from "lib/menus";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function FooterMenu({ group }: { group: MenuGroup }) {
  const pathname = usePathname();

  if (!group.items.length) return null;

  return (
    <nav>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-black dark:text-white">
        {group.title}
      </h3>
      <ul className="flex flex-col gap-3">
        {group.items.map((item) => (
          <li key={item.title}>
            <Link
              href={item.path}
              className={clsx(
                "text-sm underline-offset-4 transition-colors hover:text-black hover:underline dark:hover:text-neutral-300",
                {
                  "text-black dark:text-neutral-300": pathname === item.path,
                },
              )}
            >
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
