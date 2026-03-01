export function openInBrowser(url: string): void {
  const opener =
    Deno.build.os === "darwin"
      ? "open"
      : Deno.build.os === "windows"
        ? "cmd"
        : "xdg-open";
  const args = Deno.build.os === "windows" ? ["/c", "start", url] : [url];
  new Deno.Command(opener, { args }).spawn();
}
