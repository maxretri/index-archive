import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function SponsorSlot({ onOpenPlus }: { onOpenPlus(): void }) {
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: api.subscription, staleTime: 10_000 });
  if (!subscription.data || subscription.data.plan === "plus") return null;
  return <aside className="sponsor-slot" aria-label="Sponsored">
    <span>SPONSORED / INDEX</span>
    <button onClick={onOpenPlus}><strong>A QUIETER ARCHIVE.</strong><small>REMOVE SPONSORED PLACEMENTS WITH INDEX PLUS · 299 ★</small></button>
  </aside>;
}
