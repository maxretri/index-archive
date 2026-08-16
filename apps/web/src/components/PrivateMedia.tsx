import type { ImgHTMLAttributes } from "react";
import { useObjectUrl, useSharedObjectUrl } from "../hooks";

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  fileId: string;
  variant?: "thumbnail" | "original";
}

export function PrivateImage({ fileId, variant = "thumbnail", alt = "", ...props }: Props) {
  const { url, isError } = useObjectUrl(fileId, variant);
  if (isError) return <div className="media-error">UNAVAILABLE</div>;
  return url ? <img src={url} alt={alt} {...props} /> : <div className="media-skeleton" aria-hidden="true" />;
}

export function PrivateVideo({ fileId }: { fileId: string }) {
  const { url, isLoading, isError } = useObjectUrl(fileId, "original");
  if (isError) return <div className="media-error">VIDEO UNAVAILABLE</div>;
  if (isLoading || !url) return <div className="viewer-loading">LOADING VIDEO</div>;
  return <video src={url} controls playsInline autoPlay />;
}

export function SharedImage({ fileId, shareToken, variant = "thumbnail", alt = "", ...props }: Props & { shareToken: string }) {
  const { url, isError } = useSharedObjectUrl(fileId, shareToken, variant);
  if (isError) return <div className="media-error">UNAVAILABLE</div>;
  return url ? <img src={url} alt={alt} {...props} /> : <div className="media-skeleton" aria-hidden="true" />;
}

export function SharedVideo({ fileId, shareToken }: { fileId: string; shareToken: string }) {
  const { url, isLoading, isError } = useSharedObjectUrl(fileId, shareToken, "original");
  if (isError) return <div className="media-error">VIDEO UNAVAILABLE</div>;
  if (isLoading || !url) return <div className="viewer-loading">LOADING VIDEO</div>;
  return <video src={url} controls playsInline autoPlay />;
}
