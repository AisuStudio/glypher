// Lets the user name the file and pick a save location via the File System
// Access API (Chrome/Edge). Firefox/Safari don't implement it, so there we
// fall back to a classic <a download> — the browser still lets the user
// rename the file in its own save dialog if "always ask where to save" is
// on, but we can't offer a path picker there; a prompt at least covers the
// name.
type SaveFileOptions = {
  suggestedName: string;
  mimeType: string;
  extension: string; // without the dot, e.g. "otf"
  description: string;
};

export async function saveFile(blob: Blob, options: SaveFileOptions) {
  const picker = (window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: options.suggestedName,
        types: [
          {
            description: options.description,
            accept: { [options.mimeType]: [`.${options.extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // user cancelled the picker
      // Any other failure (e.g. picker blocked in this context) falls
      // through to the classic download below.
    }
  }

  const name = window.prompt("File name", options.suggestedName);
  if (name === null) return; // user cancelled the prompt
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || options.suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
