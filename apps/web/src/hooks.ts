import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function useObjectUrl(id: string, variant: "thumbnail" | "original", enabled = true) {
  const query = useQuery({
    queryKey: ["content", id, variant],
    queryFn: () => api.content(id, variant),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!query.data) return;
    const next = URL.createObjectURL(query.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [query.data]);
  return { ...query, url };
}

export function useSharedObjectUrl(id: string, shareToken: string, variant: "thumbnail" | "original", enabled = true) {
  const query = useQuery({
    queryKey: ["shared-content", shareToken, id, variant],
    queryFn: () => api.sharedContent(id, shareToken, variant),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!query.data) return;
    const next = URL.createObjectURL(query.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [query.data]);
  return { ...query, url };
}

export function useReceivedObjectUrl(grantId: string, id: string, variant: "thumbnail" | "original", enabled = true) {
  const query = useQuery({
    queryKey: ["received-content", grantId, id, variant],
    queryFn: () => api.receivedContent(grantId, id, variant),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!query.data) return;
    const next = URL.createObjectURL(query.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [query.data]);
  return { ...query, url };
}

export function useNearViewport(active = true, rootMargin = "600px") {
  const [node, setNode] = useState<Element | null>(null);
  const [near, setNear] = useState(!active);
  useEffect(() => {
    if (!active) {
      setNear(true);
      return;
    }
    if (!node || near) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, near, node, rootMargin]);
  return { near, ref: setNode };
}

export function useIntersection(onIntersect: () => void, active = true) {
  const [node, setNode] = useState<Element | null>(null);
  useEffect(() => {
    if (!node || !active) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onIntersect();
    }, { rootMargin: "500px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, active, onIntersect]);
  return setNode;
}
