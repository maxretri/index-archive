import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Collection } from "@index/shared";
import { useState } from "react";
import { api } from "../api";

export function CollectionShareControls({ collection, onChange }: { collection: Collection; onChange(isShared: boolean): void }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const share = useMutation({
    mutationFn: (mode: "native" | "copy") => api.shareCollection(collection.id).then((result) => ({ ...result, mode })),
    onSuccess: async ({ messageId, link, mode }) => {
      onChange(true);
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (mode === "copy") {
        try {
          await navigator.clipboard.writeText(link);
          setNotice("LINK COPIED");
          window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
        } catch {
          setNotice("COPY UNAVAILABLE · USE SHARE WITH");
        }
        return;
      }
      const webApp = window.Telegram?.WebApp;
      if (!webApp?.shareMessage) {
        try {
          await navigator.clipboard.writeText(link);
          setNotice("LINK COPIED");
        } catch { setNotice("UPDATE TELEGRAM TO SHARE"); }
        return;
      }
      setNotice("");
      webApp.shareMessage(messageId, (sent) => {
        if (sent) webApp.HapticFeedback?.notificationOccurred("success");
      });
    },
    onError: (error) => setNotice(error.message)
  });
  const revoke = useMutation({
    mutationFn: () => api.revokeCollectionShares(collection.id),
    onSuccess: async () => {
      onChange(false);
      setNotice("SHARING STOPPED");
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    },
    onError: (error) => setNotice(error.message)
  });

  return <div className="collection-share-actions">
    <button disabled={share.isPending || revoke.isPending} onClick={() => share.mutate("native")}>{share.isPending ? "PREPARING" : "SHARE WITH"}</button>
    <button disabled={share.isPending || revoke.isPending} onClick={() => share.mutate("copy")}>COPY LINK</button>
    {collection.isShared && <button disabled={revoke.isPending || share.isPending} onClick={() => revoke.mutate()}>{revoke.isPending ? "STOPPING" : "STOP SHARING"}</button>}
    {notice && <span>{notice}</span>}
  </div>;
}
