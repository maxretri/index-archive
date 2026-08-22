import type { ImgHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useNearViewport, useObjectUrl, useReceivedObjectUrl, useSharedObjectUrl } from "../hooks";

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  fileId: string;
  variant?: "thumbnail" | "original";
}

export function PrivateImage({ fileId, variant = "thumbnail", alt = "", loading, ...props }: Props) {
  const lazy = loading === "lazy" && variant === "thumbnail";
  const viewport = useNearViewport(lazy);
  const { url, isError } = useObjectUrl(fileId, variant, !lazy || viewport.near);
  if (isError) return <div ref={viewport.ref} className="media-error">UNAVAILABLE</div>;
  return url
    ? <img ref={viewport.ref} src={url} alt={alt} loading={loading} decoding="async" {...props} />
    : <div ref={viewport.ref} className="media-skeleton" aria-hidden="true" />;
}

export function PrivateVideo({ fileId }: { fileId: string }) {
  const preview = useQuery({ queryKey: ["file-preview", fileId], queryFn: () => api.previewUrl(fileId), staleTime: 8 * 60 * 1000 });
  if (preview.isError) return <div className="media-error">VIDEO UNAVAILABLE</div>;
  if (!preview.data) return <div className="viewer-loading">LOADING VIDEO</div>;
  return <video src={preview.data} controls playsInline autoPlay preload="metadata" />;
}

export function SharedImage({ fileId, shareToken, variant = "thumbnail", alt = "", loading, ...props }: Props & { shareToken: string }) {
  const lazy = loading === "lazy" && variant === "thumbnail";
  const viewport = useNearViewport(lazy);
  const { url, isError } = useSharedObjectUrl(fileId, shareToken, variant, !lazy || viewport.near);
  if (isError) return <div ref={viewport.ref} className="media-error">UNAVAILABLE</div>;
  return url
    ? <img ref={viewport.ref} src={url} alt={alt} loading={loading} decoding="async" {...props} />
    : <div ref={viewport.ref} className="media-skeleton" aria-hidden="true" />;
}

export function SharedVideo({ fileId, shareToken }: { fileId: string; shareToken: string }) {
  const { url, isLoading, isError } = useSharedObjectUrl(fileId, shareToken, "original");
  if (isError) return <div className="media-error">VIDEO UNAVAILABLE</div>;
  if (isLoading || !url) return <div className="viewer-loading">LOADING VIDEO</div>;
  return <video src={url} controls playsInline autoPlay />;
}

export function ReceivedImage({ fileId, grantId, variant = "thumbnail", alt = "", loading, ...props }: Props & { grantId: string }) {
  const lazy = loading === "lazy" && variant === "thumbnail";
  const viewport = useNearViewport(lazy);
  const { url, isError } = useReceivedObjectUrl(grantId, fileId, variant, !lazy || viewport.near);
  if (isError) return <div ref={viewport.ref} className="media-error">UNAVAILABLE</div>;
  return url
    ? <img ref={viewport.ref} src={url} alt={alt} loading={loading} decoding="async" {...props} />
    : <div ref={viewport.ref} className="media-skeleton" aria-hidden="true" />;
}

export function ReceivedVideo({ fileId, grantId }: { fileId: string; grantId: string }) {
  const { url, isLoading, isError } = useReceivedObjectUrl(grantId, fileId, "original");
  if (isError) return <div className="media-error">VIDEO UNAVAILABLE</div>;
  if (isLoading || !url) return <div className="viewer-loading">LOADING VIDEO</div>;
  return <video src={url} controls playsInline autoPlay />;
}
