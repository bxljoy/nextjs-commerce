export type SanitySeedSpan = {
  _key: string;
  _type: "span";
  marks: string[];
  text: string;
};

export type SanitySeedBlock = {
  _key: string;
  _type: "block";
  style: "normal";
  markDefs: [];
  children: [SanitySeedSpan];
};

export type SanitySeedPost = {
  _id: string;
  _type: "post";
  title: string;
  slug: { _type: "slug"; current: string };
  publishedAt: string;
  excerpt: string;
  body: SanitySeedBlock[];
  seo: { title: string; description: string };
};

type Topic = {
  name: string;
  slug: string;
  focus: string;
};

type Angle = {
  name: string;
  slug: string;
  practice: string;
};

const TOPICS: readonly Topic[] = [
  {
    name: "Cache Architecture",
    slug: "cache-architecture",
    focus:
      "Cache boundaries decide where freshness, reuse, and invalidation belong.",
  },
  {
    name: "Content Modeling",
    slug: "content-modeling",
    focus:
      "Content models give editors clear structure while keeping rendering predictable.",
  },
  {
    name: "Search Relevance",
    slug: "search-relevance",
    focus:
      "Search relevance connects analyzed terms, field weights, and useful result ordering.",
  },
  {
    name: "Accessibility",
    slug: "accessibility",
    focus:
      "Accessible interfaces preserve semantics, keyboard paths, and understandable feedback.",
  },
  {
    name: "Testing",
    slug: "testing",
    focus:
      "Focused tests turn behavior and failure boundaries into repeatable evidence.",
  },
  {
    name: "Observability",
    slug: "observability",
    focus:
      "Observability links structured signals to questions about system behavior.",
  },
  {
    name: "Performance",
    slug: "performance",
    focus:
      "Performance work starts with measured user impact and bounded resource costs.",
  },
  {
    name: "Security",
    slug: "security",
    focus:
      "Security boundaries minimize authority, validate inputs, and fail closed.",
  },
  {
    name: "Deployment",
    slug: "deployment",
    focus:
      "Deployment workflows make changes reviewable, reversible, and observable.",
  },
  {
    name: "API Design",
    slug: "api-design",
    focus:
      "API design makes contracts explicit and keeps transport details at clear boundaries.",
  },
];

const ANGLES: readonly Angle[] = [
  {
    name: "Foundations",
    slug: "foundations",
    practice: "Define the terms and ownership rules before selecting tools.",
  },
  {
    name: "Trade-offs",
    slug: "trade-offs",
    practice:
      "Compare benefits, costs, and failure behavior with the same workload.",
  },
  {
    name: "Workflow",
    slug: "workflow",
    practice:
      "Use a short sequence with explicit inputs, outputs, and review points.",
  },
  {
    name: "Failure Modes",
    slug: "failure-modes",
    practice: "List likely faults and verify that each one stops safely.",
  },
  {
    name: "Measurement",
    slug: "measurement",
    practice: "Choose a small set of signals that answer a specific question.",
  },
  {
    name: "Review",
    slug: "review",
    practice:
      "Review assumptions, boundaries, and evidence rather than only happy paths.",
  },
  {
    name: "Migration",
    slug: "migration",
    practice:
      "Move in reversible stages while the authoritative path remains available.",
  },
  {
    name: "Debugging",
    slug: "debugging",
    practice:
      "Start from a reproducible symptom and narrow one boundary at a time.",
  },
  {
    name: "Examples",
    slug: "examples",
    practice:
      "Use controlled examples that isolate one relationship without real user data.",
  },
  {
    name: "Checklist",
    slug: "checklist",
    practice:
      "Confirm safety, correctness, recovery, and documentation before completion.",
  },
];

const CONTROLLED_TITLES: Readonly<Record<number, string>> = {
  1: "Distributed Cache Foundations",
  21: "Content Search Foundations",
  24: "Signal Orchard Failure Modes",
};

const CONTROLLED_BODY: Readonly<Record<number, string>> = {
  2: "A distributed cache example appears in this body while the title stays general, creating a controlled field-position pair.",
  22: "The phrase content search appears only in this body for a controlled comparison with a title match.",
  23: "This synthetic paragraph repeats indexing indexed indexes so English stemming can be explored without promising exact scores.",
  25: "The uncommon phrase signal orchard appears only in this body, paired with a separate title match for boost inspection.",
};

function paragraph(key: number, text: string): SanitySeedBlock {
  return {
    _key: `paragraph-${key}`,
    _type: "block",
    style: "normal",
    markDefs: [],
    children: [
      {
        _key: `span-${key}`,
        _type: "span",
        marks: [],
        text,
      },
    ],
  };
}

function buildBody(
  sampleNumber: number,
  topic: Topic,
  angle: Angle,
): SanitySeedBlock[] {
  const paragraphs = [
    `This clearly labeled Search Lab sample examines ${topic.name.toLowerCase()} through ${angle.name.toLowerCase()}. All wording is deterministic synthetic learning content.`,
    `${topic.focus} ${angle.practice}`,
    "The example keeps Sanity authoritative and treats the local search index as a disposable projection that can be rebuilt.",
  ];

  const controlled = CONTROLLED_BODY[sampleNumber];
  if (controlled) paragraphs.push(controlled);
  if (sampleNumber % 3 >= 1) {
    paragraphs.push(
      `Sample ${String(sampleNumber).padStart(3, "0")} adds a review note so body length varies across the fixture matrix while remaining reproducible.`,
    );
  }
  if (sampleNumber % 3 === 2) {
    paragraphs.push(
      "A final synthetic note recommends checking observable outcomes before changing the design.",
    );
  }

  return paragraphs.map((text, index) => paragraph(index + 1, text));
}

export function buildSearchLabPosts(): SanitySeedPost[] {
  const firstPublishedDay = Date.UTC(2026, 4, 25);

  return TOPICS.flatMap((topic, topicIndex) =>
    ANGLES.map((angle, angleIndex) => {
      const sampleNumber = topicIndex * ANGLES.length + angleIndex + 1;
      const label = String(sampleNumber).padStart(3, "0");
      const subject =
        CONTROLLED_TITLES[sampleNumber] ?? `${topic.name}: ${angle.name}`;
      const excerpt = `Search Lab sample ${label} explores ${topic.name.toLowerCase()} with a ${angle.name.toLowerCase()} lens and deterministic synthetic examples.`;

      return {
        _id: `search-lab-post-${label}`,
        _type: "post" as const,
        title: `[Search Lab Sample ${label}] ${subject}`,
        slug: {
          _type: "slug" as const,
          current: `search-lab-${topic.slug}-${angle.slug}`,
        },
        publishedAt: new Date(
          firstPublishedDay + (sampleNumber - 1) * 86_400_000,
        ).toISOString(),
        excerpt,
        body: buildBody(sampleNumber, topic, angle),
        seo: {
          title: `Search Lab ${label}: ${topic.name}`,
          description: excerpt,
        },
      };
    }),
  );
}
