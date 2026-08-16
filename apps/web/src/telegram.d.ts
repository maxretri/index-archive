interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  enableClosingConfirmation(): void;
  shareMessage(messageId: string, callback?: (success: boolean) => void): void;
  HapticFeedback?: { impactOccurred(style: "light" | "medium" | "heavy"): void; notificationOccurred(type: "error" | "success" | "warning"): void };
}

interface Window { Telegram?: { WebApp: TelegramWebApp } }
