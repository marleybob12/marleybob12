import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_PATH =
  process.env.WAVE_OUTPUT ||
  fileURLToPath(new URL("../assets/contribution-wave.svg", import.meta.url));
const USERNAME =
  process.env.GITHUB_USERNAME ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  "marleybob12";
const DEMO_MODE = process.env.DEMO_MODE === "1";

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const isoDate = (date) => date.toISOString().slice(0, 10);

async function fetchContributionCalendar() {
  if (DEMO_MODE) {
    return createDemoCalendar();
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN não foi informado.");
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);

  const query = [
    "query ContributionWave($login: String!, $from: DateTime!, $to: DateTime!) {",
    "  user(login: $login) {",
    "    contributionsCollection(from: $from, to: $to) {",
    "      contributionCalendar {",
    "        totalContributions",
    "        weeks {",
    "          firstDay",
    "          contributionDays {",
    "            contributionCount",
    "            date",
    "            weekday",
    "          }",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "User-Agent": "marleybob12-contribution-wave",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      query,
      variables: {
        login: USERNAME,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const details = payload.errors?.map((error) => error.message).join("; ");
    throw new Error(details || "Falha ao consultar as contribuições no GitHub.");
  }

  const calendar =
    payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error("O GitHub não retornou o calendário de contribuições.");
  }

  return { ...calendar, demo: false };
}

function createDemoCalendar() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 370);
  const weeks = [];

  for (let weekIndex = 0; weekIndex < 53; weekIndex += 1) {
    const contributionDays = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + weekIndex * 7 + weekday);
      const seed = (weekIndex * 17 + weekday * 11) % 29;
      const contributionCount =
        seed < 13 ? 0 : seed < 20 ? 1 : seed < 25 ? 3 : 7;
      contributionDays.push({
        contributionCount,
        date: isoDate(date),
        weekday,
      });
    }
    weeks.push({
      firstDay: contributionDays[0].date,
      contributionDays,
    });
  }

  const totalContributions = weeks
    .flatMap((week) => week.contributionDays)
    .reduce((total, day) => total + day.contributionCount, 0);

  return { totalContributions, weeks, demo: true };
}

function quantile(sortedValues, fraction) {
  if (!sortedValues.length) return 1;
  return sortedValues[Math.floor((sortedValues.length - 1) * fraction)];
}

function renderSvg(calendar) {
  const width = 1000;
  const height = 310;
  const weeks = calendar.weeks.slice(-53);
  const counts = weeks
    .flatMap((week) => week.contributionDays)
    .map((day) => day.contributionCount)
    .filter((count) => count > 0)
    .sort((a, b) => a - b);
  const limits = [
    quantile(counts, 0.25),
    quantile(counts, 0.5),
    quantile(counts, 0.75),
  ];
  const colors = ["#2B2548", "#3F2C86", "#6D46D9", "#A78BFA", "#FFB454"];

  const levelFor = (count) => {
    if (count === 0) return 0;
    if (count <= limits[0]) return 1;
    if (count <= limits[1]) return 2;
    if (count <= limits[2]) return 3;
    return 4;
  };

  const dots = [];
  weeks.forEach((week, weekIndex) => {
    const x = 62 + weekIndex * 16.8;
    const waveCenter = 155 + Math.sin(weekIndex * 0.31) * 35;

    week.contributionDays.forEach((day, dayIndex) => {
      const weekday = Number.isInteger(day.weekday) ? day.weekday : dayIndex;
      const y = waveCenter + (weekday - 3) * 9;
      const level = levelFor(day.contributionCount);
      const delay = (weekIndex * 0.09 + weekday * 0.04).toFixed(2);
      const duration = (5.2 + ((weekIndex + weekday) % 5) * 0.16).toFixed(2);
      const label =
        day.date +
        ": " +
        day.contributionCount +
        (day.contributionCount === 1 ? " contribuição" : " contribuições");

      dots.push(
        [
          "    <g>",
          "      <title>" + escapeXml(label) + "</title>",
          '      <circle class="wave-dot" cx="' +
            x.toFixed(1) +
            '" cy="' +
            y.toFixed(1) +
            '" r="' +
            (level === 0 ? "3.7" : "4.7") +
            '" fill="' +
            colors[level] +
            '" opacity="' +
            (level === 0 ? "0.62" : "1") +
            '" style="animation-delay:-' +
            delay +
            "s;animation-duration:" +
            duration +
            's" />',
          "    </g>",
        ].join("\n"),
      );
    });
  });

  const total = Number(calendar.totalContributions || 0).toLocaleString("pt-BR");
  const updatedAt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  const subtitle = calendar.demo
    ? "Prévia local da animação"
    : "Só contribuições públicas";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="310" viewBox="0 0 1000 310" role="img" aria-labelledby="wave-title wave-desc">',
    '  <title id="wave-title">Onda animada de contribuições de ' +
      escapeXml(USERNAME) +
      "</title>",
    '  <desc id="wave-desc">Cada ponto é um dia. Quanto mais claro, mais contribuições.</desc>',
    "  <defs>",
    '    <clipPath id="rounded-card">',
    '      <rect x="1" y="1" width="998" height="308" rx="22" />',
    "    </clipPath>",
    "    <style>",
    "      .wave-dot {",
    "        transform-box: fill-box;",
    "        transform-origin: center;",
    "        animation-name: float-dot;",
    "        animation-timing-function: ease-in-out;",
    "        animation-iteration-count: infinite;",
    "      }",
    "      @keyframes float-dot {",
    "        0%, 100% { transform: translateY(0); }",
    "        50% { transform: translateY(-11px); }",
    "      }",
    "      @media (prefers-reduced-motion: reduce) {",
    "        .wave-dot { animation: none; }",
    "      }",
    "    </style>",
    "  </defs>",
    '  <g clip-path="url(#rounded-card)">',
    '    <rect width="1000" height="310" fill="#0B0A12" />',
    '    <text x="42" y="44" fill="#F4F1FF" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="20" font-weight="700">Contribuições no último ano</text>',
    '    <text x="42" y="68" fill="#9A94B5" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="13">' +
      escapeXml(subtitle) +
      "</text>",
    '    <text x="958" y="44" text-anchor="end" fill="#FFB454" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="20" font-weight="700">' +
      total +
      "</text>",
    '    <text x="958" y="66" text-anchor="end" fill="#9A94B5" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12">contribuições</text>',
    dots.join("\n"),
    '    <text x="42" y="286" fill="#C9C2E6" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12">Menos</text>',
    '    <circle cx="123" cy="282" r="4" fill="#2B2548" />',
    '    <circle cx="139" cy="282" r="4" fill="#3F2C86" />',
    '    <circle cx="155" cy="282" r="4" fill="#6D46D9" />',
    '    <circle cx="171" cy="282" r="4" fill="#A78BFA" />',
    '    <circle cx="187" cy="282" r="4" fill="#FFB454" />',
    '    <text x="200" y="286" fill="#C9C2E6" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="12">Mais</text>',
    '    <text x="958" y="286" text-anchor="end" fill="#C9C2E6" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="11">Atualizado em ' +
      escapeXml(updatedAt) +
      "</text>",
    "  </g>",
    '  <rect x="1" y="1" width="998" height="308" rx="22" fill="none" stroke="#2A2440" />',
    "</svg>",
    "",
  ].join("\n");
}

const calendar = await fetchContributionCalendar();
const svg = renderSvg(calendar);
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, svg, "utf8");
console.log("Onda de contribuições gerada em " + OUTPUT_PATH);
