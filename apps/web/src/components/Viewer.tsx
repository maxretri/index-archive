import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArchiveFile } from "@index/shared";
import { formatBytes, formatDuration } from "@index/shared";
import { api } from "../api";
import { PrivateImage, PrivateVideo } from "./PrivateMedia";

interface Props { initialId: string; files: ArchiveFile[]; onClose(): void }

export function Viewer({ initialId, files, onClose }: Props) {
  const initialIndex = Math.max(0, files.findIndex((file) => file.id === initialId));
  const [index, setIndex] = useState(initialIndex);
  const file = files[index]!;
  const queryClient = useQueryClient();
  const touchX = useRef<number | null>(null);
  const collections = useQuery({ queryKey: ["collections"], queryFn: api.collections });
  const [panel, setPanel] = useState<"none" | "collections" | "tags">("none");
  const [tagText, setTagText] = useState(file.tags.join(", "));
  const [isFavorite, setIsFavorite] = useState(file.isFavorite);
  const [collectionIds, setCollectionIds] = useState(file.collectionIds);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setIndex((value) => Math.min(files.length - 1, value + 1));
    };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", keydown); };
  }, [files.length, onClose]);

  useEffect(() => {
    setTagText(file.tags.join(", "));
    setIsFavorite(file.isFavorite);
    setCollectionIds(file.collectionIds);
    setShareError(null);
    setPanel("none");
  }, [file.id, file.collectionIds, file.isFavorite, file.tags]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["files"] });
    await queryClient.invalidateQueries({ queryKey: ["collections"] });
  };
  const favorite = useMutation({
    mutationFn: () => api.favorite(file.id, !isFavorite),
    onSuccess: async (result) => { setIsFavorite(result.isFavorite); await invalidate(); }
  });
  const setCollections = useMutation({
    mutationFn: (ids: string[]) => api.setCollections(file.id, ids),
    onSuccess: async (result) => { setCollectionIds(result.collectionIds); await invalidate(); }
  });
  const setTags = useMutation({ mutationFn: () => api.setTags(file.id, tagText.split(",").map((tag) => tag.trim()).filter(Boolean)), onSuccess: invalidate });
  const share = useMutation({
    mutationFn: () => api.prepareShare(file.id),
    onSuccess: ({ messageId }) => {
      const webApp = window.Telegram?.WebApp;
      if (!webApp?.shareMessage) {
        setShareError("UPDATE TELEGRAM TO FORWARD");
        return;
      }
      setShareError(null);
      webApp.shareMessage(messageId, (sent) => {
        if (sent) webApp.HapticFeedback?.notificationOccurred("success");
      });
    },
    onError: () => setShareError("FORWARD FAILED · TRY AGAIN")
  });

  const navigate = (direction: -1 | 1) => {
    setIndex((value) => Math.max(0, Math.min(files.length - 1, value + direction)));
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
  };
  const download = async () => {
    const blob = await api.content(file.id, "original", true);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename ?? `INDEX-${file.id}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="File viewer"
      onTouchStart={(event) => { touchX.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        if (touchX.current === null) return;
        const distance = (event.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        if (Math.abs(distance) > 55) navigate(distance > 0 ? -1 : 1);
        touchX.current = null;
      }}>
      <header className="viewer-header">
        <button onClick={onClose}>CLOSE</button>
        <span>{String(index + 1).padStart(2, "0")} / {String(files.length).padStart(2, "0")}</span>
        <button onClick={() => void download()}>DOWNLOAD</button>
      </header>

      <div className="viewer-stage">
        <button className="viewer-nav previous" disabled={index === 0} onClick={() => navigate(-1)} aria-label="Previous">‹</button>
        <FilePreview file={file} />
        <button className="viewer-nav next" disabled={index === files.length - 1} onClick={() => navigate(1)} aria-label="Next">›</button>
      </div>

      <footer className="viewer-footer">
        <div className="viewer-meta">
          <strong>{file.filename ?? file.type.toUpperCase()}</strong>
          <span>{new Date(file.createdAt).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" })}{file.fileSize ? ` · ${formatBytes(file.fileSize)}` : ""}{file.duration ? ` · ${formatDuration(file.duration)}` : ""}</span>
        </div>
        <div className="viewer-actions">
          {file.type === "photo" && <button disabled={share.isPending} onClick={() => share.mutate()}>{share.isPending ? "PREPARING" : "FORWARD"}</button>}
          <button className={isFavorite ? "active" : ""} disabled={favorite.isPending} onClick={() => favorite.mutate()}>{isFavorite ? "FAVORITED" : "FAVORITE"}</button>
          <button onClick={() => setPanel(panel === "collections" ? "none" : "collections")}>COLLECTION</button>
          <button onClick={() => setPanel(panel === "tags" ? "none" : "tags")}>TAGS</button>
        </div>
        {shareError && <div className="viewer-action-error">{shareError}</div>}
        {panel === "collections" && <div className="viewer-panel">
          <span>ADD TO COLLECTION</span>
          {collections.data?.map((collection) => {
            const selected = collectionIds.includes(collection.id);
            return <label key={collection.id}><input type="checkbox" checked={selected} onChange={() => {
              const next = selected ? collectionIds.filter((id) => id !== collection.id) : [...collectionIds, collection.id];
              setCollections.mutate(next);
            }} />{collection.name}</label>;
          })}
          {!collections.data?.length && <small>CREATE A COLLECTION FIRST.</small>}
        </div>}
        {panel === "tags" && <form className="viewer-panel tag-form" onSubmit={(event) => { event.preventDefault(); setTags.mutate(); }}>
          <label htmlFor="viewer-tags">TAGS · COMMA SEPARATED</label>
          <input id="viewer-tags" value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="TRAVEL, GREECE" />
          <button type="submit" disabled={setTags.isPending}>SAVE</button>
        </form>}
      </footer>
    </div>
  );
}

function FilePreview({ file }: { file: ArchiveFile }) {
  if (file.type === "photo") return <PrivateImage fileId={file.id} variant="original" alt={file.filename ?? "Archived photo"} />;
  if (file.type === "video") return <PrivateVideo fileId={file.id} />;
  if (file.mimeType === "application/pdf") return <PdfPreview fileId={file.id} />;
  return <div className="document-preview"><b>{file.filename?.split(".").at(-1)?.toUpperCase() ?? file.type.toUpperCase()}</b><span>{file.filename ?? "UNTITLED FILE"}</span><small>SELECT DOWNLOAD TO OPEN THE ORIGINAL</small></div>;
}

function PdfPreview({ fileId }: { fileId: string }) {
  const preview = useQuery({
    queryKey: ["pdf-preview", fileId],
    queryFn: () => api.pdfPreviewUrl(fileId),
    staleTime: 8 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  });
  if (preview.isError) return <div className="viewer-loading">PDF UNAVAILABLE · SELECT DOWNLOAD</div>;
  if (!preview.data) return <div className="viewer-loading">OPENING PDF</div>;
  return <iframe className="pdf-preview" src={`${preview.data}#view=FitH`} title="PDF preview" />;
}
