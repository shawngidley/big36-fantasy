import LeagueShell from "@/components/LeagueShell";

const sections = [
  {
    title: "Information We Collect",
    body: "36 Football collects the information users voluntarily provide through league registration and account settings, including owner and program details, email addresses, and phone numbers used for league communication and SMS notifications.",
  },
  {
    title: "How We Use Your Information",
    body: "Contact information is used only to operate the 36 Football league and communicate relevant league activity. This may include account access, registration review, draft status, on-deck draft notifications, league administration, and other operational updates.",
  },
  {
    title: "SMS Notifications",
    body: "By providing a mobile number for league notifications, you consent to receive text messages about 36 Football league activity. Message frequency varies with league activity. Message and data rates may apply. Reply STOP at any time to opt out. Reply HELP for assistance. Mobile opt-in data and phone numbers are not shared with third parties or affiliates for marketing or promotional purposes.",
  },
  {
    title: "Data Sharing",
    body: "36 Football does not sell, rent, or distribute phone numbers or personal information for marketing or promotional purposes. Information may be processed by service providers used to operate the league platform, such as hosting, database, storage, and SMS delivery providers, solely to provide league services.",
  },
  {
    title: "Data Security",
    body: "We take reasonable technical and operational measures to protect information collected through the platform. No method of electronic storage or transmission is completely secure, and users should keep account credentials confidential.",
  },
  {
    title: "Changes to This Policy",
    body: "36 Football may update this Privacy Policy as league operations or platform practices change. The updated policy will be posted on this page with a revised effective date.",
  },
  {
    title: "Contact",
    body: "For questions about this Privacy Policy or 36 Football data practices, contact Ascend CX at hello@ascend-cx.com.",
  },
];

export default function PrivacyPolicy() {
  return <LeagueShell eyebrow="League policies · 2026">
    <section className="border-b border-border/60 bg-[#1a120d] text-white">
      <div className="container py-16 sm:py-20">
        <p className="font-condensed text-xs font-bold uppercase tracking-[.24em] text-orange-300">36 Football</p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl font-black tracking-[-.04em] sm:text-6xl">Privacy Policy</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-white/70">Last updated August 2026</p>
      </div>
    </section>
    <section className="container max-w-4xl py-12 sm:py-16">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
        <p className="text-base leading-7 text-muted-foreground">This policy explains how 36 Football collects and uses information in connection with the league platform and league communications.</p>
        <div className="mt-9 space-y-9">
          {sections.map(section => <article key={section.title}>
            <h2 className="font-display text-2xl font-black tracking-[-.02em] text-foreground">{section.title}</h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">{section.body}</p>
          </article>)}
        </div>
      </div>
    </section>
  </LeagueShell>;
}
