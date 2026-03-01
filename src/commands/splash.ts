import { BOLD, CLEAR, CYAN, DIM, HIDE_CUR, RESET } from "../ui/ansi.ts";
import { write } from "../ui/terminal.ts";

const ART = [
  "  ████████╗██╗    ██╗         _     ",
  "     ██╔══╝██║    ██║       _( )_   ",
  "     ██║   ██║ █╗ ██║      ( O O )  ",
  "     ██║   ╚████████╔╝    (___\\/___)",
  "     ╚═╝    ╚═══════╝      ~~~~~~~~ ",
];

const TAGLINE = "Trying to make using Teamwork less crap, since 2026";

export async function showSplash(version: string): Promise<void> {
  write(CLEAR + HIDE_CUR);
  write("\n\n");
  for (const line of ART) {
    write(`  ${BOLD}${CYAN}${line}${RESET}\n`);
  }
  write(`\n  ${DIM}${TAGLINE}${RESET}  ${DIM}v${version}${RESET}\n`);
  await new Promise<void>((resolve) => setTimeout(resolve, 4000));
}
