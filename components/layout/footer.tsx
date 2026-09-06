import FooterMenu from "components/layout/footer-menu";
import NewsletterForm from "components/layout/newsletter-form";
import LogoSquare from "components/logo-square";
import { footerMenuGroups } from "lib/menus";
import Link from "next/link";

const { COMPANY_NAME, SITE_NAME } = process.env;

const GITHUB_URL = "https://github.com/bxljoy/nextjs-commerce";

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-5 w-5 fill-current"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const copyrightDate = 2023 + (currentYear > 2023 ? `-${currentYear}` : "");
  const copyrightName = COMPANY_NAME || SITE_NAME || "";

  return (
    <footer className="text-sm text-neutral-500 dark:text-neutral-400">
      <div className="mx-auto w-full max-w-7xl border-t border-neutral-200 px-6 py-12 md:px-4 min-[1320px]:px-0 dark:border-neutral-700">
        {/* One column on mobile, then the brand block plus three link groups
            plus the signup — five tracks is what fills this container. */}
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
          <div className="lg:col-span-1">
            <Link
              className="flex items-center gap-2 text-black dark:text-white"
              href="/"
            >
              <LogoSquare size="sm" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                {SITE_NAME}
              </span>
            </Link>
            <p className="mt-4 max-w-[24ch] text-sm">
              Sample products, real architecture.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Source on GitHub"
              className="mt-4 inline-flex text-neutral-500 transition-colors hover:text-black dark:text-neutral-400 dark:hover:text-white"
            >
              <GitHubIcon />
            </a>
          </div>

          {footerMenuGroups.map((group) => (
            <FooterMenu key={group.title} group={group} />
          ))}

          <div className="sm:col-span-2 lg:col-span-1">
            <NewsletterForm />
          </div>
        </div>
      </div>

      <div className="border-t border-neutral-200 py-6 text-sm dark:border-neutral-700">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-1 px-4 md:flex-row md:gap-0 md:px-4 min-[1320px]:px-0">
          <p>
            &copy; {copyrightDate} {copyrightName}
            {copyrightName.length && !copyrightName.endsWith(".")
              ? "."
              : ""}{" "}
            All rights reserved.
          </p>
          <hr className="mx-4 hidden h-4 w-[1px] border-l border-neutral-400 md:inline-block" />
          <p>
            <a href={GITHUB_URL}>View the source</a>
          </p>
          <p className="md:ml-auto">
            <a href={GITHUB_URL} className="text-black dark:text-white">
              Created by ▲ Alex
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
