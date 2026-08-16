import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Collection } from "@index/shared";
import { api } from "../api";
import { PrivateImage } from "./PrivateMedia";

export function Collections({ onOpen }: { onOpen(collection: Collection): void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const collections = useQuery({ queryKey: ["collections"], queryFn: api.collections });
  const create = useMutation({
    mutationFn: () => api.createCollection(name),
    onSuccess: async () => { setName(""); await queryClient.invalidateQueries({ queryKey: ["collections"] }); }
  });

  return <div className="collections-view">
    <header className="section-intro"><span>VIRTUAL ARCHIVES</span><p>One file can live in many collections. Telegram messages never move.</p></header>
    <form className="collection-create" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="NEW COLLECTION" maxLength={80} aria-label="Collection name" />
      <button disabled={create.isPending || !name.trim()}>CREATE</button>
    </form>
    {create.error && <p className="form-error">{create.error.message}</p>}
    <div className="collection-grid">
      {collections.data?.map((collection, index) => <button key={collection.id} className="collection-card" onClick={() => onOpen(collection)}>
        <div className="collection-cover">{collection.coverFileId ? <PrivateImage fileId={collection.coverFileId} loading="lazy" /> : <span>{String(index + 1).padStart(2, "0")}</span>}</div>
        <strong>{collection.name}</strong><small>{collection.itemCount} {collection.itemCount === 1 ? "ITEM" : "ITEMS"}{collection.isShared ? " · SHARED" : ""}</small>
      </button>)}
    </div>
    {!collections.isLoading && !collections.data?.length && <div className="empty-state"><p>NO COLLECTIONS YET</p><span>CREATE ONE FOR A PROJECT, PLACE OR PERSON.</span></div>}
  </div>;
}
