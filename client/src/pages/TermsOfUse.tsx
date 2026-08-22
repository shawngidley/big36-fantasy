import LeagueShell from "@/components/LeagueShell";

const terms = [
  {
    title: "1. Ownership",
    body: "The 36 Football League system, including its ruleset, scoring methodology, draft format, game-cap structure, league operations, website design, and original content published at 36football.com, is the intellectual property of 36 Football. The website is designed and developed by Ascend CX and maintained for the league.",
  },
  {
    title: "2. Permitted Use",
    body: "Access to this website is granted to league participants and visitors for personal, non-commercial use in connection with 36 Football league participation, research, and viewing league information.",
  },
  {
    title: "3. Prohibited Use",
    body: "No portion of this website, including its design, ruleset, code, content, branding, or operational format, may be reproduced, copied, adapted, distributed, publicly displayed, sold, sublicensed, or used to create derivative works without prior written permission from 36 Football or Ascend CX.",
  },
  {
    title: "4. Commercial Licensing",
    body: "Any party interested in licensing the 36 Football league system, ruleset, website design, or related original materials for commercial purposes must contact Ascend CX at hello@ascend-cx.com to discuss licensing terms.",
  },
  {
    title: "5. Intellectual Property Notice",
    body: "The league rules, scoring system, operational design, website design, and original content represented on this site are creative and functional works. All rights are reserved by 36 Football and the applicable rights holders.",
  },
  {
    title: "6. Third-Party Resources",
    body: "The site may link to third-party statistics, news, schedules, rankings, recruiting, and research resources. Those sources remain subject to their own terms, policies, and availability. 36 Football does not control or endorse every item of third-party content.",
  },
  {
    title: "7. Changes",
    body: "36 Football may update these Terms of Use when league operations, website functionality, or applicable requirements change. Continued use of the site after an update constitutes acceptance of the revised Terms.",
  },
];

export default function TermsOfUse() {
  return <LeagueShell eyebrow="League policies · 2026">
    <section className="border-b border-border/60 bg-[#1a120d] text-white">
      <div className="container py-16 sm:py-20">
        <p className="font-condensed text-xs font-bold uppercase tracking-[.24em] text-orange-300">36 Football</p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl font-black tracking-[-.04em] sm:text-6xl">Terms of Use</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-white/70">Effective August 2026</p>
      </div>
    </section>
    <section className="container max-w-4xl py-12 sm:py-16">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
        <p className="text-base leading-7 text-muted-foreground">These Terms govern access to and use of 36football.com and the 36 Football League platform.</p>
        <div className="mt-9 space-y-9">
          {terms.map(term => <article key={term.title}>
            <h2 className="font-display text-2xl font-black tracking-[-.02em] text-foreground">{term.title}</h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">{term.body}</p>
          </article>)}
        </div>
      </div>
    </section>
  </LeagueShell>;
}
