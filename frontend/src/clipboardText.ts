export async function copyText(text: string) {
  if (window.alder?.writeClipboard) await window.alder.writeClipboard(text);
  else await navigator.clipboard.writeText(text);
}
