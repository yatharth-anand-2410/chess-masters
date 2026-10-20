import {
  CONTACT_EMAIL,
  FOUNDERS,
  ORGANIZATION_ID,
  ORG_SAME_AS,
  PRODUCT_FACTS,
  PRODUCT_ID,
  SITE_DESCRIPTION,
  SITE_META_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  WEBSITE_ID,
} from "./site";

export type FaqItem = { question: string; answer: string };

export type BreadcrumbItem = { name: string; path: string };

const abs = (path: string): string =>
  path.startsWith("http") ? path : `${SITE_URL}${path}`;

export const ORGANIZATION_SCHEMA = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: SITE_NAME,
  alternateName: `${SITE_NAME} AI Chess Game Analyzer`,
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: abs("/icon.png"),
    width: 512,
    height: 512,
  },
  description:
    "Chessmasters builds an AI chess game analyzer for Chess.com and Lichess players, turning finished games into plain-English coaching reports.",
  email: CONTACT_EMAIL,
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: CONTACT_EMAIL,
      availableLanguage: ["English"],
    },
  ],
  sameAs: ORG_SAME_AS,
  founder: FOUNDERS.map((founder) => ({
    "@type": "Person",
    name: founder.name,
    jobTitle: founder.jobTitle,
    description: founder.description,
    ...(founder.sameAs ? { sameAs: founder.sameAs } : {}),
    ...(founder.name === "Parth Kaushik"
      ? {
          hasCredential: {
            "@type": "EducationalOccupationalCredential",
            name: "FIDE Arena International Master (AIM)",
            credentialCategory: "FIDE Title",
          },
        }
      : {}),
  })),
};

export const WEBSITE_SCHEMA = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: SITE_NAME,
  alternateName: `${SITE_NAME} · ${"AI Chess Game Analyzer"}`,
  url: SITE_URL,
  inLanguage: "en",
  description: SITE_DESCRIPTION,
  publisher: { "@id": ORGANIZATION_ID },
};

export const SOFTWARE_APPLICATION_SCHEMA = {
  "@type": ["SoftwareApplication", "WebApplication"],
  "@id": PRODUCT_ID,
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: "GameApplication",
  applicationSubCategory: "Chess analysis and coaching",
  operatingSystem: "Web",
  inLanguage: "en",
  description: SITE_META_DESCRIPTION,
  featureList: [
    "AI coaching report for any finished Chess.com or Lichess game",
    "Stockfish centipawn-loss and blunder detection behind every claim",
    "Five-section report: Strength, Weakness, Game Overview, Focus Areas, Resources",
    "Key moments illustrated on interactive chess boards",
    "Focus-area drills linked to Lichess training material",
    "Personalized Lichess study curriculum mapped to recurring tactical leaks",
    "Opponent scouting dossiers uncovering opening traps and time trouble habits",
    "AI Psychological Profile after three analyzed games",
    "Follow-up Q&A on each analysis (Pro plan)",
    "Batch analysis of up to five games per submission",
  ],
  offers: [
    {
      "@type": "Offer",
      name: "Free",
      price: "0",
      priceCurrency: "INR",
      description: `${PRODUCT_FACTS.freeAnalyses} free game analyses, the first without an account.`,
      url: abs("/"),
    },
    {
      "@type": "Offer",
      name: "Pro",
      price: String(PRODUCT_FACTS.proPriceInr),
      priceCurrency: "INR",
      description: `${PRODUCT_FACTS.proAnalysesPerPeriod} analyses per billing period, batch analysis, and follow-up Q&A.`,
      url: abs("/subscription"),
    },
  ],
  publisher: { "@id": ORGANIZATION_ID },
};

export const faqPageSchema = (items: FaqItem[]) => ({
  "@type": "FAQPage",
  mainEntity: items.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
});

export const breadcrumbSchema = (items: BreadcrumbItem[]) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: abs(item.path),
  })),
});

export const articleSchema = (options: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified: string;
  imagePath?: string;
}) => ({
  "@type": "Article",
  headline: options.headline,
  description: options.description,
  mainEntityOfPage: abs(options.path),
  image: [abs(options.imagePath ?? "/opengraph-image")],
  datePublished: options.datePublished,
  dateModified: options.dateModified,
  inLanguage: "en",
  author: {
    "@type": "Person",
    name: FOUNDERS[0].name,
    jobTitle: FOUNDERS[0].jobTitle,
    url: abs("/about"),
    sameAs: FOUNDERS[0].sameAs,
  },
  publisher: { "@id": ORGANIZATION_ID },
});

export const webPageSchema = (options: {
  name: string;
  path: string;
  description?: string;
  datePublished: string;
  dateModified: string;
}) => ({
  "@type": "WebPage",
  "@id": `${abs(options.path)}/#webpage`,
  url: abs(options.path),
  name: options.name,
  ...(options.description ? { description: options.description } : {}),
  datePublished: options.datePublished,
  dateModified: options.dateModified,
  isPartOf: { "@id": WEBSITE_ID },
  inLanguage: "en",
});

export const schemaGraph = (nodes: Array<Record<string, unknown>>) => ({
  "@context": "https://schema.org",
  "@graph": nodes,
});
