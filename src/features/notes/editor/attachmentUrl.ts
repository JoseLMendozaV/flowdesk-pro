import { useEffect, useState } from "react";
import { flowdeskApi } from "../../../services/flowdeskApi";

/** Una URL `blob:` por adjunto y ventana: se pide a Rust una sola vez. */
const cache = new Map<string, Promise<string>>();

export function attachmentUrl(attachmentId: string, mimeType: string) {
  let url = cache.get(attachmentId);
  if (!url) {
    url = flowdeskApi
      .noteAttachmentData(attachmentId)
      .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/octet-stream" })));
    url.catch(() => cache.delete(attachmentId));
    cache.set(attachmentId, url);
  }
  return url;
}

export function useAttachmentUrl(attachmentId: string | null, mimeType: string) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!attachmentId) return;
    let active = true;
    attachmentUrl(attachmentId, mimeType)
      .then((url) => active && setState({ url, failed: false }))
      .catch(() => active && setState({ url: null, failed: true }));
    return () => {
      active = false;
    };
  }, [attachmentId, mimeType]);
  return state;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
