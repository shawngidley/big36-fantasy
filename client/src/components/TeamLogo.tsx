const sizeClasses = { sm: "h-7 w-7 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-2xl" } as const;

export default function TeamLogo({ logoUrl, teamName, size = "md", className = "" }: { logoUrl?: string | null; teamName: string; size?: keyof typeof sizeClasses; className?: string }) {
  const dimension = sizeClasses[size];
  if (logoUrl) return <img src={logoUrl} alt={`${teamName} logo`} className={`${dimension} shrink-0 rounded-full border border-border object-cover ${className}`} />;
  return <span className={`${dimension} flex shrink-0 items-center justify-center rounded-full border border-border bg-accent font-display font-extrabold text-primary ${className}`}>{teamName.slice(0, 1).toUpperCase()}</span>;
}
