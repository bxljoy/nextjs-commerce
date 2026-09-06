import clsx from "clsx";

/**
 * A three-by-three grid with the anti-diagonal knocked out.
 *
 * Drawn as solid blocks on purpose: this renders at 10px inside LogoSquare in
 * the navbar and footer, and thin strokes or fine detail disappear entirely at
 * that size. Square viewBox so it does not letterbox in a square container.
 */
export default function LogoIcon(props: React.ComponentProps<"svg">) {
  // 3 columns of 9 with 2.5 gaps: 9*3 + 2.5*2 = 32
  const track = [0, 11.5, 23];
  const filled: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-label={`${process.env.SITE_NAME} logo`}
      viewBox="0 0 32 32"
      {...props}
      className={clsx("h-4 w-4 fill-black dark:fill-white", props.className)}
    >
      {filled.map(([col, row]) => (
        <rect
          key={`${col}-${row}`}
          x={track[col]}
          y={track[row]}
          width="9"
          height="9"
          rx="1.5"
        />
      ))}
    </svg>
  );
}
