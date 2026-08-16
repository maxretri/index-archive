import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Collection } from "@index/shared";
import { api } from "../api";
import { PrivateImage } from "./PrivateMedia";

export function Collections({ onOpen }: { onOpen(collection: Collection): void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Collection>();
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const collections = useQuery({ queryKey: ["collections"], queryFn: api.collections });
  const create = useMutation({
    mutationFn: () => api.createCollection(name),
    onSuccess: async () => { setName(""); await queryClient.invalidateQueries({ queryKey: ["collections"] }); }
  });
  const closeEditor = () => { setEditing(undefined); setEditName(""); setConfirmDelete(false); };
  const rename = useMutation({
    mutationFn: () => api.renameCollection(editing!.id, editName),
    onSuccess: async () => { closeEditor(); await queryClient.invalidateQueries({ queryKey: ["collections"] }); }
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCollection(editing!.id),
    onSuccess: async () => {
      closeEditor();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["collections"] }),
        queryClient.invalidateQueries({ queryKey: ["files"] })
      ]);
    }
  });
  const share = useMutation({
    mutationFn: (collection: Collection) => api.shareCollection(collection.id),
    onSuccess: async ({ messageId, link }) => {
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
      const webApp = window.Telegram?.WebApp;
      if (webApp?.shareMessage) {
        setShareNotice("");
        webApp.shareMessage(messageId, (sent) => {
          if (sent) webApp.HapticFeedback?.notificationOccurred("success");
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        setShareNotice("LINK COPIED · OPEN INDEX IN TELEGRAM TO SHARE WITH A CONTACT");
      } catch { setShareNotice("OPEN INDEX IN TELEGRAM TO SHARE"); }
    },
    onError: (error) => setShareNotice(error.message)
  });
  const openEditor = (collection: Collection, deleteImmediately = false) => {
    setEditing(collection);
    setEditName(collection.name);
    setConfirmDelete(deleteImmediately);
    rename.reset();
    remove.reset();
  };

  return <div className="collections-view">
    <header className="section-intro"><span>VIRTUAL ARCHIVES</span><p>One file can live in many collections. Telegram messages never move.</p></header>
    <form className="collection-create" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="NEW COLLECTION" maxLength={80} aria-label="Collection name" />
      <button disabled={create.isPending || !name.trim()}>CREATE</button>
    </form>
    {create.error && <p className="form-error">{create.error.message}</p>}
    {shareNotice && <p className="collection-share-notice">{shareNotice}</p>}
    <div className="collection-grid">
      {collections.data?.map((collection, index) => <article key={collection.id} className="collection-card">
        <button className="collection-open" onClick={() => onOpen(collection)}>
          <div className="collection-cover">{collection.coverFileId ? <PrivateImage fileId={collection.coverFileId} loading="lazy" /> : <span>{String(index + 1).padStart(2, "0")}</span>}</div>
          <strong>{collection.name}</strong><small>{collection.itemCount} {collection.itemCount === 1 ? "ITEM" : "ITEMS"}{collection.isShared ? " · SHARED" : ""}</small>
        </button>
        <div className="collection-card-actions">
          <button disabled={share.isPending} onClick={() => share.mutate(collection)}>{share.isPending && share.variables?.id === collection.id ? "PREPARING" : "SHARE"}</button>
          <button aria-label={`Edit ${collection.name}`} onClick={() => openEditor(collection)}>EDIT</button>
          <button aria-label={`Delete ${collection.name}`} onClick={() => openEditor(collection, true)}>DELETE</button>
        </div>
      </article>)}
    </div>
    {!collections.isLoading && !collections.data?.length && <div className="empty-state"><p>NO COLLECTIONS YET</p><span>CREATE ONE FOR A PROJECT, PLACE OR PERSON.</span></div>}
    {editing && <div className="bulk-sheet-backdrop" role="presentation" onClick={closeEditor}>
      <section className="bulk-sheet collection-manage-sheet" role="dialog" aria-modal="true" aria-label={`Edit ${editing.name}`} onClick={(event) => event.stopPropagation()}>
        <header><span>EDIT COLLECTION</span><button onClick={closeEditor}>CLOSE</button></header>
        <form className="collection-rename" onSubmit={(event) => {
          event.preventDefault();
          if (editName.trim() && editName.trim().toUpperCase() !== editing.name) rename.mutate();
        }}>
          <label htmlFor="collection-edit-name">NAME</label>
          <div><input id="collection-edit-name" autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={80} />
            <button disabled={rename.isPending || !editName.trim() || editName.trim().toUpperCase() === editing.name}>{rename.isPending ? "SAVING" : "SAVE"}</button></div>
        </form>
        {rename.error && <p className="collection-manage-error">{rename.error.message}</p>}
        <div className="collection-delete-zone">
          <span>DELETE COLLECTION</span>
          <p>Files will remain in your main INDEX and in Telegram. Active share links for this collection will stop working.</p>
          {!confirmDelete
            ? <button onClick={() => setConfirmDelete(true)}>DELETE</button>
            : <div className="collection-delete-confirm"><button disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? "DELETING" : "CONFIRM DELETE"}</button><button onClick={() => setConfirmDelete(false)}>KEEP COLLECTION</button></div>}
          {remove.error && <p className="collection-manage-error">{remove.error.message}</p>}
        </div>
      </section>
    </div>}
  </div>;
}
