interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number } };
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  enableClosingConfirmation(): void;
  shareMessage(messageId: string, callback?: (success: boolean) => void): void;
  downloadFile?(params: { url: string; file_name: string }, callback?: (accepted: boolean) => void): void;
  showAlert(message: string, callback?: () => void): void;
  openInvoice(url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void): void;
  openLink(url: string): void;
  HapticFeedback?: { impactOccurred(style: "light" | "medium" | "heavy"): void; notificationOccurred(type: "error" | "success" | "warning"): void };
}

interface Window { Telegram?: { WebApp: TelegramWebApp } }
